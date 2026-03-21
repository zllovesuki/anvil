import { createMiddleware } from "hono/factory";

import type { AppContext, AppEnv } from "@/worker/hono";
import { findUserById } from "@/worker/db/d1/repositories";
import { HttpError } from "@/worker/http";
import { requireBearerToken } from "@/worker/auth/headers";
import { maybeRefreshSession, readSession, type SessionRecord } from "@/worker/auth/sessions";

const loadSession = async (c: AppContext): Promise<{ sessionId: string; session: SessionRecord }> => {
  const sessionId = requireBearerToken(c.req.raw);
  const session = await readSession(c.env, sessionId);

  if (!session) {
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
    throw new HttpError(403, "invalid_session", "Session user no longer exists.");
  }

  if (user.disabledAt !== null) {
    throw new HttpError(403, "user_disabled", "User account is disabled.");
  }

  c.set("session", await maybeRefreshSession(c.env, sessionId, session));
  c.set("user", user);

  await next();
});
