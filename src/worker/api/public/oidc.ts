import { eq } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import * as oidc from "openid-client";

import { OwnerSlug } from "@/contracts";
import { createSession } from "@/worker/auth/sessions";
import {
  OIDC_SCOPE,
  OIDC_TX_COOKIE_NAME,
  OIDC_TX_COOKIE_MAX_AGE_SECONDS,
  appendOidcMarker,
  decodeTxCookiePayload,
  encodeTxCookiePayload,
  exchangeAuthorizationCode,
  getOidcConfig,
  getTxCookieSecret,
  oidcErrorContext,
  sanitizeReturnTo,
  validateClaims,
  type ResolvedClaims,
  type TxCookiePayload,
} from "@/worker/auth/oidc";
import { setSessionCookie } from "@/worker/auth/cookies";
import type { AppContext } from "@/worker/hono";
import { type D1DbExecutor, tesseraIdentities, users } from "@/worker/db/d1";
import { findIdentityByUserId, findUserByEmail, findUserIdBySub, insertIdentity } from "@/worker/db/d1/repositories";
import { createLogger, generateDurableEntityId } from "@/worker/services";
import { normalizeDisplayName } from "@/worker/validation";

const logger = createLogger("worker.oidc");
const TX_COOKIE_PREFIX = "host" as const;

const TX_COOKIE_OPTIONS = {
  path: "/" as const,
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  maxAge: OIDC_TX_COOKIE_MAX_AGE_SECONDS,
  prefix: TX_COOKIE_PREFIX,
};

const TX_COOKIE_CLEAR_OPTIONS = {
  path: "/" as const,
  secure: true,
  prefix: TX_COOKIE_PREFIX,
};

type BindSuccessKind = "signed_in" | "email_updated" | "bound_legacy" | "created" | "raced_to_existing";
type BindFailureCode = "tessera_email_conflict" | "identity_conflict" | "user_disabled";

type BindOutcome = { ok: true; kind: BindSuccessKind; userId: string } | { ok: false; code: BindFailureCode };

interface ExistingIdentityUser {
  userId: string;
  userEmail: string;
  disabledAt: number | null;
}

const UNIQUE_CONSTRAINT_PATTERN = /UNIQUE|SQLITE_CONSTRAINT/iu;
const UNIQUE_SLUG_PATTERN = /users\.slug|idx_users_slug/iu;

const isUniqueViolation = (error: unknown): boolean => {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return cause instanceof Error && UNIQUE_CONSTRAINT_PATTERN.test(cause.message);
};

const isSlugUniqueViolation = (error: unknown): boolean => {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return cause instanceof Error && UNIQUE_SLUG_PATTERN.test(cause.message);
};

const clearTxCookie = (c: AppContext): void => {
  deleteCookie(c, OIDC_TX_COOKIE_NAME, TX_COOKIE_CLEAR_OPTIONS);
};

const loginErrorRedirect = (c: AppContext, code: string): Response => {
  clearTxCookie(c);
  return c.redirect(`/app/login?error=${encodeURIComponent(code)}`, 302);
};

const buildRedirectUri = (requestUrl: string): string => `${new URL(requestUrl).origin}/api/public/oidc/callback`;

const findIdentityUserBySub = async (db: D1DbExecutor, sub: string): Promise<ExistingIdentityUser | undefined> => {
  const rows = await db
    .select({
      userId: users.id,
      userEmail: users.email,
      disabledAt: users.disabledAt,
    })
    .from(tesseraIdentities)
    .innerJoin(users, eq(tesseraIdentities.userId, users.id))
    .where(eq(tesseraIdentities.sub, sub))
    .limit(1);

  return rows[0];
};

const localPartFromEmail = (email: string): string => email.split("@", 1)[0] ?? "";

const displayNameFromClaims = (claims: ResolvedClaims): string => {
  const candidate = claims.name ?? claims.preferredUsername ?? localPartFromEmail(claims.email);
  return normalizeDisplayName(candidate.trim().length > 0 ? candidate : "anvil user");
};

const normalizeSlugCandidate = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");

