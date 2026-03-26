import { vi } from "vitest";

import {
  BranchName,
  DEFAULT_DISPATCH_MODE,
  DEFAULT_EXECUTION_RUNTIME,
  ProjectId,
  RunId,
  UnixTimestampMs,
  type CommitSha as CommitShaType,
} from "@/contracts";
import { expectTrusted } from "@/worker/contracts";
import type { ProjectExecutionMaterial } from "@/worker/durable/project-do/types";
import type {
  ProjectControl,
  RunControl,
  RunExecutionContextState,
  RunExecutionScope,
  RunLogs,
  RunRuntime,
  RunStore,
} from "@/worker/dispatch/shared/run-execution-context/types";
import type { RunLeaseControl } from "@/worker/dispatch/shared/run-lease";

const DEFAULT_PROJECT_ID = ProjectId.assertDecode("prj_0000000000000000000000");
const DEFAULT_RUN_ID = RunId.assertDecode("run_0000000000000000000000");
const DEFAULT_BRANCH = BranchName.assertDecode("main");
const DEFAULT_STARTED_AT = expectTrusted(UnixTimestampMs, 1_740_000_000_000, "UnixTimestampMs");
const DEFAULT_REPO_ROOT = "/workspace/repo";
const DEFAULT_REPO_URL = "https://github.com/example/anvil-spec";
const DEFAULT_CONFIG_PATH = ".anvil.yml";

const createUnusedSyncStub = (label = "unused") =>
  vi.fn(() => {
    throw new Error(label);
  });

const createUnusedAsyncStub = (label = "unused") =>
  vi.fn(async () => {
    throw new Error(label);
  });

interface QueueExecutionMaterialOptions extends Partial<ProjectExecutionMaterial> {
  projectId?: ProjectExecutionMaterial["projectId"];
}

interface QueueScopeOptions {
  env?: Env;
  projectId?: RunExecutionScope["projectId"];
  runId?: RunExecutionScope["runId"];
  startedAt?: RunExecutionScope["startedAt"];
  snapshotCommitSha?: CommitShaType | null;
  executionMaterial?: ProjectExecutionMaterial;
  repoRoot?: RunExecutionScope["repoRoot"];
  repoUrl?: string;
  branch?: string;
  configPath?: string;
}

interface QueueLeaseStubOptions {
  stop?: RunLeaseControl["stop"];
  throwIfOwnershipLost?: RunLeaseControl["throwIfOwnershipLost"];
  refreshControl?: RunLeaseControl["refreshControl"];
  isCancellationRequested?: boolean;
  applyCancellationIfNeeded?: RunLeaseControl["applyCancellationIfNeeded"];
}

export const createQueueExecutionMaterial = (
  options: QueueExecutionMaterialOptions = {},
): ProjectExecutionMaterial => ({
  projectId: options.projectId ?? DEFAULT_PROJECT_ID,
  encryptedRepoToken: options.encryptedRepoToken ?? null,
});

export const createQueueScope = (options: QueueScopeOptions = {}): RunExecutionScope => {
  const projectId =
    options.projectId ??
    (options.executionMaterial
      ? expectTrusted(ProjectId, options.executionMaterial.projectId, "ProjectId")
      : DEFAULT_PROJECT_ID);
  const runId = options.runId ?? DEFAULT_RUN_ID;
  const startedAt = options.startedAt ?? DEFAULT_STARTED_AT;
  const repoUrl = options.repoUrl ?? DEFAULT_REPO_URL;
  const branch = options.branch ? expectTrusted(BranchName, options.branch, "BranchName") : DEFAULT_BRANCH;
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  const snapshot = {
    projectId,
    runId,
    triggerType: "manual" as const,
    triggeredByUserId: null,
    repoUrl,
    branch,
    commitSha: options.snapshotCommitSha ?? null,
    configPath,
    dispatchMode: DEFAULT_DISPATCH_MODE,
    executionRuntime: DEFAULT_EXECUTION_RUNTIME,
    queuedAt: startedAt,
  };
  const executionMaterial =
    options.executionMaterial ??
    createQueueExecutionMaterial({
      projectId,
    });

  return {
    env: options.env ?? ({} as Env),
    executionMaterial,
    claim: {
      kind: "execute",
      snapshot,
    },
    snapshot,
    projectId,
    runId,
    repoRoot: options.repoRoot ?? DEFAULT_REPO_ROOT,
    startedAt,
    logContext: {
      projectId,
      runId,
    },
  };
};

