import { RunId, UserId } from "@/contracts";

const INTERNAL_RUN_LOG_AUTH_VALUE = "anvil-run-logs-v1";

export const INTERNAL_RUN_LOG_AUTH_HEADER = "x-anvil-run-log-auth";
export const INTERNAL_RUN_LOG_RUN_ID_HEADER = "x-anvil-run-log-run-id";
export const INTERNAL_RUN_LOG_USER_ID_HEADER = "x-anvil-run-log-user-id";

export const createInternalRunLogHeaders = (baseHeaders: HeadersInit, runId: RunId, userId: UserId): Headers => {
  const headers = new Headers(baseHeaders);
  headers.set(INTERNAL_RUN_LOG_AUTH_HEADER, INTERNAL_RUN_LOG_AUTH_VALUE);
  headers.set(INTERNAL_RUN_LOG_RUN_ID_HEADER, runId);
  headers.set(INTERNAL_RUN_LOG_USER_ID_HEADER, userId);

  return headers;
};

export const readInternalRunLogAuth = (request: Request): { runId: RunId; userId: UserId } | null => {
  if (request.headers.get(INTERNAL_RUN_LOG_AUTH_HEADER) !== INTERNAL_RUN_LOG_AUTH_VALUE) {
    return null;
  }

  try {
    return {
      runId: RunId.assertDecode(request.headers.get(INTERNAL_RUN_LOG_RUN_ID_HEADER)),
      userId: UserId.assertDecode(request.headers.get(INTERNAL_RUN_LOG_USER_ID_HEADER)),
    };
  } catch {
    return null;
  }
};
