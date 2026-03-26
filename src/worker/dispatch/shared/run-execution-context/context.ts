import { getSandbox } from "@cloudflare/sandbox";

import { type UnixTimestampMs } from "@/contracts";
import { type ExecuteRunWork, type ProjectRunStatus, type RunMetaState } from "@/worker/contracts";
import type { ProjectExecutionMaterial } from "@/worker/durable/project-do/types";
import { redactSecrets as redactSecretValues } from "@/worker/sandbox/git";

import { disposeRpcStub } from "@/worker/dispatch/shared/rpc";
import { deleteSandboxSessionIfExists } from "@/worker/dispatch/shared/sandbox-errors";
import {
  ensureRunCanceling,
  ensureRunCancelRequested,
  markOwnershipLost,
  preserveTerminalOutcome,
  updateRunFromCurrent,
} from "./control";
import {
  destroySandbox,
  getLiveCurrentProcess,
  hardCancelProcessTree,
  isProcessTreeAlive,
  softCancelProcessTree,
  waitForProcessTreeToStop,
  waitForProcessTreeToStopSafely,
} from "./process-tree";
import { getProjectStub, getRunStub, kickProjectReconciliation, now } from "./shared";
import type {
  ProjectControl,
  RunControl,
  RunExecutionContext,
  RunExecutionContextState,
  RunExecutionScope,
  RunExecutionOutcome,
  RunLogs,
  RunRuntime,
  RunStore,
} from "./types";

const createScope = (
  env: Env,
  executionMaterial: ProjectExecutionMaterial,
  claim: ExecuteRunWork,
  options?: {
    startedAt?: UnixTimestampMs;
  },
): RunExecutionScope => ({
  env,
  executionMaterial,
  claim,
  snapshot: claim.snapshot,
  projectId: claim.snapshot.projectId,
  runId: claim.snapshot.runId,
  repoRoot: "/workspace/repo",
  startedAt: options?.startedAt ?? now(),
  logContext: {
    projectId: claim.snapshot.projectId,
    runId: claim.snapshot.runId,
  },
});

const createState = (): RunExecutionContextState => ({
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
});

const createRunStore = (scope: RunExecutionScope): RunStore => ({
  getFreshStub: () => getRunStub(scope.env, scope.runId),
  async getMeta(): Promise<RunMetaState> {
    const current = await getRunStub(scope.env, scope.runId).getRunSummary(scope.runId);
    if (!current) {
      throw new Error(`Run ${scope.runId} is not initialized.`);
    }

    return current;
  },
  async updateState(input) {
    await getRunStub(scope.env, scope.runId).updateRunState({
      runId: scope.runId,
      ...input,
    });
  },
  async tryUpdateState(input) {
    return await getRunStub(scope.env, scope.runId).tryUpdateRunState({
      runId: scope.runId,
      ...input,
    });
  },
  async repairTerminalState(input) {
    await getRunStub(scope.env, scope.runId).repairTerminalState({
      runId: scope.runId,
      ...input,
    });
  },
  async replaceSteps(input) {
    await getRunStub(scope.env, scope.runId).replaceSteps({
      runId: scope.runId,
      ...input,
    });
  },
  async updateStepState(input) {
    await getRunStub(scope.env, scope.runId).updateStepState({
      runId: scope.runId,
      ...input,
    });
  },
  async appendLogs(events) {
    await getRunStub(scope.env, scope.runId).appendLogs({
      runId: scope.runId,
      events,
    });
  },
});

