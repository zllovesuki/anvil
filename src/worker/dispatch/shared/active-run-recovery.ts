import { type ProjectId, type RunId } from "@/contracts";
import { isTerminalStatus } from "@/worker/contracts";
import { kickProjectReconciliation } from "@/worker/dispatch/shared/run-execution-context";

export const recoverTerminalActiveRun = async (env: Env, projectId: ProjectId, runId: RunId): Promise<boolean> => {
  const runMeta = await env.RUN_DO.getByName(runId).getRunSummary(runId);
  if (!runMeta || !isTerminalStatus(runMeta.status) || runMeta.finishedAt === null) {
    return false;
  }

  // When sandbox work finished but the dispatch retried before ProjectDO accepted terminalization,
  // recover from the trusted RunDO terminal state instead of letting the watchdog misclassify the run later.
  await env.PROJECT_DO.getByName(projectId).finalizeRunExecution({
    projectId,
    runId,
    terminalStatus: runMeta.status,
    lastError: runMeta.errorMessage,
    sandboxDestroyed: false,
  });
  await kickProjectReconciliation(env, projectId, runId, "recover_active_run");
  return true;
};
