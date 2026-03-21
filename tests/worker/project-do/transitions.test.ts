import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { BranchName, DEFAULT_DISPATCH_MODE, DEFAULT_EXECUTION_RUNTIME } from "@/contracts";
import * as sidecarState from "@/worker/durable/project-do/sidecar-state";

import {
  acceptManualRunWithoutAlarm,
  claimRunWorkWithoutAlarm,
  expectAcceptedManualRun,
  finalizeRunExecutionWithoutAlarm,
  requestRunCancelWithoutAlarm,
} from "../../helpers/project-do";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";
import { readProjectDoRows, seedProject, seedUser } from "../../helpers/runtime";

describe("ProjectDO transition invariants", () => {
  registerWorkerRuntimeHooks();

  describe("queue ordering and capacity", () => {
    it("keeps FIFO order and a single active run per project", async () => {
      const user = await seedUser();
      const project = await seedProject(user);
      const stub = env.PROJECT_DO.getByName(project.id);

      const firstAccepted = await acceptManualRunWithoutAlarm(stub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });
      const secondAccepted = await acceptManualRunWithoutAlarm(stub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: BranchName.assertDecode("release"),
      });

      expect(firstAccepted.executable).toBe(true);
      expect(secondAccepted.executable).toBe(false);

      const initialState = await stub.getProjectDetailState(project.id);
      expect(initialState.activeRunId).toBeNull();
      expect(initialState.pendingRuns.map((run) => run.runId)).toEqual([firstAccepted.runId, secondAccepted.runId]);

      const firstClaim = await claimRunWorkWithoutAlarm(stub, {
        projectId: project.id,
        runId: firstAccepted.runId,
      });
      expect(firstClaim.kind).toBe("execute");

      const duplicateClaim = await claimRunWorkWithoutAlarm(stub, {
        projectId: project.id,
        runId: firstAccepted.runId,
      });
      expect(duplicateClaim).toEqual({
        kind: "stale",
        reason: "run_active",
      });

      const supersededClaim = await claimRunWorkWithoutAlarm(stub, {
        projectId: project.id,
        runId: secondAccepted.runId,
      });
      expect(supersededClaim).toEqual({
        kind: "stale",
        reason: "superseded",
      });

      await finalizeRunExecutionWithoutAlarm(stub, {
        projectId: project.id,
        runId: firstAccepted.runId,
        terminalStatus: "passed",
        lastError: null,
      });

      const afterFinalize = await stub.getProjectDetailState(project.id);
      expect(afterFinalize.activeRunId).toBeNull();
      expect(afterFinalize.pendingRuns.map((run) => run.runId)).toEqual([secondAccepted.runId]);

      const secondClaim = await claimRunWorkWithoutAlarm(stub, {
        projectId: project.id,
        runId: secondAccepted.runId,
      });
      expect(secondClaim.kind).toBe("execute");

      const rows = await readProjectDoRows(project.id);
      expect(rows.state?.activeRunId).toBe(secondAccepted.runId);
      expect(rows.runs.map((row) => ({ runId: row.runId, status: row.status }))).toEqual([
        { runId: firstAccepted.runId, status: "passed" },
        { runId: secondAccepted.runId, status: "active" },
      ]);
    });

    it("returns a rejected result when the per-project queue is full", async () => {
      const user = await seedUser({
        email: "queue-full@example.com",
        slug: "queue-full-user",
      });
      const project = await seedProject(user, {
        projectSlug: "queue-full-project",
      });
      const stub = env.PROJECT_DO.getByName(project.id);

      for (let index = 0; index < 20; index += 1) {
        await acceptManualRunWithoutAlarm(stub, {
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: project.defaultBranch,
        });
      }

      const overflow = await stub.acceptManualRun({
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: BranchName.assertDecode("overflow"),
      });

      expect(overflow).toEqual({
        kind: "rejected",
        reason: "queue_full",
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs).toHaveLength(20);
    });
  });

  describe("terminal invariants", () => {
    it("rejects active to canceled finalization", async () => {
      const user = await seedUser({
        email: "active-canceled@example.com",
        slug: "active-canceled-user",
      });
      const project = await seedProject(user, {
        projectSlug: "active-canceled-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });
      const claim = await claimRunWorkWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(claim.kind).toBe("execute");

      await expect(
        finalizeRunExecutionWithoutAlarm(projectStub, {
          projectId: project.id,
          runId: accepted.runId,
          terminalStatus: "canceled",
          lastError: null,
        }),
      ).rejects.toThrow(`Run ${accepted.runId} cannot transition from active to canceled.`);

      const rows = await readProjectDoRows(project.id);
      expect(rows.state?.activeRunId).toBe(accepted.runId);
      expect(rows.runs[0]?.status).toBe("active");
    });

    it("rejects cancel_requested to passed finalization", async () => {
      const user = await seedUser({
        email: "cancel-requested-passed@example.com",
        slug: "cancel-requested-passed-user",
      });
      const project = await seedProject(user, {
        projectSlug: "cancel-requested-passed-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });
      const claim = await claimRunWorkWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(claim.kind).toBe("execute");

      const cancelResult = await requestRunCancelWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(cancelResult.status).toBe("cancel_requested");

      await expect(
        finalizeRunExecutionWithoutAlarm(projectStub, {
          projectId: project.id,
          runId: accepted.runId,
          terminalStatus: "passed",
          lastError: null,
        }),
      ).rejects.toThrow(`Run ${accepted.runId} cannot transition from cancel_requested to passed.`);

      const rows = await readProjectDoRows(project.id);
      expect(rows.state?.activeRunId).toBe(accepted.runId);
      expect(rows.runs[0]?.status).toBe("cancel_requested");
    });

    it("treats duplicate terminal finalization with the same status as idempotent", async () => {
      const user = await seedUser({
        email: "duplicate-terminal@example.com",
        slug: "duplicate-terminal-user",
      });
      const project = await seedProject(user, {
        projectSlug: "duplicate-terminal-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });
      const claim = await claimRunWorkWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(claim.kind).toBe("execute");

      await finalizeRunExecutionWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
        terminalStatus: "failed",
        lastError: "checkout_failed",
      });

      await expect(
        finalizeRunExecutionWithoutAlarm(projectStub, {
          projectId: project.id,
          runId: accepted.runId,
          terminalStatus: "failed",
          lastError: "checkout_failed",
        }),
      ).resolves.toMatchObject({
        snapshot: {
          runId: accepted.runId,
        },
      });

      const rows = await readProjectDoRows(project.id);
      expect(rows.state?.activeRunId).toBeNull();
      expect(rows.runs[0]?.status).toBe("failed");
    });

    it("rejects duplicate terminal finalization when the status changes", async () => {
      const user = await seedUser({
        email: "mismatched-terminal@example.com",
        slug: "mismatched-terminal-user",
      });
      const project = await seedProject(user, {
        projectSlug: "mismatched-terminal-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = await acceptManualRunWithoutAlarm(projectStub, {
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      });
      const claim = await claimRunWorkWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
      });
      expect(claim.kind).toBe("execute");

      await finalizeRunExecutionWithoutAlarm(projectStub, {
        projectId: project.id,
        runId: accepted.runId,
        terminalStatus: "failed",
        lastError: "checkout_failed",
      });

      await expect(
        finalizeRunExecutionWithoutAlarm(projectStub, {
          projectId: project.id,
          runId: accepted.runId,
          terminalStatus: "passed",
          lastError: null,
        }),
      ).rejects.toThrow(`Run ${accepted.runId} is already terminal in status failed, cannot finalize as passed.`);

      const rows = await readProjectDoRows(project.id);
      expect(rows.runs[0]?.status).toBe("failed");
    });
  });

  describe("cancellation and sidecar invariants", () => {
    it("cancels executable runs immediately and promotes the next pending run", async () => {
      const user = await seedUser({
        email: "cancel@example.com",
        slug: "cancel-user",
      });
      const project = await seedProject(user, {
        projectSlug: "cancel-project",
      });
      const stub = env.PROJECT_DO.getByName(project.id);

      const firstAccepted = expectAcceptedManualRun(
        await stub.acceptManualRun({
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: project.defaultBranch,
        }),
      );
      const secondAccepted = expectAcceptedManualRun(
        await stub.acceptManualRun({
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: BranchName.assertDecode("feature-x"),
        }),
      );

      const cancelResult = await stub.requestRunCancel({
        projectId: project.id,
        runId: firstAccepted.runId,
      });
      expect(cancelResult.status).toBe("canceled");

      const nextClaim = await stub.claimRunWork({
        projectId: project.id,
        runId: secondAccepted.runId,
      });
      expect(nextClaim.kind).toBe("execute");

      const canceledClaim = await stub.claimRunWork({
        projectId: project.id,
        runId: firstAccepted.runId,
      });
      expect(canceledClaim).toEqual({
        kind: "stale",
        reason: "canceled",
      });
    });

    it("does not fail claimRunWork after the SQLite commit when heartbeat sidecar writes fail", async () => {
      const user = await seedUser({
        email: "sidecar-heartbeat@example.com",
        slug: "sidecar-heartbeat-user",
      });
      const project = await seedProject(user, {
        projectSlug: "sidecar-heartbeat-project",
      });
      const projectStub = env.PROJECT_DO.getByName(project.id);

      const accepted = expectAcceptedManualRun(
        await projectStub.acceptManualRun({
          projectId: project.id,
          triggeredByUserId: user.id,
          branch: project.defaultBranch,
        }),
      );
      const heartbeatSpy = vi
        .spyOn(sidecarState, "setHeartbeatAt")
        .mockRejectedValueOnce(new Error("heartbeat failed"));

      try {
        const claim = await projectStub.claimRunWork({
          projectId: project.id,
          runId: accepted.runId,
        });

        expect(claim.kind).toBe("execute");

        const rows = await readProjectDoRows(project.id);
        expect(rows.state?.activeRunId).toBe(accepted.runId);
      } finally {
        heartbeatSpy.mockRestore();
      }
    });
  });
});
