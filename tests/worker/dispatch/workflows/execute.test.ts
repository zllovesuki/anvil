import { type WorkflowStep } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnixTimestampMs } from "@/contracts";
import { AcceptedRunSnapshot, PositiveInteger, expectTrusted, type RunMetaState } from "@/worker/contracts";
import { executeWorkflowRun } from "@/worker/dispatch/workflows/steps/execute";

import {
  createQueueLeaseStub,
  createQueueRunControlStub,
  createQueueRunLogsStub,
  createQueueRunRuntimeStub,
  createQueueRunStoreStub,
  createQueueScope,
  createQueueState,
} from "../../../helpers/dispatch/shared";

const mockedModules = vi.hoisted(() => {
  const state = {
    context: null as any,
    lease: null as any,
    createRunExecutionContext: vi.fn(() => state.context),
    ensureRunInitialized: vi.fn(async () => {}),
    logger: {
      warn: vi.fn(),
    },
    appendFailureLogBestEffort: vi.fn(async () => {}),
    executeRunSteps: vi.fn(async () => ({
      kind: "passed" as const,
      exitCode: 0,
    })),
    finalizeExecution: vi.fn(async () => {}),
    mapExecutionErrorToOutcome: vi.fn(async (_context: unknown, error: unknown) => ({
      kind: "failed" as const,
      exitCode: 1,
      errorMessage: error instanceof Error ? error.message : String(error),
    })),
    prepareExecutionEnvironment: vi.fn(async () => ({
      repoConfig: {
        version: 1,
        checkout: {
          depth: 1,
        },
        run: {
          workingDirectory: ".",
          timeoutSeconds: 60,
          steps: [],
        },
      },
      workingDirectory: "/workspace/repo",
    })),
    recoverTerminalActiveRun: vi.fn(async () => true),
    RunLease: vi.fn(function MockRunLease() {
      return state.lease;
    }),
  };

  return state;
});

vi.mock("@/worker/dispatch/shared/run-execution-context", () => ({
  createRunExecutionContext: mockedModules.createRunExecutionContext,
  ensureRunInitialized: mockedModules.ensureRunInitialized,
  logger: mockedModules.logger,
}));

vi.mock("@/worker/dispatch/shared", () => ({
  appendFailureLogBestEffort: mockedModules.appendFailureLogBestEffort,
  executeRunSteps: mockedModules.executeRunSteps,
  finalizeExecution: mockedModules.finalizeExecution,
  mapExecutionErrorToOutcome: mockedModules.mapExecutionErrorToOutcome,
  prepareExecutionEnvironment: mockedModules.prepareExecutionEnvironment,
  recoverTerminalActiveRun: mockedModules.recoverTerminalActiveRun,
  RunLease: mockedModules.RunLease,
}));

const STARTED_AT = expectTrusted(UnixTimestampMs, 1_740_000_000_000, "UnixTimestampMs");
const FINISHED_AT = expectTrusted(UnixTimestampMs, 1_740_000_001_000, "UnixTimestampMs");

const SNAPSHOT = AcceptedRunSnapshot.assertDecode({
  runId: "run_0000000000000000000000",
  projectId: "prj_0000000000000000000000",
  triggerType: "manual",
  triggeredByUserId: null,
  branch: "main",
  commitSha: null,
  repoUrl: "https://github.com/example/anvil",
  configPath: ".anvil.yml",
  dispatchMode: "workflows",
  executionRuntime: "cloudflare_sandbox",
  queuedAt: STARTED_AT,
});

const createWorkflowStep = (): WorkflowStep =>
  ({
    do: vi.fn(async (...args: unknown[]) => {
      const callback = typeof args[1] === "function" ? args[1] : args[2];
      return await (callback as () => Promise<unknown>)();
    }),
  }) as unknown as WorkflowStep;

const createRunMeta = (status: RunMetaState["status"]): RunMetaState => ({
  runId: SNAPSHOT.runId,
  projectId: SNAPSHOT.projectId,
  status,
  triggerType: SNAPSHOT.triggerType,
  branch: SNAPSHOT.branch,
  commitSha: SNAPSHOT.commitSha,
  currentStep: null,
  startedAt: status === "queued" ? null : STARTED_AT,
  finishedAt: status === "passed" || status === "failed" || status === "canceled" ? FINISHED_AT : null,
  exitCode: status === "passed" ? 0 : null,
  errorMessage: null,
});

const createEnv = (runSummary: RunMetaState | null = null): Env =>
  ({
    PROJECT_DO: {
      getByName: () => ({
        getProjectExecutionMaterial: vi.fn(async () => ({
          projectId: SNAPSHOT.projectId,
          encryptedRepoToken: null,
        })),
      }),
    },
    RUN_DO: {
      getByName: () => ({
        getRunSummary: vi.fn(async () => runSummary),
      }),
    },
  }) as unknown as Env;

