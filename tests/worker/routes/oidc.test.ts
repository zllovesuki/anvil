import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { generateSignedCookie } from "hono/cookie";
import { parseSigned } from "hono/utils/cookie";
import * as oidc from "openid-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __test,
  OIDC_TX_COOKIE,
  OIDC_TX_COOKIE_MAX_AGE_SECONDS,
  OIDC_TX_COOKIE_NAME,
  decodeTxCookiePayload,
  deriveTxCookieSecret,
  encodeTxCookiePayload,
  getTxCookieSecret,
  type TxCookiePayload,
} from "@/worker/auth/oidc";
import * as d1Schema from "@/worker/db/d1/schema";

import { getDb, seedUser, type SeededUser } from "../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";

const ISSUER = "https://tessera.test";
const CLIENT_ID = "anvil-test";
const CLIENT_SECRET = "anvil-test-secret";
const CALLBACK_ORIGIN = "https://example.com";
const REDIRECT_URI = `${CALLBACK_ORIGIN}/api/public/oidc/callback`;
const STATE = "test-state";
const NONCE = "test-nonce";

const buildConfig = (): oidc.Configuration =>
  new oidc.Configuration(
    {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ["code"],
    },
    CLIENT_ID,
    CLIENT_SECRET,
  );

const buildClaims = (overrides: Partial<oidc.IDToken> = {}): oidc.IDToken =>
  ({
    iss: ISSUER,
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    sub: "tessera-sub-1",
    email: "operator@example.com",
    email_verified: true,
    name: "Test Operator",
    ...overrides,
  }) as oidc.IDToken;

const stubClaims = (claims: oidc.IDToken | undefined): void => {
  __test.setAuthorizationCodeGrantImpl(async () => ({
    claims: () => claims,
  }));
};

const stubTokenExchangeFailure = (): void => {
  __test.setAuthorizationCodeGrantImpl(async () => {
    throw new Error("provider failed");
  });
};

const txCookiePayload = (overrides: Partial<TxCookiePayload> = {}): TxCookiePayload => ({
  state: STATE,
  nonce: NONCE,
  codeVerifier: "test-code-verifier",
  redirectUri: REDIRECT_URI,
  returnTo: "/app/projects",
  createdAt: Date.now(),
  ...overrides,
});

const buildTxCookieHeader = async (
  overrides: Partial<TxCookiePayload> = {},
  secret?: BufferSource,
): Promise<string> => {
  const txCookieSecret = secret ?? (await getTxCookieSecret(env));
  const setCookie = await generateSignedCookie(
    OIDC_TX_COOKIE_NAME,
    encodeTxCookiePayload(txCookiePayload(overrides)),
    txCookieSecret,
    {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: OIDC_TX_COOKIE_MAX_AGE_SECONDS,
      prefix: "host",
    },
  );
  return setCookie.split(";", 1)[0] ?? setCookie;
};

const extractSetCookiePair = (setCookie: string | null, name: string): string => {
  const cookie = setCookie
    ?.split(/,(?=\s*[^;=]+=[^;]+)/u)
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!cookie) {
    throw new Error(`Missing ${name} cookie.`);
  }

  return cookie.split(";", 1)[0] ?? cookie;
};

const decodeStartTxCookie = async (response: Response): Promise<TxCookiePayload> => {
  const cookie = extractSetCookiePair(response.headers.get("set-cookie"), OIDC_TX_COOKIE);
  const parsed = await parseSigned(cookie, await getTxCookieSecret(env), OIDC_TX_COOKIE);
  const payload = decodeTxCookiePayload(parsed[OIDC_TX_COOKIE]);

  if (!payload) {
    throw new Error("OIDC transaction cookie did not decode.");
  }

  return payload;
};

