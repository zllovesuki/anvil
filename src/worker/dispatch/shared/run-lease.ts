import type { ProjectRunStatus } from "@/worker/contracts";

import {
  CANCEL_GRACE_MS,
  HEARTBEAT_INTERVAL_MS,
  logger,
  now,
  sleep,
  type RunExecutionContext,
} from "@/worker/dispatch/shared/run-execution-context";

type RunLeaseContext = Pick<RunExecutionContext, "control" | "logs" | "projectControl" | "runtime" | "scope" | "state">;

export interface RunLeaseControl {
  stop(): Promise<void>;
  throwIfOwnershipLost(): void;
  isCancellationRequested(): boolean;
  refreshControl(): Promise<void>;
  applyCancellationIfNeeded(): Promise<void>;
}

const isOwnedProjectRunStatus = (status: ProjectRunStatus): boolean =>
  status === "active" || status === "cancel_requested";

export class RunOwnershipLostError extends Error {
  constructor(readonly observedStatus: ProjectRunStatus | null) {
    super(`Run ownership lost${observedStatus ? ` with ProjectDO status ${observedStatus}` : ""}.`);
    this.name = "RunOwnershipLostError";
  }
}

export class RunLease implements RunLeaseControl {
  private heartbeatPromise: Promise<void> | null = null;
  private stopRequested = false;

  constructor(private readonly context: RunLeaseContext) {}

  start(): void {
    if (this.heartbeatPromise) {
      return;
    }

    this.stopRequested = false;
    this.heartbeatPromise = this.runHeartbeatLoop();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (!this.heartbeatPromise) {
      return;
    }

    await this.heartbeatPromise;
  }

  throwIfOwnershipLost(): void {
    if (this.context.state.ownershipLost) {
      throw new RunOwnershipLostError(this.context.state.ownershipLossStatus);
    }
  }

  isCancellationRequested(): boolean {
    return this.context.state.cancelRequestedAt !== null;
  }

  async refreshControl(): Promise<void> {
    const control = await this.context.projectControl.recordHeartbeat();

    if (control === null || !isOwnedProjectRunStatus(control.status)) {
      this.context.control.markOwnershipLost(control?.status ?? null);
      this.stopRequested = true;
      return;
    }

    if (control.status === "cancel_requested") {
      this.context.state.cancelRequestedAt = control.cancelRequestedAt ?? this.context.state.cancelRequestedAt ?? now();
    }
  }

  async applyCancellationIfNeeded(): Promise<void> {
    if (this.context.state.ownershipLost) {
      await this.stopForLostOwnershipIfNeeded();
      return;
    }

    if (this.context.state.cancelRequestedAt === null) {
      return;
    }

    this.context.state.phase = "canceling";

    try {
      await this.context.control.ensureRunCancelRequested();
    } catch (error) {
      logger.warn("run_cancel_requested_state_failed", {
        ...this.context.scope.logContext,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (this.context.state.session === null) {
      return;
    }

    const cancellableProcess = this.context.runtime.getLiveCurrentProcess();

    if (!this.context.state.softCancelIssued) {
      this.context.state.softCancelIssued = true;
      try {
        await this.context.control.ensureRunCanceling();
      } catch (error) {
        logger.warn("run_canceling_state_failed", {
          ...this.context.scope.logContext,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await this.context.logs.appendSystemLog(
        cancellableProcess
          ? "Cancellation requested. Sending SIGTERM."
          : "Cancellation requested. Stopping active process tree.",
      );
      await this.context.runtime.softCancelProcessTree(this.context.state.session, cancellableProcess);
      return;
    }

    if (
      !this.context.state.hardCancelIssued &&
      Date.now() - this.context.state.cancelRequestedAt >= CANCEL_GRACE_MS &&
      (await this.context.runtime.isProcessTreeAlive(this.context.state.session))
    ) {
      this.context.state.hardCancelIssued = true;
      logger.warn("run_cancel_hard_kill", { ...this.context.scope.logContext });
      await this.context.logs.appendSystemLog(
        cancellableProcess
          ? "Cancellation grace window expired. Sending SIGKILL."
          : "Cancellation grace window expired. Force-stopping active process tree.",
      );
      await this.context.runtime.hardCancelProcessTree(this.context.state.session, cancellableProcess);
    }
  }

  private async runHeartbeatLoop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        await this.refreshControl();
        await this.applyCancellationIfNeeded();
      } catch (error) {
        logger.warn("run_heartbeat_failed", {
          ...this.context.scope.logContext,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (this.stopRequested) {
        break;
      }

      await sleep(HEARTBEAT_INTERVAL_MS);
    }
  }

  private async stopForLostOwnershipIfNeeded(): Promise<void> {
    if (this.context.state.session === null) {
      return;
    }

    const stoppableProcess = this.context.runtime.getLiveCurrentProcess();

    if (!this.context.state.softCancelIssued) {
      this.context.state.softCancelIssued = true;
      await this.context.runtime.softCancelProcessTree(this.context.state.session, stoppableProcess);
      return;
    }

    if (
      !this.context.state.hardCancelIssued &&
      (await this.context.runtime.isProcessTreeAlive(this.context.state.session))
    ) {
      this.context.state.hardCancelIssued = true;
      await this.context.runtime.hardCancelProcessTree(this.context.state.session, stoppableProcess);
    }
  }
}
