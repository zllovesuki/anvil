import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { AppContext } from "@/worker/hono";

export const SESSION_COOKIE_NAME = "anvil_session";
export const SESSION_COOKIE_WIRE_NAME = "__Host-anvil_session";
const SESSION_COOKIE_PREFIX = "host" as const;

const SESSION_COOKIE_OPTIONS = {
  path: "/" as const,
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  prefix: SESSION_COOKIE_PREFIX,
};

export const readSessionCookie = (c: AppContext): string | null =>
  getCookie(c, SESSION_COOKIE_NAME, SESSION_COOKIE_PREFIX) ?? null;

export const setSessionCookie = (c: AppContext, sessionId: string): void => {
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: Number(c.env.AUTH_SESSION_TTL_SECONDS),
  });
};

export const clearSessionCookie = (c: AppContext): void => {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: SESSION_COOKIE_OPTIONS.path,
    secure: SESSION_COOKIE_OPTIONS.secure,
    prefix: SESSION_COOKIE_PREFIX,
  });
};
