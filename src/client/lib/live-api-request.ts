import { ApiError } from "@/client/lib/api-contract";
import { getStoredBookmark, getStoredSessionId, setStoredBookmark } from "@/client/lib/storage";

export const D1_BOOKMARK_HEADER = "x-anvil-d1-bookmark";
export const SESSION_EXPIRED_EVENT = "anvil:session-expired";

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export interface RequestOptions<T> {
  path: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  includeAuth?: boolean;
  decode?: (value: unknown) => T;
}

const parseErrorResponse = async (response: Response): Promise<ApiError> => {
  let payload: ErrorEnvelope | null = null;

  try {
    payload = (await response.json()) as ErrorEnvelope;
  } catch {
    payload = null;
  }

  return new ApiError(
    response.status,
    payload?.error?.code ?? `http_${response.status}`,
    payload?.error?.message ?? `Request failed with status ${response.status}.`,
    payload?.error?.details,
  );
};

export const request = async <T>({
  path,
  method,
  body,
  includeAuth = false,
  decode,
}: RequestOptions<T>): Promise<T> => {
  const headers = new Headers({
    accept: "application/json",
  });

  const bookmark = getStoredBookmark();
  if (bookmark) {
    headers.set(D1_BOOKMARK_HEADER, bookmark);
  }

  if (body !== undefined) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  if (includeAuth) {
    const sessionId = getStoredSessionId();
    if (!sessionId) {
      throw new ApiError(403, "invalid_session", "Session is missing or expired.");
    }

    headers.set("authorization", `Bearer ${sessionId}`);
  }

  let response: Response;

  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(
      503,
      "network_error",
      "Request failed. If the backend is not ready, switch to mock mode.",
      error,
    );
  }

  const nextBookmark = response.headers.get(D1_BOOKMARK_HEADER);
  if (nextBookmark) {
    setStoredBookmark(nextBookmark);
  }

  if (!response.ok) {
    const apiError = await parseErrorResponse(response);
    if (apiError.code === "invalid_session") {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw apiError;
  }

  if (!decode) {
    return undefined as T;
  }

  let payload: unknown;

  try {
    payload = (await response.json()) as unknown;
  } catch (error) {
    throw new ApiError(500, "invalid_response", "Server returned malformed JSON.", error);
  }

  try {
    return decode(payload);
  } catch (error) {
    throw new ApiError(500, "invalid_response", "Server response failed contract validation.", error);
  }
};
