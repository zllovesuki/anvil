import { type AcceptedRunSnapshot } from "@/worker/contracts";
import { type DispatchMode, type ProjectId, type RunId } from "@/contracts";
import type { ProjectDoContext } from "../types";

type WorkflowInstanceStatus = InstanceStatus["status"];
type WorkflowDispatchState = "already_dispatched" | "restartable" | "unsupported";

export const classifyWorkflowDispatchState = (status: WorkflowInstanceStatus): WorkflowDispatchState => {
  switch (status) {
    case "queued":
    case "running":
    case "waiting":
    case "paused":
    case "waitingForPause":
      return "already_dispatched";
    case "complete":
    case "errored":
    case "terminated":
      return "restartable";
    case "unknown":
      return "unsupported";
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled workflow status: ${String(_exhaustive)}`);
    }
  }
};

export const dispatchRun = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
  dispatchMode: DispatchMode,
  snapshot: AcceptedRunSnapshot,
): Promise<void> => {
  switch (dispatchMode) {
    case "queue":
      await context.env.RUN_QUEUE.send({ projectId, runId });
      return;
    case "workflows":
      if (
        (
          await context.env.RUN_WORKFLOWS.createBatch([
            {
              id: runId,
              params: snapshot,
            },
          ])
        ).length === 0
      ) {
        const instance = await context.env.RUN_WORKFLOWS.get(runId);
        const current = await instance.status();
        switch (classifyWorkflowDispatchState(current.status)) {
          case "already_dispatched":
            return;
          case "restartable":
            await instance.restart();
            return;
          case "unsupported":
            break;
        }

        throw new Error(`Workflow instance ${runId} has unsupported status ${current.status}.`);
      }
      return;
    default: {
      const _exhaustive: never = dispatchMode;
      throw new Error(`Unknown dispatch mode: ${String(_exhaustive)}`);
    }
  }
};
