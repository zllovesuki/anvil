import { type ProjectId, type RunId, UnixTimestampMs } from "@/contracts";
import { type AcceptedRunSnapshot, expectTrusted, PositiveInteger, type RunMetaState } from "@/worker/contracts";
import { createLogger } from "@/worker/services";

export const logger = createLogger("queue.consumer");
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const CANCEL_GRACE_MS = 30_000;
export const PROCESS_WAIT_BUFFER_MS = 35_000;

export const getProjectStub = (env: Env, projectId: ProjectId) => env.PROJECT_DO.getByName(projectId);
export const getRunStub = (env: Env, runId: RunId) => env.RUN_DO.getByName(runId);

export const now = (): UnixTimestampMs => expectTrusted(UnixTimestampMs, Date.now(), "UnixTimestampMs");
export const toPositiveInteger = (value: number): PositiveInteger =>
  expectTrusted(PositiveInteger, value, "PositiveInteger");
export const sleep = async (ms: number): Promise<void> => scheduler.wait(ms);

export const ensureRunInitialized = async (env: Env, snapshot: AcceptedRunSnapshot): Promise<void> => {
  await getRunStub(env, snapshot.runId).ensureInitialized({
    runId: snapshot.runId,
    projectId: snapshot.projectId,
    triggerType: snapshot.triggerType,
    branch: snapshot.branch,
    commitSha: snapshot.commitSha,
  });
};

export const kickProjectReconciliation = async (
  env: Env,
  projectId: ProjectId,
  runId: RunId,
  trigger: string,
): Promise<void> => {
  try {
    await getProjectStub(env, projectId).kickReconciliation();
  } catch (error) {
    logger.warn("project_reconciliation_kick_failed", {
      projectId,
      runId,
      trigger,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
