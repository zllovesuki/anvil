import { BranchName, CommitSha, ProjectId, RunId, TriggerType, UnixTimestampMs } from "@/contracts";
import {
  type ProjectRunTerminalStatus,
  type EnsureRunInput,
  type UpdateRunStateInput,
  expectTrusted,
  nullableTrusted,
} from "@/worker/contracts";

import type { ProjectDoContext, ProjectRunRow, RunDoCancelUpdateOutcome } from "./types";

const getRunStub = (context: ProjectDoContext, runId: RunId) => context.env.RUN_DO.getByName(runId);
const now = (): UnixTimestampMs => expectTrusted(UnixTimestampMs, Date.now(), "UnixTimestampMs");

export const ensureRunInitializedWithPayload = async (
  context: ProjectDoContext,
  payload: EnsureRunInput,
): Promise<void> => {
  await getRunStub(context, payload.runId).ensureInitialized(payload);
};

export const ensureRunInitialized = async (context: ProjectDoContext, row: ProjectRunRow): Promise<void> => {
  const runId = expectTrusted(RunId, row.runId, "RunId");
  const payload: EnsureRunInput = {
    runId,
    projectId: expectTrusted(ProjectId, row.projectId, "ProjectId"),
    triggerType: expectTrusted(TriggerType, row.triggerType, "TriggerType"),
    branch: expectTrusted(BranchName, row.branch, "BranchName"),
    commitSha: nullableTrusted(CommitSha, row.commitSha, "CommitSha"),
  };

  await ensureRunInitializedWithPayload(context, payload);
};

export const updateRunDoCancelRequested = async (
  context: ProjectDoContext,
  row: ProjectRunRow,
): Promise<RunDoCancelUpdateOutcome> => {
  const runId = expectTrusted(RunId, row.runId, "RunId");
  const runStub = getRunStub(context, runId);
  await ensureRunInitialized(context, row);

  const current = await runStub.getRunSummary(runId);
  if (!current) {
    return "deferred";
  }

  if (current.status === "passed" || current.status === "failed" || current.status === "canceled") {
    return "noop";
  }

  if (current.status === "queued" || current.status === "cancel_requested" || current.status === "canceling") {
    return current.status === "queued" ? "deferred" : "noop";
  }

  const update: UpdateRunStateInput = {
    runId,
    status: "cancel_requested",
    currentStep: current.currentStep,
    startedAt: current.startedAt,
    finishedAt: current.finishedAt,
    exitCode: current.exitCode,
    errorMessage: current.errorMessage,
  };
  await runStub.updateRunState(update);
  return "applied";
};

export const setRunDoTerminal = async (
  context: ProjectDoContext,
  row: ProjectRunRow,
  terminalStatus: ProjectRunTerminalStatus,
  errorMessage: string | null,
): Promise<void> => {
  const runId = expectTrusted(RunId, row.runId, "RunId");
  const runStub = getRunStub(context, runId);
  await ensureRunInitialized(context, row);

  const current = await runStub.getRunSummary(runId);
  if (current && (current.status === "passed" || current.status === "failed" || current.status === "canceled")) {
    return;
  }

  if (terminalStatus === "canceled") {
    if (!current) {
      throw new Error(`Run ${runId} is missing RunDO metadata.`);
    }

    let cancelState = current;
    if (cancelState.status === "starting" || cancelState.status === "running") {
      await runStub.updateRunState({
        runId,
        status: "cancel_requested",
        currentStep: cancelState.currentStep,
        startedAt: cancelState.startedAt ?? now(),
        finishedAt: cancelState.finishedAt,
        exitCode: cancelState.exitCode,
        errorMessage: cancelState.errorMessage,
      });
      const updatedCancelState = await runStub.getRunSummary(runId);
      if (!updatedCancelState) {
        throw new Error(`Run ${runId} is missing RunDO metadata after cancel request.`);
      }
      cancelState = updatedCancelState;
    }

    if (
      cancelState.status !== "queued" &&
      cancelState.status !== "cancel_requested" &&
      cancelState.status !== "canceling"
    ) {
      throw new Error(`Run ${runId} cannot be canceled from RunDO status ${cancelState.status}.`);
    }

    await runStub.updateRunState({
      runId,
      status: "canceled",
      currentStep: null,
      startedAt: cancelState.status === "queued" ? cancelState.startedAt : (cancelState.startedAt ?? now()),
      finishedAt: now(),
      exitCode: null,
      errorMessage,
    });
    return;
  }

  if (current?.status === "cancel_requested" && terminalStatus === "failed") {
    await runStub.updateRunState({
      runId,
      status: "canceling",
      currentStep: current.currentStep,
      startedAt: current.startedAt,
      finishedAt: current.finishedAt,
      exitCode: current.exitCode,
      errorMessage: current.errorMessage,
    });
  }

  const update: UpdateRunStateInput = {
    runId,
    status: terminalStatus,
    currentStep: null,
    startedAt: current?.startedAt ?? null,
    finishedAt: now(),
    exitCode: terminalStatus === "passed" ? (current?.exitCode ?? 0) : (current?.exitCode ?? 1),
    errorMessage,
  };

  const updateResult = await runStub.tryUpdateRunState(update);
  if (updateResult.kind === "conflict") {
    await runStub.repairTerminalState(update);
  }
};
