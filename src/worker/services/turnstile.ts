import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

export const TURNSTILE_REQUIRED_MESSAGE = "Human verification failed. Please try again.";
export const TURNSTILE_UNAVAILABLE_MESSAGE = "Human verification is temporarily unavailable.";

const TURNSTILE_TEST_SECRET_KEYS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const TurnstileSiteverifyResponse = eg.object({
  success: eg.boolean,
  action: eg.string.optional,
  hostname: eg.string.optional,
  "error-codes": eg.array(eg.string).optional,
  metadata: eg.object({
    result_with_testing_key: eg.boolean.optional,
  }).optional,
});
type TurnstileSiteverifyResponse = TypeFromCodec<typeof TurnstileSiteverifyResponse>;

type TurnstileFailureStatus = 400 | 403 | 503;

export type TurnstileVerificationResult =
  | {
      ok: true;
      response: TurnstileSiteverifyResponse;
    }
  | {
      ok: false;
      errorCodes: string[];
      message: string;
      reason: string;
      status: TurnstileFailureStatus;
    };

interface VerifyTurnstileTokenOptions {
  expectedAction: string;
  remoteIp?: string | null;
  requestUrl: string;
  token: string;
}

const isLoopbackHostname = (hostname: string): boolean => LOOPBACK_HOSTNAMES.has(hostname);

const isTestingSecret = (secret: string): boolean => TURNSTILE_TEST_SECRET_KEYS.has(secret);

const isTestingKeyResponse = (secret: string, verification: TurnstileSiteverifyResponse): boolean =>
  isTestingSecret(secret) &&
  (verification.action === "test" ||
    (verification.metadata?.result_with_testing_key === true && verification.action === undefined));

export async function verifyTurnstileToken(
  env: Env,
  options: VerifyTurnstileTokenOptions,
): Promise<TurnstileVerificationResult> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  const token = options.token.trim();

  if (!secret) {
    return {
      ok: false,
      errorCodes: [],
      message: TURNSTILE_UNAVAILABLE_MESSAGE,
      reason: "missing_secret",
      status: 503,
    };
  }

  if (!token) {
    return {
      ok: false,
      errorCodes: [],
      message: TURNSTILE_REQUIRED_MESSAGE,
      reason: "missing_token",
      status: 400,
    };
  }

  const requestHostname = new URL(options.requestUrl).hostname;
  if (isTestingSecret(secret) && isLoopbackHostname(requestHostname)) {
    return {
      ok: true,
      response: {
        success: true,
        action: "test",
        hostname: requestHostname,
        metadata: {
          result_with_testing_key: true,
        },
      },
    };
  }

  let response: Response;

  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        secret,
        response: token,
        ...(options.remoteIp ? { remoteip: options.remoteIp } : {}),
      }),
    });
  } catch {
    return {
      ok: false,
      errorCodes: [],
      message: TURNSTILE_UNAVAILABLE_MESSAGE,
      reason: "siteverify_request_failed",
      status: 503,
    };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      errorCodes: [],
      message: TURNSTILE_UNAVAILABLE_MESSAGE,
      reason: "siteverify_invalid_json",
      status: 503,
    };
  }

  let verification: TurnstileSiteverifyResponse;

  try {
    verification = TurnstileSiteverifyResponse.assertDecode(payload);
  } catch {
    return {
      ok: false,
      errorCodes: [],
      message: TURNSTILE_UNAVAILABLE_MESSAGE,
      reason: "siteverify_invalid_payload",
      status: 503,
    };
  }

  if (!verification.success) {
    return {
      ok: false,
      errorCodes: verification["error-codes"] ?? [],
      message: TURNSTILE_REQUIRED_MESSAGE,
      reason: "verification_failed",
      status: 403,
    };
  }

  if (!isTestingKeyResponse(secret, verification) && verification.action !== options.expectedAction) {
    return {
      ok: false,
      errorCodes: verification["error-codes"] ?? [],
      message: TURNSTILE_REQUIRED_MESSAGE,
      reason: "action_mismatch",
      status: 403,
    };
  }

  if (
    !isTestingKeyResponse(secret, verification) &&
    verification.hostname &&
    verification.hostname !== requestHostname
  ) {
    return {
      ok: false,
      errorCodes: verification["error-codes"] ?? [],
      message: TURNSTILE_REQUIRED_MESSAGE,
      reason: "hostname_mismatch",
      status: 403,
    };
  }

  return {
    ok: true,
    response: verification,
  };
}
