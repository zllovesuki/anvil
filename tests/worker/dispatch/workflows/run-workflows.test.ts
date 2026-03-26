import type { WorkflowStep } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { UnixTimestampMs } from "@/contracts";
import { AcceptedRunSnapshot, PositiveInteger, expectTrusted } from "@/worker/contracts";
import * as workflowSteps from "@/worker/dispatch/workflows/steps/index";
import { RunWorkflows } from "@/worker/dispatch/workflows";

vi.mock("@/worker/dispatch/workflows/steps/index", async () => {
  const actual = await vi.importActual<typeof import("@/worker/dispatch/workflows/steps/index")>(
    "@/worker/dispatch/workflows/steps/index",
  );

  return {
    ...actual,
    claimWorkflowRun: vi.fn(actual.claimWorkflowRun),
    executeWorkflowRun: vi.fn(actual.executeWorkflowRun),
    finalizeWorkflowRun: vi.fn(actual.finalizeWorkflowRun),
  };
});

const createSnapshot = (payload: Parameters<typeof AcceptedRunSnapshot.assertDecode>[0]) =>
  AcceptedRunSnapshot.assertDecode(payload);

const createWorkflowEvent = (payload: Parameters<typeof AcceptedRunSnapshot.assertDecode>[0]) => ({
  payload: createSnapshot(payload),
  timestamp: new Date("2026-03-24T12:00:00.000Z"),
  instanceId: "run_0000000000000000000000",
});

const createWorkflowStep = (
  handler?: (
    name: string,
    callback: (ctx: { attempt: number }) => Promise<unknown>,
    config: unknown,
  ) => Promise<unknown>,
) => {
  const doMock = vi.fn(async (...args: unknown[]) => {
    const name = args[0] as string;
    const config = typeof args[1] === "function" ? undefined : args[1];
    const callback = typeof args[1] === "function" ? args[1] : args[2];
    if (handler) {
      return await handler(name, callback as (ctx: { attempt: number }) => Promise<unknown>, config);
    }
    return await (callback as (ctx: { attempt: number }) => Promise<unknown>)({ attempt: 1 });
  });

  return {
    step: {
      do: doMock,
    } as unknown as WorkflowStep,
    doMock,
  };
};

const createWorkflow = (env: Env): RunWorkflows =>
  Object.assign(Object.create(RunWorkflows.prototype), {
    env,
    ctx: {},
  }) as RunWorkflows;

const toEnv = (env: unknown): Env => env as Env;

const WORKFLOW_SNAPSHOT_INPUT = {
  runId: "run_0000000000000000000000",
  projectId: "prj_0000000000000000000000",
  triggerType: "manual" as const,
  triggeredByUserId: null,
  branch: "main",
  commitSha: null,
  repoUrl: "https://github.com/example/anvil",
  configPath: ".anvil.yml",
  dispatchMode: "workflows" as const,
  executionRuntime: "cloudflare_sandbox" as const,
  queuedAt: 1_711_111_111_111,
};

