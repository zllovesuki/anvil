import { GetProjectRunsQuery, ProjectId, type RunId, type RunSummary, UserId } from "@/contracts";
import { expectTrusted, RunMetaState } from "@/worker/contracts";
import type { AppContext } from "@/worker/hono";
import type { RunPaginationCursor } from "@/worker/db/d1/repositories";
import { HttpError } from "@/worker/http";
import { serializeRunSummary } from "@/worker/presentation/serializers";
import { createLogger, extractTimestampFromDurableEntityId } from "@/worker/services";
import { toCodecIssueDetails } from "@/lib/codec-errors";
export {
  requireWebhookProviderParam,
  resolveWebhookConfigForUpsert,
  normalizeWebhookConfigIfPresent,
} from "@/worker/api/webhook-shared";

export const logger = createLogger("worker.projects");
export const UNIQUE_PROJECT_SLUG_CONSTRAINT =
  "UNIQUE constraint failed: project_index.owner_slug, project_index.project_slug";
export const DEFAULT_PROJECT_RUN_LIMIT = 20;
export const MAX_PROJECT_RUN_LIMIT = 100;

export const isConstraintError = (error: unknown, messageFragment: string): boolean =>
  error instanceof Error && error.message.includes(messageFragment);

export const getProjectStub = (env: AppContext["env"], projectId: ProjectId) => env.PROJECT_DO.getByName(projectId);
export const getRunStub = (env: AppContext["env"], runId: RunId) => env.RUN_DO.getByName(runId);

const decodeBase64Url = (value: string): string => {
  let normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = normalized.length % 4;
  if (remainder > 0) {
    normalized = normalized.padEnd(normalized.length + (4 - remainder), "=");
  }

  return atob(normalized);
};

const encodeBase64Url = (value: string): string =>
  btoa(value).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

export const parseProjectRunsQuery = (c: AppContext): { limit: number; cursor?: string } => {
  const limitValue = c.req.query("limit");

  let payload: { limit?: number; cursor?: string };
  try {
    payload = GetProjectRunsQuery.assertDecode({
      limit: limitValue === undefined ? undefined : Number(limitValue),
      cursor: c.req.query("cursor") ?? undefined,
    });
  } catch (error) {
    throw new HttpError(400, "invalid_request", "Query string failed validation.", toCodecIssueDetails(error));
  }

  return {
    limit: Math.min(payload.limit ?? DEFAULT_PROJECT_RUN_LIMIT, MAX_PROJECT_RUN_LIMIT),
    cursor: payload.cursor,
  };
};

export const decodeRunCursor = (cursor: string): RunPaginationCursor => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(decodeBase64Url(cursor)) as unknown;
  } catch (error) {
    throw new HttpError(400, "invalid_cursor", "Cursor is invalid.", error);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("queuedAt" in parsed) ||
    !("runId" in parsed) ||
    typeof parsed.queuedAt !== "number" ||
    typeof parsed.runId !== "string"
  ) {
    throw new HttpError(400, "invalid_cursor", "Cursor is invalid.");
  }

  return {
    queuedAt: parsed.queuedAt,
    runId: parsed.runId,
  };
};

export const encodeRunCursor = (cursor: RunPaginationCursor): string =>
  encodeBase64Url(
    JSON.stringify({
      queuedAt: cursor.queuedAt,
      runId: cursor.runId,
    }),
  );

export const mergeRunSummaryWithMeta = (runId: string, meta: RunMetaState, base: RunSummary | null) =>
  serializeRunSummary({
    id: runId,
    projectId: meta.projectId,
    triggeredByUserId: base?.triggeredByUserId ?? null,
    triggerType: meta.triggerType,
    branch: meta.branch,
    commitSha: meta.commitSha,
    status: meta.status,
    queuedAt: base === null ? (extractTimestampFromDurableEntityId(runId) ?? Date.now()) : Date.parse(base.queuedAt),
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    exitCode: meta.exitCode,
  });

export const toTriggeredByUserId = (userId: string) => expectTrusted(UserId, userId, "UserId");
