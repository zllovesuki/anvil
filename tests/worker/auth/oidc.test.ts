import type { IDToken } from "openid-client";
import { describe, expect, it } from "vitest";

import {
  appendOidcMarker,
  decodeTxCookiePayload,
  deriveTxCookieSecret,
  encodeTxCookiePayload,
  sanitizeReturnTo,
  validateClaims,
  validateIssuerUrl,
  type TxCookiePayload,
} from "@/worker/auth/oidc";
import { generateUserSlug } from "@/worker/api/public/oidc";

const buildPayload = (overrides: Partial<TxCookiePayload> = {}): TxCookiePayload => ({
  state: "state",
  nonce: "nonce",
  codeVerifier: "verifier",
  redirectUri: "https://example.com/api/public/oidc/callback",
  returnTo: "/app/projects",
  createdAt: Date.now(),
  ...overrides,
});

const claims = (overrides: Partial<IDToken>): IDToken =>
  ({
    iss: "https://tessera.test",
    aud: "anvil-test",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  }) as IDToken;

describe("OIDC helpers", () => {
  it("validates issuer URLs with loopback HTTP allowance", () => {
    expect(validateIssuerUrl("https://auth.example.com").origin).toBe("https://auth.example.com");
    expect(validateIssuerUrl("http://127.0.0.1:5174").origin).toBe("http://127.0.0.1:5174");

    expect(() => validateIssuerUrl(undefined)).toThrow(/TESSERA_OIDC_ISSUER/u);
    expect(() => validateIssuerUrl("ftp://auth.example.com")).toThrow(/http\(s\)/u);
    expect(() => validateIssuerUrl("http://auth.example.com")).toThrow(/https unless loopback/u);
  });

  it("encodes, expires, and rejects invalid tx cookie payloads", () => {
    const encoded = encodeTxCookiePayload(buildPayload());
    expect(decodeTxCookiePayload(encoded)).toMatchObject({
      state: "state",
      nonce: "nonce",
      returnTo: "/app/projects",
    });

    expect(decodeTxCookiePayload(`${encoded.slice(0, -2)}xx`)).toBeNull();
    expect(decodeTxCookiePayload("not-base64")).toBeNull();
    expect(decodeTxCookiePayload(false)).toBeNull();
    expect(
      decodeTxCookiePayload(encodeTxCookiePayload(buildPayload({ createdAt: Date.now() - 10 * 60 * 1000 }))),
    ).toBeNull();
  });

  it("derives stable HKDF tx cookie signing keys", async () => {
    const first = await deriveTxCookieSecret("client-secret");
    const second = await deriveTxCookieSecret("client-secret");
    const different = await deriveTxCookieSecret("different-secret");

    expect(first.byteLength).toBe(32);
    expect(Array.from(new Uint8Array(second))).toEqual(Array.from(new Uint8Array(first)));
    expect(Array.from(new Uint8Array(different))).not.toEqual(Array.from(new Uint8Array(first)));
  });

  it("validates required verified email claims", () => {
    expect(
      validateClaims(
        claims({
          sub: "sub-1",
          email: "USER@EXAMPLE.COM",
          email_verified: true,
        }),
      ),
    ).toMatchObject({
      ok: true,
      claims: {
        sub: "sub-1",
        email: "user@example.com",
      },
    });

    expect(validateClaims(undefined)).toEqual({ ok: false, code: "oidc_unverified_email" });
    expect(validateClaims(claims({ sub: "sub-1", email: "user@example.com", email_verified: false }))).toEqual({
      ok: false,
      code: "oidc_unverified_email",
    });
    expect(validateClaims(claims({ sub: "", email: "user@example.com", email_verified: true }))).toEqual({
      ok: false,
      code: "oidc_unverified_email",
    });
  });

  it("sanitizes return paths and appends the OIDC marker", () => {
    expect(sanitizeReturnTo("/app/projects?view=mine")).toBe("/app/projects?view=mine");
    expect(sanitizeReturnTo("https://evil.example/app")).toBe("/app/projects");
    expect(sanitizeReturnTo("//evil.example/app")).toBe("/app/projects");
    expect(appendOidcMarker("/app/projects?view=mine#top")).toBe("/app/projects?view=mine&oidc=1#top");
  });

  it("generates OwnerSlug-safe slugs from tessera claims", () => {
    const claims = {
      sub: "sub-1",
      email: "First.Last@example.com",
      email_verified: true,
      preferredUsername: "First Last!",
    } as const;

    expect(generateUserSlug(claims, "usr_0000000000000000ABCDEF", 0)).toBe("first-last");
    expect(generateUserSlug(claims, "usr_0000000000000000ABCDEF", 1)).toBe("first-last-ABCDEF");
    expect(
      generateUserSlug(
        {
          sub: "sub-1",
          email: "@example.com",
          email_verified: true,
        },
        "usr_0000000000000000ABCDEF",
        0,
      ),
    ).toBe("usr-ABCDEF");
  });
});
