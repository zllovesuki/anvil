import type { AppContext } from "@/worker/hono";
import { createLogger, encodeHex, hashSha256 } from "@/worker/services";
import { normalizeEmailAddress } from "@/worker/validation";

const RATE_LIMIT_RETRY_AFTER_SECONDS = "60";
const RATE_LIMIT_ERROR_CODE = "rate_limited";
const RATE_LIMIT_ERROR_MESSAGE = "Too many requests. Try again later.";

const logger = createLogger("worker.security.rate-limit");

const buildRateLimitedResponse = (c: AppContext): Response => {
  const response = c.json(
    {
      error: {
        code: RATE_LIMIT_ERROR_CODE,
        message: RATE_LIMIT_ERROR_MESSAGE,
        details: null,
      },
    },
    429,
  );
  response.headers.set("retry-after", RATE_LIMIT_RETRY_AFTER_SECONDS);
  return response;
};

const maybeEnforceRateLimit = async (
  c: AppContext,
  binding: RateLimit,
  limiter: "PUBLIC_LOGIN_RATE_LIMITER" | "PUBLIC_INVITE_ACCEPT_RATE_LIMITER",
  key: string,
): Promise<Response | null> => {
  const { success } = await binding.limit({ key });

  if (success) {
    return null;
  }

  logger.warn("public_rate_limited", {
    method: c.req.method,
    path: c.req.path,
    limiter,
  });
  return buildRateLimitedResponse(c);
};

export const enforcePublicLoginRateLimit = async (c: AppContext, email: string): Promise<Response | null> => {
  const normalizedEmail = normalizeEmailAddress(email);
  const emailHash = await hashSha256(normalizedEmail);

  return maybeEnforceRateLimit(
    c,
    c.env.PUBLIC_LOGIN_RATE_LIMITER,
    "PUBLIC_LOGIN_RATE_LIMITER",
    `login:${encodeHex(emailHash)}`,
  );
};

export const enforcePublicInviteAcceptRateLimit = async (
  c: AppContext,
  tokenHash: Uint8Array,
): Promise<Response | null> =>
  maybeEnforceRateLimit(
    c,
    c.env.PUBLIC_INVITE_ACCEPT_RATE_LIMITER,
    "PUBLIC_INVITE_ACCEPT_RATE_LIMITER",
    `invite_accept:${encodeHex(tokenHash)}`,
  );
