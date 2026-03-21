import { Hono } from "hono";

import { privateRoutes } from "@/worker/api/private/router";
import { publicRoutes } from "@/worker/api/public/router";
import { D1_BOOKMARK_HEADER, openSession } from "@/worker/db/d1";
import type { AppEnv } from "@/worker/hono";
import { HttpError, toErrorResponse } from "@/worker/http";
import { createLogger } from "@/worker/services";

const logger = createLogger("worker.router");

export const app = new Hono<AppEnv>();

const buildContentSecurityPolicy = (requestUrl: string): string => {
  const { host } = new URL(requestUrl);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self'",
    `connect-src 'self' ws://${host} wss://${host}`,
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join("; ");
};

const REPLICA_FRIENDLY_ROUTES = [
  /^\/api\/private\/me$/,
  /^\/api\/private\/projects$/,
  /^\/api\/private\/projects\/[^/]+$/,
  /^\/api\/private\/projects\/[^/]+\/webhooks$/,
  /^\/api\/private\/projects\/[^/]+\/runs$/,
  /^\/api\/private\/runs\/[^/]+$/,
];
const REPLICA_FRIENDLY_POST_ROUTES = [/^\/api\/private\/runs\/[^/]+\/log-ticket$/];

function selectSessionConstraint(method: string, path: string): D1SessionConstraint {
  if (
    (method === "GET" && REPLICA_FRIENDLY_ROUTES.some((route) => route.test(path))) ||
    (method === "POST" && REPLICA_FRIENDLY_POST_ROUTES.some((route) => route.test(path)))
  ) {
    return "first-unconstrained";
  }

  return "first-primary";
}

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  c.header("X-Permitted-Cross-Domain-Policies", "none");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Content-Security-Policy", buildContentSecurityPolicy(c.req.url));
});

app.use("*", async (c, next) => {
  const bookmark = c.req.header(D1_BOOKMARK_HEADER)?.trim();
  const d1 = openSession(c.env, bookmark || selectSessionConstraint(c.req.method, c.req.path));

  c.set("db", d1.db);

  try {
    await next();
  } finally {
    const nextBookmark = d1.getBookmark();
    if (nextBookmark) {
      c.header(D1_BOOKMARK_HEADER, nextBookmark);
    }
  }
});

app.route("/api/public", publicRoutes);
app.route("/api/private", privateRoutes);

app.notFound((c) => toErrorResponse(c, new HttpError(404, "not_found", "Not found.")));

app.onError((error, c) => {
  logger.error("request_failed", {
    method: c.req.method,
    path: c.req.path,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
  });

  return toErrorResponse(c, error);
});
