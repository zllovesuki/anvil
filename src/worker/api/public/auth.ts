import { AcceptInviteRequest, LoginRequest, LoginResponse } from "@/contracts";
import type { AppContext } from "@/worker/hono";
import {
  buildClaimInviteByTokenHashStatement,
  buildFindInviteByTokenHashStatement,
  buildInsertPasswordCredentialForAcceptedInviteStatement,
  findPasswordCredentialByUserId,
  buildInsertUserForAcceptedInviteStatement,
  findUserByEmail,
} from "@/worker/db/d1/repositories";
import { createSession, deleteSession, getBearerToken, hashPassword, verifyPassword } from "@/worker/auth";
import { getConfig } from "@/worker/config";
import { HttpError, parseJson } from "@/worker/http";
import { serializeUserSummary } from "@/worker/presentation/serializers";
import { enforcePublicInviteAcceptRateLimit, enforcePublicLoginRateLimit } from "@/worker/security/rate-limit";
import { createLogger, generateDurableEntityId, hashSha256 } from "@/worker/services";
import { assertValidPassword, assertValidSlug, normalizeDisplayName, normalizeEmailAddress } from "@/worker/validation";

const logger = createLogger("worker.auth");
const UNIQUE_EMAIL_CONSTRAINT = "UNIQUE constraint failed: users.email";
const UNIQUE_SLUG_CONSTRAINT = "UNIQUE constraint failed: users.slug";

interface AcceptedUserRow {
  id: string;
  slug: string;
  email: string;
  displayName: string;
  createdAt: number;
  disabledAt: number | null;
}

const isConstraintError = (error: unknown, messageFragment: string): boolean =>
  error instanceof Error && error.message.includes(messageFragment);

export const handleLogin = async (c: AppContext): Promise<Response> => {
  const db = c.get("db");
  const payload = await parseJson(c.req.raw, LoginRequest);
  const rateLimited = await enforcePublicLoginRateLimit(c, payload.email);

  if (rateLimited) {
    return rateLimited;
  }

  const { inviteTtlSeconds } = getConfig(c.env);
  const user = await findUserByEmail(db, payload.email.toLowerCase());

  if (!user || user.disabledAt !== null) {
    throw new HttpError(403, "invalid_credentials", "Invalid email or password.");
  }

  const credential = await findPasswordCredentialByUserId(db, user.id);
  if (!credential) {
    throw new HttpError(403, "invalid_credentials", "Invalid email or password.");
  }

  const verified = await verifyPassword(payload.password, {
    digest: credential.digest,
    iterations: credential.iterations,
    salt: credential.salt,
    passwordHash: credential.passwordHash,
  });

  if (!verified) {
    throw new HttpError(403, "invalid_credentials", "Invalid email or password.");
  }

  const { sessionId, record } = await createSession(c.env, user.id);
  const response = LoginResponse.assertDecode({
    sessionId,
    expiresAt: record.expiresAt,
    user: serializeUserSummary(user),
    inviteTtlSeconds,
  });

  logger.info("auth_login_succeeded", { userId: user.id });
  return c.json(response, 200);
};

export const handleLogout = async (c: AppContext): Promise<Response> => {
  const sessionId = getBearerToken(c.req.raw);

  if (!sessionId) {
    return c.body(null, 204);
  }

  await deleteSession(c.env, sessionId);
  return c.body(null, 204);
};

export const handleInviteAccept = async (c: AppContext): Promise<Response> => {
  const db = c.get("db");
  const payload = await parseJson(c.req.raw, AcceptInviteRequest);
  const tokenHash = await hashSha256(payload.token);
  const rateLimited = await enforcePublicInviteAcceptRateLimit(c, tokenHash);

  if (rateLimited) {
    return rateLimited;
  }

  const { inviteTtlSeconds } = getConfig(c.env);
  assertValidSlug(payload.slug, "slug");
  assertValidPassword(payload.password);

  const normalizedEmail = normalizeEmailAddress(payload.email);
  const normalizedDisplayName = normalizeDisplayName(payload.displayName);
  const now = Date.now();
  const userId = generateDurableEntityId("usr", now);
  const password = await hashPassword(payload.password, c.env);
  const user: AcceptedUserRow = {
    id: userId,
    slug: payload.slug,
    email: normalizedEmail,
    displayName: normalizedDisplayName,
    createdAt: now,
    disabledAt: null,
  };
  let acceptedInviteId: string | null = null;

  try {
    const [inviteRows, claimedRows] = await db.batch([
      buildFindInviteByTokenHashStatement(db, tokenHash),
      buildClaimInviteByTokenHashStatement(db, tokenHash, userId, now),
      buildInsertUserForAcceptedInviteStatement(db, user, tokenHash, userId, now),
      buildInsertPasswordCredentialForAcceptedInviteStatement(
        db,
        {
          userId,
          algorithm: password.algorithm,
          digest: password.digest,
          iterations: password.iterations,
          salt: password.salt,
          passwordHash: password.passwordHash,
          updatedAt: now,
        },
        tokenHash,
        userId,
        now,
      ),
    ]);
    const invite = inviteRows[0];

    if (!invite) {
      throw new HttpError(404, "invite_not_found", "Invite token is invalid.");
    }

    if (invite.acceptedAt !== null) {
      throw new HttpError(409, "invite_already_used", "Invite token has already been used.");
    }

    if (invite.expiresAt <= now) {
      throw new HttpError(410, "invite_expired", "Invite token has expired.");
    }

    acceptedInviteId = invite.id;
    if (claimedRows.length !== 1) {
      if (Date.now() >= invite.expiresAt) {
        throw new HttpError(410, "invite_expired", "Invite token has expired.");
      }

      throw new HttpError(409, "invite_already_used", "Invite token has already been used.");
    }
  } catch (error) {
    if (isConstraintError(error, UNIQUE_EMAIL_CONSTRAINT)) {
      throw new HttpError(409, "email_taken", "Email is already registered.");
    }

    if (isConstraintError(error, UNIQUE_SLUG_CONSTRAINT)) {
      throw new HttpError(409, "slug_taken", "Slug is already in use.");
    }

    throw error;
  }

  const { sessionId, record } = await createSession(c.env, userId);
  logger.info("auth_invite_accepted", { userId, inviteId: acceptedInviteId });

  return c.json(
    LoginResponse.assertDecode({
      sessionId,
      expiresAt: record.expiresAt,
      user: serializeUserSummary(user),
      inviteTtlSeconds,
    }),
    201,
  );
};
