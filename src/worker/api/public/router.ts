import { Hono } from "hono";

import type { AppEnv } from "@/worker/hono";
import { handleAppConfig, handleLogout, handleOidcCallback, handleOidcStart, handleWebhook } from "@/worker/api/public";
import { requireSameOrigin } from "@/worker/security/same-origin";

const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/app-config", handleAppConfig);
publicRoutes.post("/auth/logout", requireSameOrigin, handleLogout);
publicRoutes.get("/oidc/start", handleOidcStart);
publicRoutes.get("/oidc/callback", handleOidcCallback);
publicRoutes.post("/hooks/:provider/:ownerSlug/:projectSlug", handleWebhook);

export { publicRoutes };
