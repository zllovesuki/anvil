import { Hono } from "hono";

import { requireAuth } from "@/worker/auth";
import type { AppEnv } from "@/worker/hono";
import {
  handleCancelRun,
  handleCreateInvite,
  handleCreateRunLogTicket,
  handleGetMe,
  handleDeleteProjectWebhook,
  handleCreateProject,
  handleGetProjectDetail,
  handleGetRunLogsWebSocket,
  handleGetProjectWebhooks,
  handleGetProjectRuns,
  handleGetProjects,
  handleGetRunDetail,
  handleRotateProjectWebhookSecret,
  handleTriggerProjectRun,
  handleUpsertProjectWebhook,
  handleUpdateProject,
} from "@/worker/api/private";

const privateRoutes = new Hono<AppEnv>();

privateRoutes.get("/runs/:runId/logs", handleGetRunLogsWebSocket);

privateRoutes.use("*", requireAuth);
privateRoutes.get("/me", handleGetMe);
privateRoutes.get("/projects", handleGetProjects);
privateRoutes.get("/projects/:projectId", handleGetProjectDetail);
privateRoutes.get("/projects/:projectId/webhooks", handleGetProjectWebhooks);
privateRoutes.get("/projects/:projectId/runs", handleGetProjectRuns);
privateRoutes.get("/runs/:runId", handleGetRunDetail);
privateRoutes.post("/runs/:runId/cancel", handleCancelRun);
privateRoutes.post("/runs/:runId/log-ticket", handleCreateRunLogTicket);
privateRoutes.post("/projects", handleCreateProject);
privateRoutes.patch("/projects/:projectId", handleUpdateProject);
privateRoutes.put("/projects/:projectId/webhooks/:provider", handleUpsertProjectWebhook);
privateRoutes.post("/projects/:projectId/webhooks/:provider/rotate-secret", handleRotateProjectWebhookSecret);
privateRoutes.delete("/projects/:projectId/webhooks/:provider", handleDeleteProjectWebhook);
privateRoutes.post("/projects/:projectId/runs", handleTriggerProjectRun);
privateRoutes.post("/invites", handleCreateInvite);

export { privateRoutes };
