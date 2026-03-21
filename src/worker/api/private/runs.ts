import { type LogStreamTicketResponse, ProjectId, RunId, type RunStatus, toRunStatusOrNull, UserId } from "@/contracts";
import { expectTrusted, isoDateTimeFromTimestamp, isTerminalStatus, type RunMetaState } from "@/worker/contracts";
import { toCodecIssueDetails } from "@/lib/codec-errors";
import { queueProjectReconciliation } from "@/worker/api/private/reconciliation";
import { findOwnedProjectForCurrentUser } from "@/worker/api/private/shared";
import { findRunIndexById, findUserById, type ProjectRow, type RunIndexRow } from "@/worker/db/d1/repositories";
import type { AppContext } from "@/worker/hono";
import { HttpError } from "@/worker/http";
import {
  serializeLogEvent,
  serializeRunDetail,
  serializeRunStep,
  serializeRunSummary,
} from "@/worker/presentation/serializers";
import { createInternalRunLogHeaders } from "@/worker/run-logs/auth";
import { extractTimestampFromDurableEntityId, generateOpaqueToken } from "@/worker/services";

const LOG_TICKET_TTL_SECONDS = 60;
const LOG_TICKET_KEY_PREFIX = "run-log-ticket:";

const getProjectStub = (env: Env, projectId: ProjectId) => env.PROJECT_DO.getByName(projectId);
const getRunStub = (env: Env, runId: RunId) => env.RUN_DO.getByName(runId);

interface OwnedRunResolution {
  projectId: ProjectId;
  project: ProjectRow;
  d1Run: RunIndexRow | undefined;
  summary: RunMetaState | null;
}

interface LogTicketRecord {
  runId: RunId;
  userId: UserId;
  expiresAt: number;
}

const decodeRunIdParam = (runId: string): RunId => {
  try {
    return RunId.assertDecode(runId);
  } catch (error) {
    throw new HttpError(404, "run_not_found", "Run was not found.", toCodecIssueDetails(error));
  }
};

const getLogTicketKey = (ticket: string): string => `${LOG_TICKET_KEY_PREFIX}${ticket}`;

const parseLogTicketRecord = (value: string | null): LogTicketRecord | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !("runId" in parsed) ||
      !("userId" in parsed) ||
      !("expiresAt" in parsed)
    ) {
      return null;
    }

    return {
      runId: RunId.assertDecode(parsed.runId),
      userId: UserId.assertDecode(parsed.userId),
      expiresAt: Number(parsed.expiresAt),
    };
  } catch {
    return null;
  }
};

const requireRunIdParam = (c: AppContext): RunId => {
  const runId = c.req.param("runId");
  if (!runId) {
    throw new HttpError(404, "run_not_found", "Run was not found.");
  }

  return decodeRunIdParam(runId);
};

const resolveOwnedRun = async (c: AppContext, runId: RunId): Promise<OwnedRunResolution> => {
  const db = c.get("db");
  const d1Run = await findRunIndexById(db, runId);
  const summary = d1Run ? null : await getRunStub(c.env, runId).getRunSummary(runId);
  const projectId = d1Run?.projectId ?? summary?.projectId;

  if (!projectId) {
    throw new HttpError(404, "run_not_found", "Run was not found.");
  }

  const decodedProjectId = expectTrusted(ProjectId, projectId, "ProjectId");

  const project = await findOwnedProjectForCurrentUser(c, decodedProjectId);
  if (!project || (!d1Run && !summary)) {
    throw new HttpError(404, "run_not_found", "Run was not found.");
  }

  return { projectId: decodedProjectId, project, d1Run, summary };
};

interface RunDetailResponseState {
  response: Response;
  runStatus: RunStatus;
}

const buildRunDetailResponse = async (
  c: AppContext,
  runId: RunId,
  resolution: OwnedRunResolution,
  statusOverride: RunStatus | null = null,
): Promise<RunDetailResponseState> => {
  const runDetail = await getRunStub(c.env, runId).getRunDetail(runId);
  const d1RunStatus = toRunStatusOrNull(resolution.d1Run?.status);
  const runStatus = statusOverride ?? runDetail.meta?.status ?? resolution.summary?.status ?? d1RunStatus ?? "queued";

  const run = serializeRunSummary({
    id: runId,
    projectId: resolution.project.id,
    triggeredByUserId: resolution.d1Run?.triggeredByUserId ?? null,
    triggerType:
      runDetail.meta?.triggerType ?? resolution.summary?.triggerType ?? resolution.d1Run?.triggerType ?? "manual",
    branch:
      runDetail.meta?.branch ??
      resolution.summary?.branch ??
      resolution.d1Run?.branch ??
      resolution.project.defaultBranch,
    commitSha: runDetail.meta?.commitSha ?? resolution.summary?.commitSha ?? resolution.d1Run?.commitSha ?? null,
    status: runStatus,
    queuedAt: resolution.d1Run?.queuedAt ?? extractTimestampFromDurableEntityId(runId) ?? Date.now(),
    startedAt: runDetail.meta?.startedAt ?? resolution.summary?.startedAt ?? resolution.d1Run?.startedAt ?? null,
    finishedAt: runDetail.meta?.finishedAt ?? resolution.summary?.finishedAt ?? resolution.d1Run?.finishedAt ?? null,
    exitCode: runDetail.meta?.exitCode ?? resolution.summary?.exitCode ?? resolution.d1Run?.exitCode ?? null,
  });

  return {
    response: c.json(
      serializeRunDetail({
        run,
        currentStep: runDetail.meta?.currentStep ?? null,
        errorMessage: runDetail.meta?.errorMessage ?? null,
        steps: runDetail.steps.map(serializeRunStep),
        recentLogs: runDetail.recentLogs.map(serializeLogEvent),
        detailAvailable: runDetail.meta !== null,
      }),
      200,
    ),
    runStatus,
  };
};

