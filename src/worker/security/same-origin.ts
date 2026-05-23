import { createMiddleware } from "hono/factory";

import type { AppEnv } from "@/worker/hono";
import { HttpError } from "@/worker/http";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TRUSTED_FETCH_SITE_VALUES = new Set(["same-origin", "none"]);

export const requireSameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const requestOrigin = new URL(c.req.url).origin;
  const origin = c.req.header("origin")?.trim();

  if (origin) {
    if (origin !== requestOrigin) {
      throw new HttpError(403, "cross_origin_blocked", "Cross-origin request blocked.");
    }

    await next();
    return;
  }

  const fetchSite = c.req.header("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && TRUSTED_FETCH_SITE_VALUES.has(fetchSite)) {
    await next();
    return;
  }

  throw new HttpError(403, "cross_origin_blocked", "Cross-origin request blocked.");
});
