import { createMiddleware } from "hono/factory";

import type { AppContext, AppEnv } from "@/worker/hono";
import { findUserById } from "@/worker/db/d1/repositories";
import { HttpError } from "@/worker/http";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "@/worker/auth/cookies";
import { maybeRefreshSession, readSession, type SessionRecord } from "@/worker/auth/sessions";

const loadSession = async (c: AppContext): Promise<{ sessionId: string; session: SessionRecord }> => {
  const sessionId = readSessionCookie(c);

  if (!sessionId) {
    throw new HttpError(403, "missing_session", "Missing session cookie.");
  }

  const session = await readSession(c.env, sessionId);

  if (!session) {
    clearSessionCookie(c);
    throw new HttpError(403, "invalid_session", "Session is missing or expired.");
  }

  c.set("sessionId", sessionId);
  c.set("session", session);

  return { sessionId, session };
};

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const { sessionId, session } = await loadSession(c);
  const user = await findUserById(c.get("db"), session.userId);

  if (!user) {
    clearSessionCookie(c);
    throw new HttpError(403, "invalid_session", "Session user no longer exists.");
  }

  if (user.disabledAt !== null) {
    clearSessionCookie(c);
    throw new HttpError(403, "user_disabled", "User account is disabled.");
  }

  const refreshedSession = await maybeRefreshSession(c.env, sessionId, session);
  if (refreshedSession !== session) {
    setSessionCookie(c, sessionId);
  }

  c.set("session", refreshedSession);
  c.set("user", user);

  await next();
});
