import { afterEach, describe, expect, it, vi } from "vitest";

import { BranchName, ProjectId, RunId } from "@/contracts";
import type { RunMetaState } from "@/worker/contracts";
import {
  ensureRunCancelRequested,
  ensureRunCanceling,
  markOwnershipLost,
} from "@/worker/queue/run-execution-context/control";
import type { RunStore } from "@/worker/queue/run-execution-context/types";

import { createQueueScope, createQueueState } from "../../helpers/queue";

const makeScope = () => createQueueScope();

const makeState = () => createQueueState();

const makeRunMeta = (status: RunMetaState["status"], startedAt: RunMetaState["startedAt"] = null): RunMetaState => ({
  runId: RunId.assertDecode("run_0000000000000000000000"),
  projectId: ProjectId.assertDecode("prj_0000000000000000000000"),
  status,
  triggerType: "manual",
  branch: BranchName.assertDecode("main"),
  commitSha: null,
  currentStep: null,
  startedAt,
  finishedAt: null,
  exitCode: null,
  errorMessage: null,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("queue control helpers", () => {
  it("moves a running run to cancel_requested and backfills startedAt", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scope = makeScope();
    const state = makeState();
    const current = makeRunMeta("running");
    const runStore = {
      getMeta: vi.fn(async () => current),
      tryUpdateState: vi.fn(async (input) => ({
        kind: "applied" as const,
        state: {
          ...current,
          ...input,
          runId: current.runId,
          projectId: current.projectId,
        },
      })),
    } as Pick<RunStore, "getMeta" | "tryUpdateState"> as RunStore;

    const result = await ensureRunCancelRequested(scope, state, runStore);

    expect(runStore.tryUpdateState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancel_requested",
        startedAt: scope.startedAt,
      }),
    );
    expect(result?.status).toBe("cancel_requested");
    expect(result?.startedAt).toBe(scope.startedAt);
  });

  it("moves cancel_requested to canceling without changing the rest of the transition data", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scope = makeScope();
    const state = makeState();
    const current = makeRunMeta("cancel_requested", scope.startedAt);
    const runStore = {
      getMeta: vi.fn(async () => current),
      tryUpdateState: vi.fn(async (input) => ({
        kind: "applied" as const,
        state: {
          ...current,
          ...input,
          runId: current.runId,
          projectId: current.projectId,
        },
      })),
    } as Pick<RunStore, "getMeta" | "tryUpdateState"> as RunStore;

    const result = await ensureRunCanceling(scope, state, runStore);

    expect(runStore.tryUpdateState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "canceling",
        startedAt: scope.startedAt,
      }),
    );
    expect(result?.status).toBe("canceling");
  });

  it("marks ownership loss only once", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scope = makeScope();
    const state = makeState();

    markOwnershipLost(scope, state, "failed");
    markOwnershipLost(scope, state, "active");

    expect(state.ownershipLost).toBe(true);
    expect(state.ownershipLossStatus).toBe("failed");
  });
});
