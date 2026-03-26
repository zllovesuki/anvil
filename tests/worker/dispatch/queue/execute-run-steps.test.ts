import { describe, expect, it, vi } from "vitest";

import { UnixTimestampMs } from "@/contracts";
import { expectTrusted, type RepoConfig } from "@/worker/contracts";
import {
  type PreparedExecutionEnvironment,
  type RunExecutionContext,
} from "@/worker/dispatch/shared/run-execution-context";
import { executeRunSteps } from "@/worker/dispatch/shared/run-steps";
import { createLogBatcher } from "@/worker/dispatch/shared/run-steps/logging";

import {
  createQueueLeaseStub,
  createQueueRunLogsStub,
  createQueueRunStoreStub,
  createQueueScope,
  createQueueState,
} from "../../../helpers/dispatch/shared";

type LogBatcherContext = Parameters<typeof createLogBatcher>[0];
type StepContext = Parameters<typeof executeRunSteps>[0];

const makeScope = (): RunExecutionContext["scope"] =>
  createQueueScope({
    startedAt: expectTrusted(UnixTimestampMs, Date.now(), "UnixTimestampMs"),
  });

const makeState = (): RunExecutionContext["state"] => createQueueState();

const makePrepared = (): PreparedExecutionEnvironment => ({
  repoConfig: {
    version: 1,
    checkout: {
      depth: 1,
    },
    run: {
      workingDirectory: ".",
      timeoutSeconds: 60,
      steps: [
        {
          name: "test",
          run: "npm test",
        },
      ],
    },
  } as RepoConfig,
  workingDirectory: "/workspace/repo",
});

const makePreparedWithSteps = (...commands: string[]): PreparedExecutionEnvironment => ({
  repoConfig: {
    version: 1,
    checkout: {
      depth: 1,
    },
    run: {
      workingDirectory: ".",
      timeoutSeconds: 60,
      steps: commands.map((command, index) => ({
        name: `step-${index + 1}`,
        run: command,
      })),
    },
  } as RepoConfig,
  workingDirectory: "/workspace/repo",
});

const toSseStream = (...events: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });

const createExecStream = (
  ...events: Array<
    | { type: "start"; command?: string; pid?: number }
    | { type: "stdout" | "stderr"; data: string }
    | { type: "complete"; exitCode: number }
    | { type: "error"; error: string }
  >
): ReadableStream<Uint8Array> =>
  toSseStream(
    ...events.map((event) => `data: ${JSON.stringify({ timestamp: "2026-03-24T12:00:00.000Z", ...event })}\n\n`),
  );

