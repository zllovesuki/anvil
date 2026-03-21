import { type DispatchMode, type ProjectId, type RunId } from "@/contracts";
import type { ProjectDoContext } from "../types";

export const dispatchRun = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  runId: RunId,
  dispatchMode: DispatchMode,
): Promise<void> => {
  switch (dispatchMode) {
    case "queue":
      await context.env.RUN_QUEUE.send({ projectId, runId });
      return;
    case "workflows":
      throw new Error('Dispatch mode "workflows" is not yet implemented.');
    default: {
      const _exhaustive: never = dispatchMode;
      throw new Error(`Unknown dispatch mode: ${String(_exhaustive)}`);
    }
  }
};
