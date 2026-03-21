import { afterEach, describe, expect, it, vi } from "vitest";

import { RunId, UnixTimestampMs } from "@/contracts";
import { expectTrusted } from "@/worker/contracts";
import { CANCEL_GRACE_MS } from "@/worker/queue/run-execution-context";
import { RunLease } from "@/worker/queue/run-lease";

import {
  createQueueProjectControlStub,
  createQueueRunControlStub,
  createQueueRunLogsStub,
  createQueueRunRuntimeStub,
  createQueueScope,
  createQueueState,
} from "../../helpers/queue";

type LeaseContext = ConstructorParameters<typeof RunLease>[0];

const makeContext = (): LeaseContext => ({
  scope: createQueueScope(),
  state: createQueueState(),
  projectControl: createQueueProjectControlStub(),
  control: createQueueRunControlStub(),
  logs: createQueueRunLogsStub(),
  runtime: createQueueRunRuntimeStub({
    getLiveCurrentProcess: vi.fn(() => ({ id: "proc-1", status: "running" }) as never),
    isProcessTreeAlive: vi.fn(async () => true),
  }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("run lease", () => {
  it("records cancellation requests from heartbeat control", async () => {
    const context = makeContext();
    context.projectControl.recordHeartbeat = vi.fn(async () => ({
      runId: RunId.assertDecode("run_0000000000000000000000"),
      status: "cancel_requested" as const,
      cancelRequestedAt: expectTrusted(UnixTimestampMs, 1_740_000_000_000, "UnixTimestampMs"),
    }));

    const lease = new RunLease(context);
    await lease.refreshControl();

    expect(context.state.cancelRequestedAt).toBe(1_740_000_000_000);
  });

  it("soft-cancels the active session on the first cancellation pass", async () => {
    const context = makeContext();
    context.state.cancelRequestedAt = expectTrusted(UnixTimestampMs, 1_740_000_000_000, "UnixTimestampMs");
    context.state.session = { id: "session-1" } as never;

    const lease = new RunLease(context);
    await lease.applyCancellationIfNeeded();

    expect(context.state.phase).toBe("canceling");
    expect(context.state.softCancelIssued).toBe(true);
    expect(context.control.ensureRunCancelRequested).toHaveBeenCalledTimes(1);
    expect(context.control.ensureRunCanceling).toHaveBeenCalledTimes(1);
    expect(context.logs.appendSystemLog).toHaveBeenCalledWith("Cancellation requested. Sending SIGTERM.");
    expect(context.runtime.softCancelProcessTree).toHaveBeenCalledWith(
      context.state.session,
      expect.objectContaining({ id: "proc-1" }),
    );
  });

  it("escalates to a hard cancel after the grace window expires", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const context = makeContext();
    context.state.cancelRequestedAt = expectTrusted(
      UnixTimestampMs,
      Date.now() - CANCEL_GRACE_MS - 1,
      "UnixTimestampMs",
    );
    context.state.session = { id: "session-1" } as never;
    context.state.softCancelIssued = true;

    const lease = new RunLease(context);
    await lease.applyCancellationIfNeeded();

    expect(context.state.hardCancelIssued).toBe(true);
    expect(context.logs.appendSystemLog).toHaveBeenCalledWith("Cancellation grace window expired. Sending SIGKILL.");
    expect(context.runtime.hardCancelProcessTree).toHaveBeenCalledWith(
      context.state.session,
      expect.objectContaining({ id: "proc-1" }),
    );
  });
});
