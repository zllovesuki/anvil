import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { DEFAULT_EXECUTION_RUNTIME } from "@/contracts";
import { AcceptedRunSnapshot } from "@/worker/contracts";

import { acceptManualRunWithoutAlarm } from "../../../helpers/project-do";
import { readProjectDoRows, seedProject, seedUser } from "../../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";

describe("run workflows runtime", () => {
  registerWorkerRuntimeHooks();

  it("finalizes the run when the execute step times out at the workflow layer", async () => {
    const user = await seedUser({
      email: "workflow-runtime-timeout@example.com",
      slug: "workflow-runtime-timeout-user",
    });
    const project = await seedProject(user, {
      projectSlug: "workflow-runtime-timeout-project",
      dispatchMode: "workflows",
    });
    const projectStub = env.PROJECT_DO.getByName(project.id);
    const accepted = await acceptManualRunWithoutAlarm(projectStub, {
      projectId: project.id,
      triggeredByUserId: user.id,
      branch: project.defaultBranch,
    });
    const snapshot = AcceptedRunSnapshot.assertDecode({
      runId: accepted.runId,
      projectId: project.id,
      triggerType: "manual",
      triggeredByUserId: user.id,
      branch: project.defaultBranch,
      commitSha: null,
      repoUrl: project.repoUrl,
      configPath: project.configPath,
      dispatchMode: "workflows",
      executionRuntime: DEFAULT_EXECUTION_RUNTIME,
      queuedAt: accepted.queuedAt,
    });

    const instance = await introspectWorkflowInstance(env.RUN_WORKFLOWS, accepted.runId);
    try {
      await instance.modify(async (modifier) => {
        await modifier.forceStepTimeout({ name: "execute run" });
      });

      await env.RUN_WORKFLOWS.create({
        id: accepted.runId,
        params: snapshot,
      });

      await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
      await expect(instance.getOutput()).resolves.toEqual({
        kind: "executed",
        terminalStatus: "failed",
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.state?.activeRunId).toBeNull();
      expect(rows.runs[0]?.status).toBe("failed");
      expect(rows.runs[0]?.dispatchStatus).toBe("terminal");

      const runMeta = await env.RUN_DO.getByName(accepted.runId).getRunSummary(accepted.runId);
      expect(runMeta?.status).toBe("failed");
      expect(runMeta?.finishedAt).not.toBeNull();
    } finally {
      await instance.dispose();
    }
  }, 15_000);
});
