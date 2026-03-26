import { createExecutionContext, createMessageBatch, getQueueResult, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";

import { describe, expect, it } from "vitest";

import { ProjectId, RunId, UnixTimestampMs } from "@/contracts";
import { expectTrusted, type RunQueueMessage } from "@/worker/contracts";
import { ProjectDO } from "@/worker/durable";
import { getSandboxCleanupRetryState } from "@/worker/durable/project-do/sidecar-state";
import worker from "@/worker/index";

import { createTestProjectDoContext, expectAcceptedManualRun } from "../../../helpers/project-do";
import { registerWorkerRuntimeHooks } from "../../../helpers/worker-hooks";
import { readProjectDoRows, seedProject, seedUser } from "../../../helpers/runtime";

describe("queue consumer", () => {
  const toTimestamp = (value: number) => expectTrusted(UnixTimestampMs, value, "UnixTimestampMs");
  registerWorkerRuntimeHooks();

  it("acks queue messages for missing projects", async () => {
    const batch = createMessageBatch("anvil-runs", [
      {
        id: "missing-project",
        attempts: 0,
        timestamp: new Date(),
        body: {
          projectId: ProjectId.assertDecode("prj_0000000000000000000000"),
          runId: RunId.assertDecode("run_0000000000000000000000"),
        } satisfies RunQueueMessage,
      },
    ]);
    const ctx = createExecutionContext();

    await worker.queue!(batch as Parameters<NonNullable<typeof worker.queue>>[0], env, ctx);
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toEqual(["missing-project"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("retries invalid queue payloads", async () => {
    const batch = createMessageBatch("anvil-runs", [
      {
        id: "invalid-message",
        attempts: 0,
        timestamp: new Date(),
        body: {
          projectId: "not-a-project-id",
          runId: "also-invalid",
        },
      },
    ]);
    const ctx = createExecutionContext();

    await worker.queue!(batch as Parameters<NonNullable<typeof worker.queue>>[0], env, ctx);
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([{ msgId: "invalid-message" }]);
  });

  it("recovers stale duplicate active deliveries from terminal RunDO state", async () => {
    const user = await seedUser({
      email: "queue@example.com",
      slug: "queue-user",
    });
    const project = await seedProject(user, {
      projectSlug: "queue-project",
      dispatchMode: "queue",
    });
    const projectStub = env.PROJECT_DO.getByName(project.id);

    const accepted = expectAcceptedManualRun(
      await projectStub.acceptManualRun({
        projectId: project.id,
        triggeredByUserId: user.id,
        branch: project.defaultBranch,
      }),
    );
    const claim = await projectStub.claimRunWork({
      projectId: project.id,
      runId: accepted.runId,
    });
    expect(claim.kind).toBe("execute");

    await env.RUN_DO.getByName(accepted.runId).updateRunState({
      runId: accepted.runId,
      status: "starting",
      currentStep: null,
      startedAt: toTimestamp(Date.now()),
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
    });
    await env.RUN_DO.getByName(accepted.runId).updateRunState({
      runId: accepted.runId,
      status: "running",
      currentStep: null,
      startedAt: toTimestamp(Date.now()),
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
    });
    await env.RUN_DO.getByName(accepted.runId).updateRunState({
      runId: accepted.runId,
      status: "passed",
      currentStep: null,
      startedAt: toTimestamp(Date.now()),
      finishedAt: toTimestamp(Date.now() + 1_000),
      exitCode: 0,
      errorMessage: null,
    });

    const batch = createMessageBatch("anvil-runs", [
      {
        id: "duplicate-active",
        attempts: 0,
        timestamp: new Date(),
        body: {
          projectId: project.id,
          runId: accepted.runId,
        } satisfies RunQueueMessage,
      },
    ]);
    const ctx = createExecutionContext();

    await worker.queue!(batch as Parameters<NonNullable<typeof worker.queue>>[0], env, ctx);
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toEqual(["duplicate-active"]);
    expect(result.retryMessages).toEqual([]);

    const rows = await readProjectDoRows(project.id);
    expect(rows.state?.activeRunId).toBeNull();
    expect(rows.runs[0]?.status).toBe("passed");

    await runInDurableObject(projectStub, async (instance: ProjectDO) => {
      const retryState = await getSandboxCleanupRetryState(createTestProjectDoContext(instance), accepted.runId);
      expect(retryState?.attempt).toBe(1);
      expect(retryState?.nextAt ?? 0).toBeGreaterThan(Date.now());
    });
  });
});