const requireWebSocketUpgrade = (request: Request): void => {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "upgrade_required", "WebSocket upgrade required.");
  }
};

export const handleGetRunDetail = async (c: AppContext): Promise<Response> => {
  const runId = requireRunIdParam(c);
  const resolution = await resolveOwnedRun(c, runId);
  const result = await buildRunDetailResponse(c, runId, resolution);

  if (!isTerminalStatus(result.runStatus) || !resolution.d1Run) {
    queueProjectReconciliation(c, resolution.projectId, "get_run_detail");
  }

  return result.response;
};

export const handleCancelRun = async (c: AppContext): Promise<Response> => {
  const runId = requireRunIdParam(c);
  const resolution = await resolveOwnedRun(c, runId);

  const cancelResult = await getProjectStub(c.env, resolution.projectId).requestRunCancel({
    projectId: resolution.projectId,
    runId,
  });

  const statusOverride =
    cancelResult.status === "cancel_requested" ||
    cancelResult.status === "canceled" ||
    cancelResult.status === "passed" ||
    cancelResult.status === "failed"
      ? cancelResult.status
      : null;

  queueProjectReconciliation(c, resolution.projectId, "cancel_run");

  return (await buildRunDetailResponse(c, runId, await resolveOwnedRun(c, runId), statusOverride)).response;
};

export const handleCreateRunLogTicket = async (c: AppContext): Promise<Response> => {
  const runId = requireRunIdParam(c);
  await resolveOwnedRun(c, runId);

  const userId = expectTrusted(UserId, c.get("user").id, "UserId");
  const ticket = generateOpaqueToken(32);
  const expiresAt = Date.now() + LOG_TICKET_TTL_SECONDS * 1000;

  await c.env.LOG_TICKETS.put(
    getLogTicketKey(ticket),
    JSON.stringify({
      runId,
      userId,
      expiresAt,
    } satisfies LogTicketRecord),
    { expirationTtl: LOG_TICKET_TTL_SECONDS },
  );

  const response: LogStreamTicketResponse = {
    ticket,
    expiresAt: isoDateTimeFromTimestamp(expiresAt),
  };

  return c.json(response, 200);
};

export const handleGetRunLogsWebSocket = async (c: AppContext): Promise<Response> => {
  const runId = requireRunIdParam(c);
  requireWebSocketUpgrade(c.req.raw);

  const ticket = c.req.query("ticket")?.trim();
  if (!ticket) {
    throw new HttpError(403, "invalid_log_ticket", "Log stream ticket is missing or invalid.");
  }

  const ticketKey = getLogTicketKey(ticket);
  const ticketRecord = parseLogTicketRecord(await c.env.LOG_TICKETS.get(ticketKey));
  await c.env.LOG_TICKETS.delete(ticketKey);

  if (!ticketRecord || ticketRecord.expiresAt <= Date.now() || ticketRecord.runId !== runId) {
    throw new HttpError(403, "invalid_log_ticket", "Log stream ticket is missing or invalid.");
  }

  const ticketUser = await findUserById(c.get("db"), ticketRecord.userId);
  if (!ticketUser) {
    throw new HttpError(403, "invalid_session", "Session user no longer exists.");
  }

  if (ticketUser.disabledAt !== null) {
    throw new HttpError(403, "user_disabled", "User account is disabled.");
  }

  const url = new URL(c.req.url);
  url.search = "";

  const headers = createInternalRunLogHeaders(c.req.raw.headers, runId, ticketRecord.userId);
  headers.delete("authorization");
  headers.delete("cookie");

  const internalRequest = new Request(url.toString(), {
    method: "GET",
    headers,
  });

  return getRunStub(c.env, runId).fetch(internalRequest);
};
