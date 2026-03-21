import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { ProjectId, RunId, UnixTimestampMs } from "@/contracts";
import { expectTrusted, type FinalizeRunExecutionInput, type RunMetaState } from "@/worker/contracts";
import { mapExecutionErrorToOutcome } from "@/worker/queue/execute-dispatched-run";
import { finalizeExecution } from "@/worker/queue/run-finalize";

import {
  createQueueLeaseStub,
  createQueueProjectControlStub,
  createQueueRunControlStub,
  createQueueRunLogsStub,
  createQueueRunRuntimeStub,
  createQueueRunStoreStub,
  createQueueScope,
  createQueueState,
} from "../../helpers/queue";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";
import { seedProject, seedUser } from "../../helpers/runtime";

const toTimestamp = (value: number) => expectTrusted(UnixTimestampMs, value, "UnixTimestampMs");

type FinalizeContext = Parameters<typeof finalizeExecution>[0];
type ErrorContext = Parameters<typeof mapExecutionErrorToOutcome>[0];
const createLeaseStub = (cancelRequested: boolean) =>
  createQueueLeaseStub({
    isCancellationRequested: cancelRequested,
  });

const buildFinalizeContext = (
  projectId: ProjectId,
  runId: RunId,
  startedAt: UnixTimestampMs,
  cancelRequestedAt: UnixTimestampMs | null,
  destroySandboxResult: boolean,
): {
  context: FinalizeContext;
  finalizeCalls: FinalizeRunExecutionInput[];
  runStub: ReturnType<Env["RUN_DO"]["getByName"]>;
} => {
  const finalizeCalls: FinalizeRunExecutionInput[] = [];
  const runStub = env.RUN_DO.getByName(runId);
  const state = createQueueState({ cancelRequestedAt });
  const scope = createQueueScope({
    env,
    projectId,
    runId,
    startedAt,
  });

  const context: FinalizeContext = {
    scope,
    state,
    runStore: createQueueRunStoreStub({
      tryUpdateState: async (input: Omit<Parameters<typeof runStub.tryUpdateRunState>[0], "runId">) =>
        await runStub.tryUpdateRunState({
          runId,
          ...input,
        }),
      repairTerminalState: async (input: Omit<Parameters<typeof runStub.repairTerminalState>[0], "runId">) => {
        await runStub.repairTerminalState({
          runId,
          ...input,
        });
      },
    }),
    projectControl: createQueueProjectControlStub({
      finalizeRunExecution: async (
        terminalStatus: Extract<RunMetaState["status"], "passed" | "failed" | "canceled">,
        lastError: string | null,
        sandboxDestroyed: boolean,
      ) => {
        finalizeCalls.push({
          projectId,
          runId,
          terminalStatus,
          lastError,
          sandboxDestroyed,
        });
        return {
          snapshot: scope.snapshot,
        };
      },
    }),
    runtime: createQueueRunRuntimeStub({
      destroySandbox: async () => destroySandboxResult,
    }),
    control: createQueueRunControlStub({
      getRunMeta: async (): Promise<RunMetaState> => {
        const current = await runStub.getRunSummary(runId);
        if (!current) {
          throw new Error(`Run ${runId} is not initialized.`);
        }

        return current;
      },
      updateRunFromCurrent: async (
        current: RunMetaState,
        status: RunMetaState["status"],
        overrides: Partial<
          Pick<RunMetaState, "currentStep" | "startedAt" | "finishedAt" | "exitCode" | "errorMessage">
        > = {},
      ): Promise<RunMetaState> => {
        const hasOverride = <TKey extends keyof typeof overrides>(key: TKey): boolean =>
          Object.prototype.hasOwnProperty.call(overrides, key);

        await runStub.updateRunState({
          runId,
          status,
          currentStep: hasOverride("currentStep") ? overrides.currentStep : current.currentStep,
          startedAt: hasOverride("startedAt") ? overrides.startedAt : current.startedAt,
          finishedAt: hasOverride("finishedAt") ? overrides.finishedAt : current.finishedAt,
          exitCode: hasOverride("exitCode") ? overrides.exitCode : current.exitCode,
          errorMessage: hasOverride("errorMessage") ? overrides.errorMessage : current.errorMessage,
        });

        const updated = await runStub.getRunSummary(runId);
        if (!updated) {
          throw new Error(`Run ${runId} is not initialized.`);
        }

        return updated;
      },
    }),
  };

  return {
    context,
    finalizeCalls,
    runStub,
  };
};