export const createQueueState = (overrides: Partial<RunExecutionContextState> = {}): RunExecutionContextState => ({
  phase: "booting",
  session: null,
  currentProcess: null,
  currentStepPosition: null,
  cancelRequestedAt: null,
  ownershipLost: false,
  ownershipLossStatus: null,
  softCancelIssued: false,
  hardCancelIssued: false,
  preservedTerminalStatus: null,
  redactionSecrets: [],
  ...overrides,
});

export const createQueueLeaseStub = (options: QueueLeaseStubOptions = {}): RunLeaseControl => ({
  stop: options.stop ?? vi.fn(async () => {}),
  throwIfOwnershipLost: options.throwIfOwnershipLost ?? vi.fn(() => {}),
  refreshControl: options.refreshControl ?? vi.fn(async () => {}),
  isCancellationRequested: () => options.isCancellationRequested ?? false,
  applyCancellationIfNeeded: options.applyCancellationIfNeeded ?? vi.fn(async () => {}),
});

export const createQueueRunStoreStub = (overrides: Partial<RunStore> = {}): RunStore => ({
  getFreshStub: createUnusedSyncStub(),
  getMeta: createUnusedAsyncStub(),
  updateState: vi.fn(async () => {}),
  tryUpdateState: createUnusedAsyncStub(),
  repairTerminalState: vi.fn(async () => {}),
  replaceSteps: vi.fn(async () => {}),
  updateStepState: vi.fn(async () => {}),
  appendLogs: vi.fn(async () => {}),
  ...overrides,
});

export const createQueueProjectControlStub = (overrides: Partial<ProjectControl> = {}): ProjectControl => ({
  getFreshStub: createUnusedSyncStub(),
  recordHeartbeat: vi.fn(async () => null),
  recordResolvedCommit: createUnusedAsyncStub(),
  finalizeRunExecution: vi.fn(async (_terminalStatus, _lastError, _sandboxDestroyed) => {
    throw new Error("unused");
  }),
  kickReconciliation: vi.fn(async (_trigger: string) => {}),
  ...overrides,
});

export const createQueueRunControlStub = (overrides: Partial<RunControl> = {}): RunControl => ({
  getRunMeta: createUnusedAsyncStub(),
  updateRunFromCurrent: createUnusedAsyncStub(),
  preserveTerminalOutcome: vi.fn(),
  ensureRunCancelRequested: vi.fn(async () => null),
  ensureRunCanceling: vi.fn(async () => null),
  markOwnershipLost: vi.fn(),
  ...overrides,
});

export const createQueueRunLogsStub = (overrides: Partial<RunLogs> = {}): RunLogs => ({
  appendSystemLog: vi.fn(async () => {}),
  redactMessage: vi.fn((message: string) => message),
  ...overrides,
});

export const createQueueRunRuntimeStub = (overrides: Partial<RunRuntime> = {}): RunRuntime => ({
  sandbox: {} as RunRuntime["sandbox"],
  getSession: createUnusedAsyncStub(),
  deleteSession: vi.fn(async () => {}),
  disposeSession: vi.fn((_session: Parameters<RunRuntime["disposeSession"]>[0]) => {}),
  getLiveCurrentProcess: vi.fn(() => null),
  isProcessTreeAlive: vi.fn(async () => false),
  softCancelProcessTree: vi.fn(async () => {}),
  hardCancelProcessTree: vi.fn(async () => {}),
  waitForProcessTreeToStop: vi.fn(async () => true),
  waitForProcessTreeToStopSafely: vi.fn(async () => true),
  destroySandbox: vi.fn(async () => true),
  dispose: vi.fn(() => {}),
  ...overrides,
});
