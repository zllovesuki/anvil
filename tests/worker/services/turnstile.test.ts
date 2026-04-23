import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_REQUIRED_MESSAGE,
  TURNSTILE_UNAVAILABLE_MESSAGE,
  verifyTurnstileToken,
} from "@/worker/services/turnstile";

const fetchMock = vi.fn<typeof fetch>();

const requestOptions = {
  expectedAction: "login",
  remoteIp: "203.0.113.10",
  requestUrl: "https://anvil.devbin.tools/api/public/auth/login",
  token: "turnstile-token",
};

const makeEnv = (secret?: string) =>
  ({
    TURNSTILE_SECRET_KEY: secret,
  }) as Env;

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
    },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTurnstileToken", () => {
  it("fails closed when the secret is missing", async () => {
    const result = await verifyTurnstileToken(makeEnv(), requestOptions);

    expect(result).toEqual({
      ok: false,
      errorCodes: [],
      message: TURNSTILE_UNAVAILABLE_MESSAGE,
      reason: "missing_secret",
      status: 503,
    });
  });

  it("rejects missing tokens", async () => {
    const result = await verifyTurnstileToken(makeEnv("secret"), {
      ...requestOptions,
      token: "   ",
    });

    expect(result).toEqual({
      ok: false,
      errorCodes: [],
      message: TURNSTILE_REQUIRED_MESSAGE,
      reason: "missing_token",
      status: 400,
    });
  });

  it("accepts loopback requests with official testing secrets without siteverify", async () => {
    const result = await verifyTurnstileToken(makeEnv("1x0000000000000000000000000000000AA"), {
      ...requestOptions,
      requestUrl: "http://127.0.0.1:4173/api/public/auth/login",
    });

    expect(result).toEqual({
      ok: true,
      response: {
        success: true,
        action: "test",
        hostname: "127.0.0.1",
        metadata: {
          result_with_testing_key: true,
        },
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the siteverify request fails", async () => {
    fetchMock.mockRejectedValue(new Error("network failure"));

    const result = await verifyTurnstileToken(makeEnv("secret"), requestOptions);

    expect(result).toEqual({
      ok: false,
      errorCodes: [],
      message: TURNSTILE_UNAVAILABLE_MESSAGE,
      reason: "siteverify_request_failed",
      status: 503,
    });
  });

  it("returns 503 when siteverify returns invalid json", async () => {
    fetchMock.mockResolvedValue(
      new Response("{", {
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const result = await verifyTurnstileToken(makeEnv("secret"), requestOptions);

    expect(result).toEqual({
      ok: false,
      errorCodes: [],
      message: TURNSTILE_UNAVAILABLE_MESSAGE,
      reason: "siteverify_invalid_json",
      status: 503,
    });
  });

  it("returns 503 when the payload shape is invalid", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ invalid: true }));

    const result = await verifyTurnstileToken(makeEnv("secret"), requestOptions);

    expect(result).toEqual({
      ok: false,
      errorCodes: [],
      message: TURNSTILE_UNAVAILABLE_MESSAGE,
      reason: "siteverify_invalid_payload",
      status: 503,
    });
  });

  it("returns 403 when verification is unsuccessful", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: false,
        "error-codes": ["invalid-input-response"],
      }),
    );

    const result = await verifyTurnstileToken(makeEnv("secret"), requestOptions);

    expect(result).toEqual({
      ok: false,
      errorCodes: ["invalid-input-response"],
      message: TURNSTILE_REQUIRED_MESSAGE,
      reason: "verification_failed",
      status: 403,
    });
  });

  it("returns 403 when the verified action does not match", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        action: "accept_invite",
        hostname: "anvil.devbin.tools",
      }),
    );

    const result = await verifyTurnstileToken(makeEnv("secret"), requestOptions);

    expect(result).toEqual({
      ok: false,
      errorCodes: [],
      message: TURNSTILE_REQUIRED_MESSAGE,
      reason: "action_mismatch",
      status: 403,
    });
  });

  it("returns 403 when the verified hostname does not match", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        action: "login",
        hostname: "evil.example",
      }),
    );

    const result = await verifyTurnstileToken(makeEnv("secret"), requestOptions);

    expect(result).toEqual({
      ok: false,
      errorCodes: [],
      message: TURNSTILE_REQUIRED_MESSAGE,
      reason: "hostname_mismatch",
      status: 403,
    });
  });
});