describe("run workflows", () => {
  it("returns stale when ProjectDO rejects the run claim", async () => {
    const projectStub = {
      claimRunWork: vi.fn(async () => ({
        kind: "stale" as const,
        reason: "run_missing" as const,
      })),
    };
    const workflow = createWorkflow(
      toEnv({
        PROJECT_DO: {
          getByName: () => projectStub,
        },
        RUN_DO: {
          getByName: () => ({}),
        },
      }),
    );

    const result = await workflow.run(createWorkflowEvent(WORKFLOW_SNAPSHOT_INPUT), createWorkflowStep().step);

    expect(result).toEqual({
      kind: "stale",
      reason: "run_missing",
    });
  });

  it("recovers an already-terminal active run during claim", async () => {
    const snapshot = createSnapshot(WORKFLOW_SNAPSHOT_INPUT);
    const finalizeRunExecution = vi.fn(async () => ({
      snapshot,
    }));
    const workflow = createWorkflow(
      toEnv({
        PROJECT_DO: {
          getByName: () => ({
            claimRunWork: vi.fn(async () => ({
              kind: "stale" as const,
              reason: "run_active" as const,
            })),
            finalizeRunExecution,
            kickReconciliation: vi.fn(async () => {}),
          }),
        },
        RUN_DO: {
          getByName: () => ({
            getRunSummary: vi.fn(async () => ({
              status: "passed" as const,
              currentStep: null,
              startedAt: snapshot.queuedAt,
              finishedAt: snapshot.queuedAt + 1_000,
              exitCode: 0,
              errorMessage: null,
            })),
          }),
        },
      }),
    );

    const result = await workflow.run(createWorkflowEvent(WORKFLOW_SNAPSHOT_INPUT), createWorkflowStep().step);

    expect(result).toEqual({
      kind: "recovered",
    });
    expect(finalizeRunExecution).toHaveBeenCalledWith({
      projectId: snapshot.projectId,
      runId: snapshot.runId,
      terminalStatus: "passed",
      lastError: null,
      sandboxDestroyed: false,
    });
  });

  it("rearms dispatch when claim fails before the run becomes active", async () => {
    const recoverWorkflowDispatchFailure = vi.fn(async () => ({
      kind: "rearmed" as const,
    }));
    const { step, doMock } = createWorkflowStep(async (name, callback) => {
      if (name === "claim run") {
        throw new Error("claim failed");
      }

      return await callback({ attempt: 1 });
    });
    const workflow = createWorkflow(
      toEnv({
        PROJECT_DO: {
          getByName: () => ({
            recoverWorkflowDispatchFailure,
          }),
        },
        RUN_DO: {
          getByName: () => ({}),
        },
      }),
    );

    const result = await workflow.run(createWorkflowEvent(WORKFLOW_SNAPSHOT_INPUT), step);

    expect(result).toEqual({
      kind: "stale",
      reason: "dispatch_rearmed",
    });
    expect(recoverWorkflowDispatchFailure).toHaveBeenCalledWith({
      projectId: WORKFLOW_SNAPSHOT_INPUT.projectId,
      runId: WORKFLOW_SNAPSHOT_INPUT.runId,
      errorMessage: "claim failed",
    });
    await expect(recoverWorkflowDispatchFailure.mock.results[0]?.value).resolves.toEqual({
      kind: "rearmed",
    });
    expect(doMock.mock.calls.map(([name]) => name)).toEqual(["claim run", "rearm dispatch"]);
    expect((doMock.mock.calls[0]?.[1] as { retries?: { limit: number } }).retries?.limit).toBe(3);
    expect((doMock.mock.calls[1]?.[1] as { retries?: { limit: number } }).retries?.limit).toBe(3);
  });

  it("continues execution when pre-start recovery finds the run is already active", async () => {
    const snapshot = createSnapshot(WORKFLOW_SNAPSHOT_INPUT);
    const recoverWorkflowDispatchFailure = vi.fn(async () => ({
      kind: "already_active" as const,
    }));
    const { step, doMock } = createWorkflowStep(async (name, callback) => {
      if (name === "claim run") {
        throw new Error("claim failed after activation");
      }

      if (name === "execute run") {
        return "passed";
      }

      return await callback({ attempt: 1 });
    });
    const workflow = createWorkflow(
      toEnv({
        PROJECT_DO: {
          getByName: () => ({
            recoverWorkflowDispatchFailure,
          }),
        },
        RUN_DO: {
          getByName: () => ({
            getRunSummary: vi.fn(async () => ({
              status: "running" as const,
              currentStep: null,
              startedAt: snapshot.queuedAt,
              finishedAt: null,
              exitCode: null,
              errorMessage: null,
            })),
          }),
        },
      }),
    );

    const result = await workflow.run(createWorkflowEvent(WORKFLOW_SNAPSHOT_INPUT), step);

    expect(result).toEqual({
      kind: "executed",
      terminalStatus: "passed",
    });
    expect(doMock.mock.calls.map(([name]) => name)).toEqual(["claim run", "rearm dispatch", "execute run"]);
  });

  it("finalizes a failed resumed execution after pre-start recovery finds the run already active", async () => {
    const snapshot = createSnapshot(WORKFLOW_SNAPSHOT_INPUT);
    const recoverWorkflowDispatchFailure = vi.fn(async () => ({
      kind: "already_active" as const,
    }));
    const finalizeWorkflowRun = vi.mocked(workflowSteps.finalizeWorkflowRun).mockResolvedValueOnce();
    const executeWorkflowRun = vi
      .mocked(workflowSteps.executeWorkflowRun)
      .mockRejectedValueOnce(new Error("resume failed"));
    const runningMeta = {
      status: "running" as const,
      currentStep: expectTrusted(PositiveInteger, 2, "PositiveInteger"),
      startedAt: snapshot.queuedAt,
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
    };
    const finalizedMeta = {
      status: "failed" as const,
      currentStep: null,
      startedAt: snapshot.queuedAt,
      finishedAt: expectTrusted(UnixTimestampMs, snapshot.queuedAt + 1_000, "UnixTimestampMs"),
      exitCode: 1,
      errorMessage: "resume failed",
    };
    const getRunSummary = vi
      .fn(async (): Promise<typeof runningMeta | typeof finalizedMeta> => runningMeta)
      .mockResolvedValueOnce(runningMeta)
      .mockResolvedValueOnce(runningMeta)
      .mockResolvedValueOnce(finalizedMeta);
    const { step, doMock } = createWorkflowStep(async (name, callback) => {
      if (name === "claim run") {
        throw new Error("claim failed after activation");
      }

      return await callback({ attempt: 1 });
    });
    const workflow = createWorkflow(
      toEnv({
        PROJECT_DO: {
          getByName: () => ({
            recoverWorkflowDispatchFailure,
          }),
        },
        RUN_DO: {
          getByName: () => ({
            getRunSummary,
          }),
        },
      }),
    );

    const result = await workflow.run(createWorkflowEvent(WORKFLOW_SNAPSHOT_INPUT), step);

    expect(result).toEqual({
      kind: "executed",
      terminalStatus: "failed",
    });
    expect(executeWorkflowRun).toHaveBeenCalledWith(step, expect.anything(), snapshot, snapshot.queuedAt);
    expect(finalizeWorkflowRun).toHaveBeenCalledWith(
      expect.anything(),
      snapshot,
      snapshot.queuedAt,
      {
        kind: "failed",
        exitCode: 1,
        errorMessage: "resume failed",
      },
      runningMeta.currentStep,
    );
    expect(doMock.mock.calls.map(([name]) => name)).toEqual(["claim run", "rearm dispatch"]);
  });

  it("returns the terminal status from the execute step on the happy path", async () => {
    const snapshot = createSnapshot(WORKFLOW_SNAPSHOT_INPUT);
    const { step, doMock } = createWorkflowStep(async (name, callback) => {
      if (name === "execute run") {
        return "failed";
      }

      return await callback({ attempt: 1 });
    });
    const workflow = createWorkflow(
      toEnv({
        PROJECT_DO: {
          getByName: () => ({
            claimRunWork: vi.fn(async () => ({
              kind: "execute" as const,
              snapshot,
            })),
          }),
        },
        RUN_DO: {
          getByName: () => ({
            ensureInitialized: vi.fn(async () => {}),
          }),
        },
      }),
    );

    const result = await workflow.run(
      {
        payload: snapshot,
        timestamp: new Date("2026-03-24T12:00:00.000Z"),
        instanceId: snapshot.runId,
      },
      step,
    );

    expect(result).toEqual({
      kind: "executed",
      terminalStatus: "failed",
    });
    expect(doMock.mock.calls.map(([name]) => name)).toEqual(["claim run", "execute run"]);
  });
});
