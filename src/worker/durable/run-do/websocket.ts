import { serializeLogEvent, serializeRunExecutionState, serializeRunStep } from "@/worker/presentation/serializers";
import { readInternalRunLogAuth } from "@/worker/run-logs/auth";
import type { Logger } from "@/worker/services/logger";
import { RunId, UserId } from "@/contracts";
import type { RunWsLogMessage, RunWsStateMessage } from "@/contracts/run-ws";
import type { RunLogRecord } from "@/worker/contracts";

import { listRunLogs } from "./logs";
import type { RunDb } from "./repo";
import { getRunMeta, listRunSteps } from "./repo/index";

export interface RunLogSocketAttachment {
  runId: RunId;
  userId: UserId;
  connectedAt: number;
  lastAckedSeq: number | null;
}

export const getSocketAttachment = (ws: WebSocket): RunLogSocketAttachment | null => {
  const attachment = ws.deserializeAttachment();
  if (
    !attachment ||
    typeof attachment !== "object" ||
    Array.isArray(attachment) ||
    !("runId" in attachment) ||
    !("userId" in attachment) ||
    !("connectedAt" in attachment) ||
    !("lastAckedSeq" in attachment)
  ) {
    return null;
  }

  try {
    return {
      runId: RunId.assertDecode(attachment.runId),
      userId: UserId.assertDecode(attachment.userId),
      connectedAt: Number(attachment.connectedAt),
      lastAckedSeq: attachment.lastAckedSeq === null ? null : Number(attachment.lastAckedSeq),
    };
  } catch {
    return null;
  }
};

export const sendLogEvent = (ws: WebSocket, event: RunLogRecord): void => {
  const message: RunWsLogMessage = { type: "log", event: serializeLogEvent(event) };
  ws.send(JSON.stringify(message));
};

const buildStateMessage = (
  meta: NonNullable<Awaited<ReturnType<typeof getRunMeta>>>,
  steps: Awaited<ReturnType<typeof listRunSteps>>,
): RunWsStateMessage => ({
  type: "state",
  run: serializeRunExecutionState(meta),
  steps: steps.map(serializeRunStep),
});

const sendStateMessage = (ws: WebSocket, message: RunWsStateMessage): void => {
  ws.send(JSON.stringify(message));
};

export const broadcastStateUpdate = async (
  ctx: DurableObjectState,
  db: RunDb,
  logger: Logger,
  runId: RunId,
): Promise<void> => {
  const meta = await getRunMeta(db, runId);
  if (!meta) return;

  const steps = await listRunSteps(db, runId);
  const message = buildStateMessage(meta, steps);

  for (const ws of ctx.getWebSockets(runId)) {
    const attachment = getSocketAttachment(ws);
    if (!attachment || attachment.runId !== runId) continue;

    try {
      sendStateMessage(ws, message);
    } catch (error) {
      logger.warn("run_state_socket_send_failed", {
        runId,
        userId: attachment.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      ws.close(1011, "state_delivery_failed");
    }
  }
};

export const broadcastLogEvents = (
  ctx: DurableObjectState,
  logger: Logger,
  runId: RunId,
  events: readonly RunLogRecord[],
): void => {
  if (events.length === 0) {
    return;
  }

  for (const ws of ctx.getWebSockets(runId)) {
    const attachment = getSocketAttachment(ws);
    if (!attachment || attachment.runId !== runId) {
      continue;
    }

    try {
      for (const event of events) {
        sendLogEvent(ws, event);
      }
    } catch (error) {
      logger.warn("run_log_socket_send_failed", {
        runId,
        userId: attachment.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      ws.close(1011, "log_delivery_failed");
    }
  }
};

export const handleRunLogStreamFetch = async (
  ctx: DurableObjectState,
  db: RunDb,
  request: Request,
): Promise<Response> => {
  const auth = readInternalRunLogAuth(request);
  if (!auth) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const match = /^\/api\/private\/runs\/([^/]+)\/logs$/u.exec(url.pathname);
  if (request.method !== "GET" || !match) {
    return new Response("Not found", { status: 404 });
  }

  let runId: RunId;
  try {
    runId = RunId.assertDecode(match[1]);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  if (runId !== auth.runId) {
    return new Response("Forbidden", { status: 403 });
  }

  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  server.serializeAttachment({
    runId,
    userId: auth.userId,
    connectedAt: Date.now(),
    lastAckedSeq: null,
  } satisfies RunLogSocketAttachment);
  ctx.acceptWebSocket(server, [runId]);

  for (const event of await listRunLogs(db, runId)) {
    sendLogEvent(server, event);
  }

  const meta = await getRunMeta(db, runId);
  if (meta) {
    const steps = await listRunSteps(db, runId);
    sendStateMessage(server, buildStateMessage(meta, steps));
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
};

export const logRunSocketError = (logger: Logger, ws: WebSocket, error: unknown): void => {
  const attachment = getSocketAttachment(ws);
  logger.warn("run_log_socket_error", {
    runId: attachment?.runId ?? null,
    userId: attachment?.userId ?? null,
    error: error instanceof Error ? error.message : String(error),
  });
};