const createProjectControl = (scope: RunExecutionScope): ProjectControl => ({
  getFreshStub: () => getProjectStub(scope.env, scope.projectId),
  async recordHeartbeat() {
    return await getProjectStub(scope.env, scope.projectId).recordRunHeartbeat({
      projectId: scope.projectId,
      runId: scope.runId,
    });
  },
  async recordResolvedCommit(commitSha) {
    return await getProjectStub(scope.env, scope.projectId).recordRunResolvedCommit({
      projectId: scope.projectId,
      runId: scope.runId,
      commitSha,
    });
  },
  async finalizeRunExecution(terminalStatus, lastError, sandboxDestroyed) {
    return await getProjectStub(scope.env, scope.projectId).finalizeRunExecution({
      projectId: scope.projectId,
      runId: scope.runId,
      terminalStatus,
      lastError,
      sandboxDestroyed,
    });
  },
  async kickReconciliation(trigger) {
    await kickProjectReconciliation(scope.env, scope.projectId, scope.runId, trigger);
  },
});

const createLogs = (_scope: RunExecutionScope, state: RunExecutionContextState, runStore: RunStore): RunLogs => ({
  redactMessage(message: string): string {
    return redactSecretValues(message, state.redactionSecrets);
  },
  async appendSystemLog(message: string): Promise<void> {
    await runStore.appendLogs([
      {
        stream: "system",
        chunk: `${message}\n`,
        createdAt: now(),
      },
    ]);
  },
});

const createControl = (scope: RunExecutionScope, state: RunExecutionContextState, runStore: RunStore): RunControl => ({
  async getRunMeta() {
    return await runStore.getMeta();
  },
  async updateRunFromCurrent(current, status, overrides = {}) {
    return await updateRunFromCurrent(scope, state, runStore, current, status, overrides);
  },
  preserveTerminalOutcome(outcome: Exclude<RunExecutionOutcome, { kind: "ownership_lost" | "canceled" }>): void {
    preserveTerminalOutcome(state, outcome);
  },
  async ensureRunCancelRequested() {
    return await ensureRunCancelRequested(scope, state, runStore);
  },
  async ensureRunCanceling() {
    return await ensureRunCanceling(scope, state, runStore);
  },
  markOwnershipLost(status: ProjectRunStatus | null): void {
    markOwnershipLost(scope, state, status);
  },
});

const createRuntime = (scope: RunExecutionScope, state: RunExecutionContextState): RunRuntime => {
  const sandbox = getSandbox(scope.env.Sandbox, scope.runId, {
    keepAlive: true,
  });

  return {
    sandbox,
    async getSession(sessionId) {
      return await sandbox.getSession(sessionId);
    },
    async deleteSession(sessionId) {
      await deleteSandboxSessionIfExists(sandbox, sessionId);
    },
    disposeSession(session) {
      disposeRpcStub(session);
    },
    getLiveCurrentProcess() {
      return getLiveCurrentProcess(state);
    },
    async isProcessTreeAlive(session) {
      return await isProcessTreeAlive(session);
    },
    async softCancelProcessTree(session, process) {
      await softCancelProcessTree(scope, state, session, process);
    },
    async hardCancelProcessTree(session, process) {
      await hardCancelProcessTree(scope, state, session, process);
    },
    async waitForProcessTreeToStop(session, timeoutMs, pollIntervalMs = 250) {
      return await waitForProcessTreeToStop(session, timeoutMs, pollIntervalMs);
    },
    async waitForProcessTreeToStopSafely(session, timeoutMs, cleanupPhase) {
      return await waitForProcessTreeToStopSafely(scope, session, timeoutMs, cleanupPhase);
    },
    async destroySandbox() {
      return await destroySandbox(scope, state, sandbox);
    },
    dispose() {
      disposeRpcStub(sandbox);
    },
  };
};

export const createRunExecutionContext = (
  env: Env,
  executionMaterial: ProjectExecutionMaterial,
  claim: ExecuteRunWork,
  options?: {
    startedAt?: UnixTimestampMs;
  },
): RunExecutionContext => {
  const scope = createScope(env, executionMaterial, claim, options);
  const state = createState();
  const runStore = createRunStore(scope);
  const projectControl = createProjectControl(scope);
  const runtime = createRuntime(scope, state);
  const logs = createLogs(scope, state, runStore);
  const control = createControl(scope, state, runStore);

  return {
    scope,
    state,
    runStore,
    projectControl,
    runtime,
    logs,
    control,
  };
};
