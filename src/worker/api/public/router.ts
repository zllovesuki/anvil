import { Hono } from "hono";

import type { AppEnv } from "@/worker/hono";
import { handleAppConfig, handleInviteAccept, handleLogin, handleLogout, handleWebhook } from "@/worker/api/public";

const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/app-config", handleAppConfig);
publicRoutes.post("/auth/login", handleLogin);
publicRoutes.post("/auth/logout", handleLogout);
publicRoutes.post("/auth/invite/accept", handleInviteAccept);
publicRoutes.post("/hooks/:provider/:ownerSlug/:projectSlug", handleWebhook);

export { publicRoutes };
