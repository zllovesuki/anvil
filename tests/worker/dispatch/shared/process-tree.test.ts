import { afterEach, describe, expect, it, vi } from "vitest";

import {
  destroySandbox,
  getLiveCurrentProcess,
  softCancelProcessTree,
  waitForProcessTreeToStop,
} from "@/worker/dispatch/shared/run-execution-context/process-tree";
import {
  CONTAINER_NOT_RUNNING_ERROR_SUBSTRING,
  NO_CONTAINER_INSTANCE_ERROR_SUBSTRING,
} from "@/worker/sandbox/container-errors";
import type { RunExecutionContextState } from "@/worker/dispatch/shared/run-execution-context/types";

import { createQueueScope, createQueueState } from "../../../helpers/dispatch/shared";

const makeScope = () => createQueueScope();

const makeState = () => createQueueState();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("queue process helpers", () => {
  it("returns only live current processes", () => {
    const state = makeState();
    state.currentProcess = {
      id: "proc-live",
      status: "running",
    } as RunExecutionContextState["currentProcess"];

    expect(getLiveCurrentProcess(state)?.id).toBe("proc-live");

    state.currentProcess = {
      id: "proc-dead",
      status: "failed",
    } as unknown as RunExecutionContextState["currentProcess"];

    expect(getLiveCurrentProcess(state)).toBeNull();
  });

  it("soft-cancels the current process and the full tree", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scope = makeScope();
    const state = makeState();
    const session = {
      killProcess: vi.fn(async () => {}),
      killAllProcesses: vi.fn(async () => {}),
    };

    await softCancelProcessTree(scope, state, session as never, { id: "proc-1", status: "running" } as never);

    expect(session.killProcess).toHaveBeenCalledWith("proc-1", "SIGTERM");
    expect(session.killAllProcesses).toHaveBeenCalledTimes(1);
  });

  it("waits for the process tree to stop and cleans completed processes", async () => {
    const state = makeState();
    const session = {
      listProcesses: vi.fn(async () => []),
      cleanupCompletedProcesses: vi.fn(async () => {}),
    };

    await expect(waitForProcessTreeToStop(session as never, 50, 0)).resolves.toBe(true);
    expect(session.cleanupCompletedProcesses).toHaveBeenCalledTimes(1);
  });

  it("treats a stopped container as an already-stopped process tree", async () => {
    const session = {
      listProcesses: vi.fn(async () => {
        throw new Error(`Error: The ${CONTAINER_NOT_RUNNING_ERROR_SUBSTRING}, consider calling start()`);
      }),
      cleanupCompletedProcesses: vi.fn(async () => {}),
    };

    await expect(waitForProcessTreeToStop(session as never, 50, 0)).resolves.toBe(true);
  });

  it("returns false when sandbox destroy fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scope = makeScope();
    const state = makeState();
    const order: string[] = [];
    const sandbox = {
      setKeepAlive: vi.fn(async () => {
        order.push("setKeepAlive");
      }),
      destroy: vi.fn(async () => {
        order.push("destroy");
        throw new Error("boom");
      }),
    };

    await expect(destroySandbox(scope, state, sandbox)).resolves.toBe(false);
    expect(sandbox.setKeepAlive).toHaveBeenCalledWith(false);
    expect(order).toEqual(["setKeepAlive", "destroy"]);
  });

  it("treats a missing container instance as already destroyed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scope = makeScope();
    const state = makeState();
    const sandbox = {
      setKeepAlive: vi.fn(async () => {}),
      destroy: vi.fn(async () => {
        throw new Error(`${NO_CONTAINER_INSTANCE_ERROR_SUBSTRING} that can be provided to this durable object`);
      }),
    };

    await expect(destroySandbox(scope, state, sandbox)).resolves.toBe(true);
  });
});