export const generateUserSlug = (claims: ResolvedClaims, userId: string, attempt: number): OwnerSlug => {
  const suffix = userId.slice(-6);
  const sourceCandidates = [claims.preferredUsername, localPartFromEmail(claims.email), claims.name];
  const source = sourceCandidates.find((value) => value && value.trim().length > 0) ?? "";
  const base = normalizeSlugCandidate(source) || `usr-${suffix}`;
  const slug = attempt === 0 || base === `usr-${suffix}` ? base : `${base}-${suffix}`;

  return OwnerSlug.assertDecode(slug);
};

const updateExistingIdentity = async (
  db: D1DbExecutor,
  claims: ResolvedClaims,
  existing: ExistingIdentityUser,
  now: number,
): Promise<BindOutcome> => {
  if (existing.disabledAt !== null) {
    return { ok: false, code: "user_disabled" };
  }

  if (existing.userEmail === claims.email) {
    await db.update(tesseraIdentities).set({ lastSeenAt: now }).where(eq(tesseraIdentities.sub, claims.sub));
    return { ok: true, kind: "signed_in", userId: existing.userId };
  }

  const emailOwner = await findUserByEmail(db, claims.email);
  if (emailOwner && emailOwner.id !== existing.userId) {
    return { ok: false, code: "tessera_email_conflict" };
  }

  try {
    await db.batch([
      db.update(users).set({ email: claims.email }).where(eq(users.id, existing.userId)),
      db.update(tesseraIdentities).set({ lastSeenAt: now }).where(eq(tesseraIdentities.sub, claims.sub)),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, code: "tessera_email_conflict" };
    }

    throw error;
  }

  return { ok: true, kind: "email_updated", userId: existing.userId };
};

const bindLegacyUser = async (
  db: D1DbExecutor,
  claims: ResolvedClaims,
  userId: string,
  now: number,
): Promise<BindOutcome> => {
  const existingUserIdentity = await findIdentityByUserId(db, userId);
  if (existingUserIdentity) {
    return { ok: false, code: "identity_conflict" };
  }

  try {
    const inserted = await insertIdentity(db, {
      sub: claims.sub,
      userId,
      createdAt: now,
      lastSeenAt: now,
    });

    if (inserted) {
      return { ok: true, kind: "bound_legacy", userId };
    }
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  const recheckUserId = await findUserIdBySub(db, claims.sub);
  if (recheckUserId === userId) {
    return { ok: true, kind: "bound_legacy", userId };
  }

  return { ok: false, code: "identity_conflict" };
};

const createUserForIdentity = async (db: D1DbExecutor, claims: ResolvedClaims, now: number): Promise<BindOutcome> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const userId = generateDurableEntityId("usr", now + attempt);
    const slug = generateUserSlug(claims, userId, attempt);

    try {
      await db.batch([
        db.insert(users).values({
          id: userId,
          slug,
          email: claims.email,
          displayName: displayNameFromClaims(claims),
          createdAt: now,
          disabledAt: null,
        }),
        db.insert(tesseraIdentities).values({
          sub: claims.sub,
          userId,
          createdAt: now,
          lastSeenAt: now,
        }),
      ]);

      return { ok: true, kind: "created", userId };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const racedUserId = await findUserIdBySub(db, claims.sub);
      if (racedUserId) {
        return { ok: true, kind: "raced_to_existing", userId: racedUserId };
      }

      if (isSlugUniqueViolation(error) && attempt < 2) {
        continue;
      }

      return { ok: false, code: "identity_conflict" };
    }
  }

  return { ok: false, code: "identity_conflict" };
};

export const bindIdentity = async (db: D1DbExecutor, claims: ResolvedClaims): Promise<BindOutcome> => {
  const now = Date.now();
  const existing = await findIdentityUserBySub(db, claims.sub);

  if (existing) {
    return await updateExistingIdentity(db, claims, existing, now);
  }

  const legacyUser = await findUserByEmail(db, claims.email);
  if (legacyUser) {
    if (legacyUser.disabledAt !== null) {
      return { ok: false, code: "user_disabled" };
    }

    return await bindLegacyUser(db, claims, legacyUser.id, now);
  }

  return await createUserForIdentity(db, claims, now);
};

