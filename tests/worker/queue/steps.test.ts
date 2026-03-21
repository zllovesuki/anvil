import { describe, expect, it, vi } from "vitest";

import { UnixTimestampMs } from "@/contracts";
import { expectTrusted, type RepoConfig } from "@/worker/contracts";
import { type PreparedExecutionEnvironment, type RunExecutionContext } from "@/worker/queue/run-execution-context";
import { executeRunSteps } from "@/worker/queue/run-steps/executor";
import { createLogBatcher } from "@/worker/queue/run-steps/logging";

import {
  createQueueLeaseStub,
  createQueueRunLogsStub,
  createQueueRunStoreStub,
  createQueueScope,
  createQueueState,
} from "../../helpers/queue";

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

describe("queue steps", () => {
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

  it("fails a step, records step state, and redacts stderr output", async () => {
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
    const process = {
      id: "proc-1",
      status: "running",
      waitForExit: vi.fn(async () => ({ exitCode: 5 })),
    };
    const session = {
      startProcess: vi.fn(async () => process),
      streamProcessLogs: vi.fn(async () => toSseStream("event: exit\n\n")),
      getProcessLogs: vi.fn(async () => ({
        stdout: "",
        stderr: "boom",
      })),
      getProcess: vi.fn(async () => ({
        status: "failed",
        exitCode: 5,
      })),
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
      errorMessage: "redacted:boom",
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
    expect(logs.redactMessage).toHaveBeenCalledWith("boom");
    expect(state.currentProcess).toBeNull();
  });
});
