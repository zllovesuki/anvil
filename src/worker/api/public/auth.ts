import { clearSessionCookie, readSessionCookie } from "@/worker/auth/cookies";
import { deleteSession } from "@/worker/auth/sessions";
import type { AppContext } from "@/worker/hono";

export const handleLogout = async (c: AppContext): Promise<Response> => {
  const sessionId = readSessionCookie(c);

  if (sessionId) {
    await deleteSession(c.env, sessionId);
  }

  clearSessionCookie(c);
  return c.body(null, 204);
};
