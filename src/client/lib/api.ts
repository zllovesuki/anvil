import { ApiError, type ApiClient } from "@/client/lib/api-contract";
import { createLiveApiClient } from "@/client/lib/live-api";
import { createMockApiClient } from "@/client/lib/mock-api";
import type { AuthMode } from "@/client/lib/storage";
import { formatCodecIssues } from "@/lib/codec-errors";

export const getApiClient = (mode: AuthMode): ApiClient =>
  mode === "live" ? createLiveApiClient() : createMockApiClient();

export const formatApiError = (error: unknown): string => {
  if (error instanceof ApiError) {
    return formatCodecIssues(error.details) ?? error.message;
  }

  const codecMessage = formatCodecIssues(error);
  if (codecMessage) {
    return codecMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred.";
};