describe("queue execute run steps", () => {
  it("flushes buffered logs through the bound run store", async () => {
    const runStore = createQueueRunStoreStub({
      appendLogs: vi.fn(async () => {}),
    });
    const batcher = createLogBatcher({
      runStore,
      scope: makeScope(),
    } satisfies LogBatcherContext);

    batcher.push("stdout", "x".repeat(4096));
    await batcher.flush();

    expect(runStore.appendLogs).toHaveBeenCalledWith([
      expect.objectContaining({
        stream: "stdout",
        chunk: "x".repeat(4096),
      }),
    ]);
  });

  it("summarizes a failed step while preserving stderr logs", async () => {
    const scope = makeScope();
    const state = makeState();
    const runStore = createQueueRunStoreStub({
      updateState: vi.fn(async () => {}),
      updateStepState: vi.fn(async () => {}),
      appendLogs: vi.fn(async () => {}),
    });
    const logs = createQueueRunLogsStub({
      redactMessage: vi.fn((message: string) => `redacted:${message}`),
    });
    const session = {
      execStream: vi.fn(async () =>
        createExecStream(
          { type: "stdout", data: "running build\n" },
          { type: "stderr", data: "boom" },
          { type: "complete", exitCode: 5 },
        ),
      ),
    };
    state.session = session as never;

    const context = {
      scope,
      state,
      runStore,
      logs,
    } satisfies StepContext;

    const outcome = await executeRunSteps(context, createQueueLeaseStub(), makePrepared());

    expect(outcome).toEqual({
      kind: "failed",
      exitCode: 5,
      errorMessage: 'redacted:Step "test" failed with exit code 5.',
    });
    expect(runStore.updateState).toHaveBeenCalledTimes(2);
    expect(runStore.updateStepState).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: "running",
      }),
    );
    expect(runStore.updateStepState).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "failed",
        exitCode: 5,
      }),
    );
    expect(runStore.appendLogs).toHaveBeenCalledTimes(1);
    expect(runStore.appendLogs).toHaveBeenCalledWith([
      expect.objectContaining({
        stream: "stdout",
        chunk: "running build\n",
      }),
      expect.objectContaining({
        stream: "stderr",
        chunk: "boom",
      }),
    ]);
    expect(logs.redactMessage).toHaveBeenCalledWith('Step "test" failed with exit code 5.');
    expect(session.execStream).toHaveBeenCalledWith(
      "npm test",
      expect.objectContaining({
        cwd: "/workspace/repo",
        timeout: expect.any(Number),
      }),
    );
  });

  it("passes a step when execStream emits a successful complete event", async () => {
    const scope = makeScope();
    const state = makeState();
    const runStore = createQueueRunStoreStub({
      updateState: vi.fn(async () => {}),
      updateStepState: vi.fn(async () => {}),
      appendLogs: vi.fn(async () => {}),
    });
    const session = {
      execStream: vi.fn(async () =>
        createExecStream(
          { type: "stdout", data: "hello\n" },
          { type: "stderr", data: "warn\n" },
          { type: "complete", exitCode: 0 },
        ),
      ),
    };
    state.session = session as never;

    const context = {
      scope,
      state,
      runStore,
      logs: createQueueRunLogsStub(),
    } satisfies StepContext;

    const outcome = await executeRunSteps(context, createQueueLeaseStub(), makePrepared());

    expect(outcome).toEqual({
      kind: "passed",
      exitCode: 0,
    });
    expect(runStore.updateStepState).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "passed",
        exitCode: 0,
      }),
    );
  });

  it("tracks and clears the live streamed process when the start event includes a pid", async () => {
    const scope = makeScope();
    const state = makeState();
    const runStore = createQueueRunStoreStub({
      updateState: vi.fn(async () => {}),
      updateStepState: vi.fn(async () => {}),
      appendLogs: vi.fn(async () => {}),
    });
    const liveProcess = {
      id: "proc-1",
      pid: 4242,
      command: "npm test",
      status: "running",
      startTime: new Date("2026-03-24T12:00:00.000Z"),
    };
    const session = {
      execStream: vi.fn(async () =>
        createExecStream(
          { type: "start", pid: 4242 },
          { type: "stdout", data: "hello\n" },
          { type: "complete", exitCode: 0 },
        ),
      ),
      listProcesses: vi.fn(async () => [liveProcess]),
    };
    state.session = session as never;

    const context = {
      scope,
      state,
      runStore,
      logs: createQueueRunLogsStub(),
    } satisfies StepContext;

    const outcome = await executeRunSteps(context, createQueueLeaseStub(), makePrepared());

    expect(outcome).toEqual({
      kind: "passed",
      exitCode: 0,
    });
    expect(session.listProcesses).toHaveBeenCalledTimes(1);
    expect(state.currentProcess).toBeNull();
  });

  it("replays repo-defined commands from the first step even when currentStepPosition is already set", async () => {
    const scope = makeScope();
    const state = makeState();
    state.currentStepPosition = 2 as RunExecutionContext["state"]["currentStepPosition"];
    const runStore = createQueueRunStoreStub({
      updateState: vi.fn(async () => {}),
      updateStepState: vi.fn(async () => {}),
      appendLogs: vi.fn(async () => {}),
    });
    const execStream = vi.fn(async (_command: string, _options?: unknown) =>
      createExecStream({ type: "complete", exitCode: 0 }),
    );
    const session = {
      execStream,
    };
    state.session = session as never;

    const context = {
      scope,
      state,
      runStore,
      logs: createQueueRunLogsStub(),
    } satisfies StepContext;

    const outcome = await executeRunSteps(
      context,
      createQueueLeaseStub(),
      makePreparedWithSteps("echo first", "echo second"),
    );

    expect(outcome).toEqual({
      kind: "passed",
      exitCode: 0,
    });
    expect(execStream.mock.calls.map(([command]) => command)).toEqual(["echo first", "echo second"]);
    expect(runStore.updateStepState).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        position: 1,
        status: "running",
      }),
    );
  });

  it("fails a step when execStream emits a terminal error event", async () => {
    const scope = makeScope();
    const state = makeState();
    const runStore = createQueueRunStoreStub({
      updateState: vi.fn(async () => {}),
      updateStepState: vi.fn(async () => {}),
      appendLogs: vi.fn(async () => {}),
    });
    const logs = createQueueRunLogsStub({
      redactMessage: vi.fn((message: string) => `redacted:${message}`),
    });
    const session = {
      execStream: vi.fn(async () =>
        createExecStream({ type: "stdout", data: "still running\n" }, { type: "error", error: "stream failed" }),
      ),
    };
    state.session = session as never;

    const context = {
      scope,
      state,
      runStore,
      logs,
    } satisfies StepContext;

    const outcome = await executeRunSteps(context, createQueueLeaseStub(), makePrepared());

    expect(outcome).toMatchObject({
      kind: "failed",
      exitCode: 1,
    });
    expect(logs.redactMessage).toHaveBeenCalledWith(expect.stringContaining("stream failed"));
    expect(runStore.updateStepState).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "failed",
      }),
    );
  });

  it("prefers the abnormal stream error over stderr when the stream never completes", async () => {
    const scope = makeScope();
    const state = makeState();
    const runStore = createQueueRunStoreStub({
      updateState: vi.fn(async () => {}),
      updateStepState: vi.fn(async () => {}),
      appendLogs: vi.fn(async () => {}),
    });
    const logs = createQueueRunLogsStub({
      redactMessage: vi.fn((message: string) => `redacted:${message}`),
    });
    const session = {
      execStream: vi.fn(async () =>
        createExecStream(
          { type: "stderr", data: "npm warn deprecated something\n" },
          { type: "stderr", data: "npm warn deprecated else\n" },
        ),
      ),
    };
    state.session = session as never;

    const context = {
      scope,
      state,
      runStore,
      logs,
    } satisfies StepContext;

    const outcome = await executeRunSteps(context, createQueueLeaseStub(), makePrepared());

    expect(outcome).toEqual({
      kind: "failed",
      exitCode: null,
      errorMessage: "redacted:Command stream ended without a terminal event.",
    });
    expect(logs.redactMessage).toHaveBeenCalledWith("Command stream ended without a terminal event.");
  });
});