describe("workflow execute step", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const state = createQueueState();
    mockedModules.context = {
      scope: createQueueScope({
        env: createEnv(),
        startedAt: STARTED_AT,
      }),
      state,
      runStore: createQueueRunStoreStub({
        getMeta: vi.fn(async () => createRunMeta("queued")),
      }),
      logs: createQueueRunLogsStub(),
      runtime: createQueueRunRuntimeStub(),
      control: createQueueRunControlStub(),
      projectControl: {
        getFreshStub: vi.fn(),
        recordHeartbeat: vi.fn(async () => ({
          status: "active" as const,
          cancelRequestedAt: null,
        })),
        recordResolvedCommit: vi.fn(async () => ({ kind: "applied" as const })),
        finalizeRunExecution: vi.fn(async () => ({
          snapshot: SNAPSHOT,
        })),
        kickReconciliation: vi.fn(async () => {}),
      },
    };
    mockedModules.lease = {
      start: vi.fn(),
      ...createQueueLeaseStub(),
    };
  });

  it("keeps the queued path unchanged and enters starting before execution", async () => {
    const result = await executeWorkflowRun(
      createWorkflowStep(),
      mockedModules.context.scope.env,
      SNAPSHOT,
      STARTED_AT,
    );

    expect(result).toBe("passed");
    expect(mockedModules.context.runStore.updateState).toHaveBeenCalledWith({
      status: "starting",
      startedAt: STARTED_AT,
      currentStep: null,
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
    });
    expect(mockedModules.context.runtime.destroySandbox).toHaveBeenCalledTimes(1);
    expect(mockedModules.prepareExecutionEnvironment).toHaveBeenCalledWith(mockedModules.context, mockedModules.lease, {
      executionSessionId: `run-${SNAPSHOT.runId}`,
    });
  });

  it("configures the workflow execute step with a 30 minute timeout", async () => {
    const doMock = vi.fn(async (...args: unknown[]) => {
      const callback = typeof args[1] === "function" ? args[1] : args[2];
      return await (callback as () => Promise<unknown>)();
    });

    await executeWorkflowRun(
      { do: doMock } as unknown as WorkflowStep,
      mockedModules.context.scope.env,
      SNAPSHOT,
      STARTED_AT,
    );

    expect(doMock).toHaveBeenCalledWith(
      "execute run",
      expect.objectContaining({
        timeout: 30 * 60 * 1_000,
        retries: expect.objectContaining({
          limit: 1,
        }),
      }),
      expect.any(Function),
    );
  });

  it("rebuilds the sandbox after workflow replay without re-entering starting", async () => {
    mockedModules.context.runStore = createQueueRunStoreStub({
      getMeta: vi.fn(async () => ({
        ...createRunMeta("running"),
        currentStep: expectTrusted(PositiveInteger, 2, "PositiveInteger"),
      })),
    });

    const result = await executeWorkflowRun(
      createWorkflowStep(),
      mockedModules.context.scope.env,
      SNAPSHOT,
      STARTED_AT,
    );

    expect(result).toBe("passed");
    expect(mockedModules.context.runStore.updateState).not.toHaveBeenCalled();
    expect(mockedModules.context.state.currentStepPosition).toBe(2);
    expect(mockedModules.context.runtime.destroySandbox).toHaveBeenCalledTimes(1);
    expect(mockedModules.prepareExecutionEnvironment).toHaveBeenCalledWith(mockedModules.context, mockedModules.lease, {
      executionSessionId: `run-${SNAPSHOT.runId}`,
    });
    expect(mockedModules.executeRunSteps).toHaveBeenCalledTimes(1);
  });

  it("finalizes as canceled when cancellation is already requested before execution starts", async () => {
    mockedModules.context.projectControl.recordHeartbeat = vi.fn(async () => ({
      status: "cancel_requested" as const,
      cancelRequestedAt: STARTED_AT,
    }));
    mockedModules.lease = {
      start: vi.fn(),
      stop: vi.fn(async () => {}),
      throwIfOwnershipLost: vi.fn(() => {}),
      refreshControl: vi.fn(async () => {
        mockedModules.context.state.cancelRequestedAt = STARTED_AT;
      }),
      isCancellationRequested: () => mockedModules.context.state.cancelRequestedAt !== null,
      applyCancellationIfNeeded: vi.fn(async () => {}),
    };

    const result = await executeWorkflowRun(
      createWorkflowStep(),
      mockedModules.context.scope.env,
      SNAPSHOT,
      STARTED_AT,
    );

    expect(result).toBe("canceled");
    expect(mockedModules.context.runtime.destroySandbox).not.toHaveBeenCalled();
    expect(mockedModules.context.runStore.updateState).not.toHaveBeenCalled();
    expect(mockedModules.prepareExecutionEnvironment).not.toHaveBeenCalled();
    expect(mockedModules.executeRunSteps).not.toHaveBeenCalled();
    expect(mockedModules.finalizeExecution).toHaveBeenCalledWith(mockedModules.context, mockedModules.lease, {
      kind: "canceled",
    });
  });

  it("returns the terminal status immediately and reconciles ProjectDO when RunDO is already terminal", async () => {
    mockedModules.context.scope.env = createEnv({
      ...createRunMeta("passed"),
      finishedAt: FINISHED_AT,
      exitCode: 0,
    });
    mockedModules.context.runStore = createQueueRunStoreStub({
      getMeta: vi.fn(async () => ({
        ...createRunMeta("passed"),
        finishedAt: FINISHED_AT,
        exitCode: 0,
      })),
    });

    const result = await executeWorkflowRun(
      createWorkflowStep(),
      mockedModules.context.scope.env,
      SNAPSHOT,
      STARTED_AT,
    );

    expect(result).toBe("passed");
    expect(mockedModules.recoverTerminalActiveRun).toHaveBeenCalledWith(
      mockedModules.context.scope.env,
      SNAPSHOT.projectId,
      SNAPSHOT.runId,
    );
    expect(mockedModules.context.runtime.destroySandbox).not.toHaveBeenCalled();
    expect(mockedModules.finalizeExecution).not.toHaveBeenCalled();
    expect(mockedModules.prepareExecutionEnvironment).not.toHaveBeenCalled();
  });
});
