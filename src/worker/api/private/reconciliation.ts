import type { ProjectId } from "@/contracts";
import type { AppContext } from "@/worker/hono";
import { createLogger } from "@/worker/services";

const logger = createLogger("worker.project-reconciliation");

const getProjectStub = (env: AppContext["env"], projectId: ProjectId) => env.PROJECT_DO.getByName(projectId);

export const queueProjectReconciliation = (c: AppContext, projectId: ProjectId, trigger: string): void => {
  // ProjectDO owns D1 sync and queue dispatch, but read/write HTTP handlers are the reliable place where
  // we have a Worker execution context that can nudge reconciliation without blocking the response path.
  const stub = getProjectStub(c.env, projectId);
  c.executionCtx.waitUntil(
    stub.kickReconciliation().catch((error) => {
      logger.warn("project_reconciliation_kick_failed", {
        projectId,
        trigger,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
};