const callbackWithClaims = async (
  claims: oidc.IDToken,
  options: {
    state?: string;
    txCookie?: string;
    txOverrides?: Partial<TxCookiePayload>;
  } = {},
): Promise<Response> => {
  stubClaims(claims);
  return await SELF.fetch(`${CALLBACK_ORIGIN}/api/public/oidc/callback?code=code&state=${options.state ?? STATE}`, {
    redirect: "manual",
    headers: {
      cookie: options.txCookie ?? (await buildTxCookieHeader(options.txOverrides)),
    },
  });
};

const insertIdentity = async (sub: string, userId: string): Promise<void> => {
  await getDb().insert(d1Schema.tesseraIdentities).values({
    sub,
    userId,
    createdAt: Date.now(),
    lastSeenAt: null,
  });
};

const disableUser = async (user: SeededUser): Promise<void> => {
  await getDb().update(d1Schema.users).set({ disabledAt: Date.now() }).where(eq(d1Schema.users.id, user.id));
};

const findUserByEmail = async (email: string) => {
  const rows = await getDb().select().from(d1Schema.users).where(eq(d1Schema.users.email, email));
  return rows[0];
};

const findIdentitiesBySub = async (sub: string) =>
  await getDb().select().from(d1Schema.tesseraIdentities).where(eq(d1Schema.tesseraIdentities.sub, sub));

const expectLoginError = (response: Response, code: string): void => {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`/app/login?error=${code}`);
};