describe("queue finalization", () => {
  registerWorkerRuntimeHooks();

  describe("late cancellation", () => {
    it("marks a late-canceled run as canceled when cleanup succeeds", async () => {
      const user = await seedUser({
        email: "late-pass@example.com",
        slug: "late-pass-user",
      });
      const project = await seedProject(user, {
        projectSlug: "late-pass-project",
      });
      const runId = RunId.assertDecode("run_0000000000000000000001");
      const startedAt = toTimestamp(1_740_000_000_000);
      const cancelRequestedAt = toTimestamp(startedAt + 1_000);
      const { context, finalizeCalls, runStub } = buildFinalizeContext(
        project.id,
        runId,
        startedAt,
        cancelRequestedAt,
        true,
      );

      await runStub.ensureInitialized({
        runId,
        projectId: project.id,
        triggerType: "manual",
        branch: project.defaultBranch,
        commitSha: null,
      });
      await runStub.updateRunState({
        runId,
        status: "starting",
        currentStep: null,
        startedAt,
        finishedAt: null,
        exitCode: null,
        errorMessage: null,
      });
      await runStub.updateRunState({
        runId,
        status: "running",
        currentStep: null,
        startedAt,
        finishedAt: null,
        exitCode: 0,
        errorMessage: null,
      });
      await runStub.updateRunState({
        runId,
        status: "cancel_requested",
        currentStep: null,
        startedAt,
        finishedAt: null,
        exitCode: 0,
        errorMessage: null,
      });

      await finalizeExecution(context, createLeaseStub(true), {
        kind: "passed",
        exitCode: 0,
      });

      const runMeta = await runStub.getRunSummary(runId);
      expect(runMeta?.status).toBe("canceled");
      expect(runMeta?.exitCode).toBeNull();
      expect(runMeta?.errorMessage).toBeNull();
      expect(finalizeCalls).toEqual([
        {
          projectId: project.id,
          runId,
          terminalStatus: "canceled",
          lastError: null,
          sandboxDestroyed: true,
        },
      ]);
    });

    it("fails a late-canceled run when cancellation cleanup fails", async () => {
      const user = await seedUser({
        email: "late-fail@example.com",
        slug: "late-fail-user",
      });
      const project = await seedProject(user, {
        projectSlug: "late-fail-project",
      });
      const runId = RunId.assertDecode("run_0000000000000000000002");
      const startedAt = toTimestamp(1_740_000_010_000);
      const cancelRequestedAt = toTimestamp(startedAt + 1_000);
      const { context, finalizeCalls, runStub } = buildFinalizeContext(
        project.id,
        runId,
        startedAt,
        cancelRequestedAt,
        false,
      );

      await runStub.ensureInitialized({
        runId,
        projectId: project.id,
        triggerType: "manual",
        branch: project.defaultBranch,
        commitSha: null,
      });
      await runStub.updateRunState({
        runId,
        status: "starting",
        currentStep: null,
        startedAt,
        finishedAt: null,
        exitCode: null,
        errorMessage: null,
      });
      await runStub.updateRunState({
        runId,
        status: "running",
        currentStep: null,
        startedAt,
        finishedAt: null,
        exitCode: 23,
        errorMessage: null,
      });
      await runStub.updateRunState({
        runId,
        status: "cancel_requested",
        currentStep: null,
        startedAt,
        finishedAt: null,
        exitCode: 23,
        errorMessage: null,
      });

      await finalizeExecution(context, createLeaseStub(true), {
        kind: "failed",
        exitCode: 23,
        errorMessage: "step failed",
      });

      const runMeta = await runStub.getRunSummary(runId);
      expect(runMeta?.status).toBe("failed");
      expect(runMeta?.exitCode).toBe(1);
      expect(runMeta?.errorMessage).toBe("cancel_cleanup_failed");
      expect(finalizeCalls).toEqual([
        {
          projectId: project.id,
          runId,
          terminalStatus: "failed",
          lastError: "cancel_cleanup_failed",
          sandboxDestroyed: false,
        },
      ]);
    });
  });

  describe("failure logging", () => {
    it("treats queue-side failure logging as best effort", async () => {
      const runId = RunId.assertDecode("run_0000000000000000000000");
      const projectId = expectTrusted(ProjectId, "prj_0000000000000000000000", "ProjectId");
      const context: ErrorContext = {
        scope: createQueueScope({
          env,
          projectId,
          runId,
          startedAt: toTimestamp(1_740_000_020_000),
        }),
        state: createQueueState(),
        logs: createQueueRunLogsStub({
          appendSystemLog: vi.fn(async () => {
            throw new Error("append failed");
          }),
        }),
      };

      await expect(mapExecutionErrorToOutcome(context, new Error("boom"))).resolves.toEqual({
        kind: "failed",
        exitCode: 1,
        errorMessage: "boom",
      });
    });
  });
});
