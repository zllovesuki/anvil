import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { toCodecIssueDetails } from "@/lib/codec-errors";

export class HttpError extends Error {
  public readonly status: ContentfulStatusCode;
  public readonly code: string;
  public readonly details: unknown;

  public constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const parseJson = async <T>(request: Request, codec: { assertDecode: (value: unknown) => T }): Promise<T> => {
  let payload: unknown;

  try {
    payload = (await request.json()) as unknown;
  } catch (error) {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.", error);
  }

  try {
    return codec.assertDecode(payload);
  } catch (error) {
    throw new HttpError(400, "invalid_request", "Request body failed validation.", toCodecIssueDetails(error));
  }
};

export const toErrorResponse = (c: Context, error: unknown): Response => {
  if (error instanceof HttpError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
      error.status,
    );
  }

  return c.json(
    {
      error: {
        code: "internal_error",
        message: "An unexpected error occurred.",
      },
    },
    500,
  );
};