export const handleOidcStart = async (c: AppContext): Promise<Response> => {
  const returnTo = sanitizeReturnTo(c.req.query("return_to"));
  const redirectUri = buildRedirectUri(c.req.url);

  let config: oidc.Configuration;
  let txCookieSecret: ArrayBuffer;
  try {
    txCookieSecret = await getTxCookieSecret(c.env);
    config = await getOidcConfig(c.env);
  } catch (error) {
    logger.error("oidc_discovery_failed", oidcErrorContext(error, c.env));
    return loginErrorRedirect(c, "oidc_provider_error");
  }

  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const txPayload: TxCookiePayload = {
    state,
    nonce,
    codeVerifier,
    redirectUri,
    returnTo,
    createdAt: Date.now(),
  };

  await setSignedCookie(c, OIDC_TX_COOKIE_NAME, encodeTxCookiePayload(txPayload), txCookieSecret, TX_COOKIE_OPTIONS);

  const authorizationUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
    scope: OIDC_SCOPE,
  });

  logger.info("oidc_start", { returnTo });
  return c.redirect(authorizationUrl.toString(), 302);
};

export const handleOidcCallback = async (c: AppContext): Promise<Response> => {
  let txCookieValue: string | false | undefined;
  try {
    const txCookieSecret = await getTxCookieSecret(c.env);
    txCookieValue = await getSignedCookie(c, txCookieSecret, OIDC_TX_COOKIE_NAME, TX_COOKIE_PREFIX);
  } catch (error) {
    logger.error("oidc_cookie_read_failed", oidcErrorContext(error, c.env));
    return loginErrorRedirect(c, "oidc_provider_error");
  }

  const txPayload = decodeTxCookiePayload(txCookieValue);
  if (!txPayload) {
    return loginErrorRedirect(c, "oidc_session_expired");
  }

  const callbackUrl = new URL(c.req.url);
  const queryState = callbackUrl.searchParams.get("state");
  if (!queryState || queryState !== txPayload.state) {
    return loginErrorRedirect(c, "oidc_session_expired");
  }

  const expectedRedirectUri = new URL(txPayload.redirectUri);
  if (expectedRedirectUri.origin !== callbackUrl.origin || expectedRedirectUri.pathname !== callbackUrl.pathname) {
    return loginErrorRedirect(c, "oidc_session_expired");
  }

  let config: oidc.Configuration;
  try {
    config = await getOidcConfig(c.env);
  } catch (error) {
    logger.error("oidc_discovery_failed", oidcErrorContext(error, c.env));
    return loginErrorRedirect(c, "oidc_provider_error");
  }

  let tokens: { claims(): oidc.IDToken | undefined };
  try {
    tokens = await exchangeAuthorizationCode(config, callbackUrl, {
      pkceCodeVerifier: txPayload.codeVerifier,
      expectedNonce: txPayload.nonce,
      expectedState: txPayload.state,
    });
  } catch (error) {
    logger.warn("oidc_token_exchange_failed", oidcErrorContext(error, c.env));
    return loginErrorRedirect(c, "oidc_provider_error");
  }

  const claimsResult = validateClaims(tokens.claims());
  if (!claimsResult.ok) {
    logger.warn("oidc_callback_failed", { code: claimsResult.code });
    return loginErrorRedirect(c, claimsResult.code);
  }

  const outcome = await bindIdentity(c.get("db"), claimsResult.claims);
  if (!outcome.ok) {
    logger.warn("oidc_callback_failed", { code: outcome.code });
    return loginErrorRedirect(c, outcome.code);
  }

  const { sessionId } = await createSession(c.env, outcome.userId);
  clearTxCookie(c);
  setSessionCookie(c, sessionId);

  logger.info("oidc_callback_success", { userId: outcome.userId, outcome: outcome.kind });
  return c.redirect(appendOidcMarker(sanitizeReturnTo(txPayload.returnTo)), 302);
};