describe("OIDC routes", () => {
  registerWorkerRuntimeHooks();

  beforeEach(() => {
    __test.setProviderForTesting(ISSUER, buildConfig());
  });

  afterEach(() => {
    __test.clear();
  });

  it("starts authorization with PKCE and a sanitized transaction cookie", async () => {
    const response = await SELF.fetch(`${CALLBACK_ORIGIN}/api/public/oidc/start?return_to=https%3A%2F%2Fevil.test`, {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const authorizationUrl = new URL(location!);
    expect(authorizationUrl.origin).toBe(ISSUER);
    expect(authorizationUrl.pathname).toBe("/authorize");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("state")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("nonce")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain(`${OIDC_TX_COOKIE}=`);

    const payload = await decodeStartTxCookie(response);
    expect(payload.returnTo).toBe("/app/projects");
    expect(payload.redirectUri).toBe(REDIRECT_URI);
  });

  it("signs in an existing bound tessera identity", async () => {
    const user = await seedUser({
      email: "operator@example.com",
      slug: "oidc-existing",
    });
    await insertIdentity("tessera-sub-1", user.id);

    const response = await callbackWithClaims(buildClaims());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/projects?oidc=1");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Host-anvil_session=");
    expect(setCookie).toContain(`${OIDC_TX_COOKIE}=; Max-Age=0`);

    const identity = await findIdentitiesBySub("tessera-sub-1");
    expect(identity[0]?.lastSeenAt).toEqual(expect.any(Number));
  });

  it("updates email for an existing bound identity when the new verified email is free", async () => {
    const user = await seedUser({
      email: "old-operator@example.com",
      slug: "oidc-email-update",
    });
    await insertIdentity("tessera-email-update-sub", user.id);

    const response = await callbackWithClaims(
      buildClaims({
        sub: "tessera-email-update-sub",
        email: "new-operator@example.com",
      }),
    );

    expect(response.status).toBe(302);
    const updated = await findUserByEmail("new-operator@example.com");
    expect(updated?.id).toBe(user.id);
    expect(await findUserByEmail("old-operator@example.com")).toBeUndefined();
  });

  it("rejects an existing bound identity when the new verified email belongs to another user", async () => {
    const boundUser = await seedUser({
      email: "bound-operator@example.com",
      slug: "oidc-email-conflict-bound",
    });
    await seedUser({
      email: "claimed-operator@example.com",
      slug: "oidc-email-conflict-claimed",
    });
    await insertIdentity("tessera-email-conflict-sub", boundUser.id);

    const response = await callbackWithClaims(
      buildClaims({
        sub: "tessera-email-conflict-sub",
        email: "claimed-operator@example.com",
      }),
    );

    expectLoginError(response, "tessera_email_conflict");
    expect((await findUserByEmail("bound-operator@example.com"))?.id).toBe(boundUser.id);
  });

  it("rejects an existing bound identity when the user is disabled", async () => {
    const user = await seedUser({
      email: "disabled-bound@example.com",
      slug: "disabled-bound",
    });
    await disableUser(user);
    await insertIdentity("disabled-bound-sub", user.id);

    const response = await callbackWithClaims(
      buildClaims({
        sub: "disabled-bound-sub",
        email: "disabled-bound@example.com",
      }),
    );

    expectLoginError(response, "user_disabled");
  });

  it("binds a new tessera sub to an unbound legacy user by verified email", async () => {
    const user = await seedUser({
      email: "legacy-operator@example.com",
      slug: "legacy-operator",
    });

    const response = await callbackWithClaims(
      buildClaims({
        sub: "legacy-bind-sub",
        email: "legacy-operator@example.com",
      }),
    );

    expect(response.status).toBe(302);
    const identities = await findIdentitiesBySub("legacy-bind-sub");
    expect(identities).toHaveLength(1);
    expect(identities[0]?.userId).toBe(user.id);
    expect(identities[0]?.createdAt).toEqual(expect.any(Number));
    expect(identities[0]?.lastSeenAt).toEqual(expect.any(Number));
  });

  it("keeps concurrent legacy binding attempts idempotent for the same sub and user", async () => {
    const user = await seedUser({
      email: "legacy-race@example.com",
      slug: "legacy-race",
    });
    const claims = buildClaims({
      sub: "legacy-race-sub",
      email: "legacy-race@example.com",
    });

    const [first, second] = await Promise.all([callbackWithClaims(claims), callbackWithClaims(claims)]);

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    const identities = await findIdentitiesBySub("legacy-race-sub");
    expect(identities).toHaveLength(1);
    expect(identities[0]?.userId).toBe(user.id);
  });

  it("rejects a new tessera sub when the matching user is already bound to another sub", async () => {
    const user = await seedUser({
      email: "already-bound@example.com",
      slug: "already-bound",
    });
    await insertIdentity("existing-bound-sub", user.id);

    const response = await callbackWithClaims(
      buildClaims({
        sub: "new-conflicting-sub",
        email: "already-bound@example.com",
      }),
    );

    expectLoginError(response, "identity_conflict");
    expect(await findIdentitiesBySub("new-conflicting-sub")).toHaveLength(0);
  });

  it("rejects a new tessera sub when the matching legacy user is disabled", async () => {
    const user = await seedUser({
      email: "disabled-legacy@example.com",
      slug: "disabled-legacy",
    });
    await disableUser(user);

    const response = await callbackWithClaims(
      buildClaims({
        sub: "disabled-legacy-sub",
        email: "disabled-legacy@example.com",
      }),
    );

    expectLoginError(response, "user_disabled");
    expect(await findIdentitiesBySub("disabled-legacy-sub")).toHaveLength(0);
  });

  it("creates a user and identity for a new verified tessera identity", async () => {
    const response = await callbackWithClaims(
      buildClaims({
        sub: "new-user-sub",
        email: "new-user@example.com",
      }),
    );

    expect(response.status).toBe(302);
    const user = await findUserByEmail("new-user@example.com");
    expect(user?.id).toMatch(/^usr_[0-9A-Za-z]{22}$/u);
    expect(user?.slug).toBe("new-user");
    const identities = await findIdentitiesBySub("new-user-sub");
    expect(identities).toHaveLength(1);
    expect(identities[0]?.userId).toBe(user?.id);
    expect(identities[0]?.createdAt).toEqual(expect.any(Number));
    expect(identities[0]?.lastSeenAt).toEqual(expect.any(Number));
  });

  it("retries auto-provisioning with the user-id suffix when the preferred slug is taken", async () => {
    await seedUser({
      email: "slug-owner@example.com",
      slug: "first-last",
    });

    const response = await callbackWithClaims(
      buildClaims({
        sub: "slug-fallback-sub",
        email: "slug-fallback@example.com",
        preferred_username: "First Last!",
      }),
    );

    expect(response.status).toBe(302);
    const user = await findUserByEmail("slug-fallback@example.com");
    expect(user?.slug).toMatch(/^first-last-[0-9A-Za-z]{6}$/u);
    expect(user?.slug.endsWith(user.id.slice(-6))).toBe(true);
  });

  it("falls back to usr suffix when slug sources clean to empty", async () => {
    const response = await callbackWithClaims(
      buildClaims({
        sub: "empty-slug-sub",
        email: "!!!@example.com",
        name: undefined,
      }),
    );

    expect(response.status).toBe(302);
    const user = await findUserByEmail("!!!@example.com");
    expect(user?.slug).toMatch(/^usr-[0-9A-Za-z]{6}$/u);
    expect(user?.slug).toBe(`usr-${user?.id.slice(-6)}`);
  });

  it("keeps concurrent auto-provision attempts idempotent for the same sub", async () => {
    const claims = buildClaims({
      sub: "auto-race-sub",
      email: "auto-race@example.com",
    });

    const [first, second] = await Promise.all([callbackWithClaims(claims), callbackWithClaims(claims)]);

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    const identities = await findIdentitiesBySub("auto-race-sub");
    expect(identities).toHaveLength(1);
    const users = await getDb().select().from(d1Schema.users).where(eq(d1Schema.users.email, "auto-race@example.com"));
    expect(users).toHaveLength(1);
    expect(identities[0]?.userId).toBe(users[0]?.id);
  });

  it("redirects failed claim validation without writing users or identities", async () => {
    const rejectedSub = "tessera-rejected-sub";
    const rejectedEmail = "rejected-operator@example.com";
    const response = await callbackWithClaims(
      buildClaims({
        sub: rejectedSub,
        email: rejectedEmail,
        email_verified: false,
      }),
    );

    expectLoginError(response, "oidc_unverified_email");
    expect(await findUserByEmail(rejectedEmail)).toBeUndefined();
    expect(await findIdentitiesBySub(rejectedSub)).toHaveLength(0);
  });

  it("rejects missing, tampered, wrong-secret, and state-mismatched transaction cookies without DB writes", async () => {
    const rejectedSub = "tx-rejected-sub";
    const rejectedEmail = "tx-rejected@example.com";
    const claims = buildClaims({ sub: rejectedSub, email: rejectedEmail });
    stubClaims(claims);

    const missing = await SELF.fetch(`${CALLBACK_ORIGIN}/api/public/oidc/callback?code=code&state=${STATE}`, {
      redirect: "manual",
    });
    expectLoginError(missing, "oidc_session_expired");

    const tampered = await callbackWithClaims(claims, {
      txCookie: `${await buildTxCookieHeader()}x`,
    });
    expectLoginError(tampered, "oidc_session_expired");

    const wrongSecret = await callbackWithClaims(claims, {
      txCookie: await buildTxCookieHeader({}, await deriveTxCookieSecret("wrong-secret")),
    });
    expectLoginError(wrongSecret, "oidc_session_expired");

    const wrongState = await callbackWithClaims(claims, { state: "wrong-state" });
    expectLoginError(wrongState, "oidc_session_expired");

    expect(await findUserByEmail(rejectedEmail)).toBeUndefined();
    expect(await findIdentitiesBySub(rejectedSub)).toHaveLength(0);
  });

  it("redirects provider failures without DB writes", async () => {
    stubTokenExchangeFailure();

    const response = await SELF.fetch(`${CALLBACK_ORIGIN}/api/public/oidc/callback?code=code&state=${STATE}`, {
      redirect: "manual",
      headers: {
        cookie: await buildTxCookieHeader(),
      },
    });

    expectLoginError(response, "oidc_provider_error");
    expect(await findUserByEmail("provider-failure@example.com")).toBeUndefined();
  });
});
