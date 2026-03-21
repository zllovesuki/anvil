import { RunDetail, WebhookSummary, type RunSummary, type WebhookProvider } from "@/contracts";
import type { MockWebhookRecord } from "./types";
import { ENTITY_ID_ALPHABET, randomString } from "./utils";

export const buildMockRunDetail = (run: RunSummary): RunDetail => {
  const cancelStatuses = new Set(["cancel_requested", "canceling", "canceled"]);

  let step1Status: string;
  let step2Status: string;
  let step1ExitCode: number | null = null;
  let step2ExitCode: number | null = null;
  let step1StartedAt: string | null = run.startedAt;
  let step1FinishedAt: string | null = null;
  let step2StartedAt: string | null = null;
  let step2FinishedAt: string | null = null;

  if (run.status === "passed") {
    step1Status = "passed";
    step2Status = "passed";
    step1ExitCode = 0;
    step2ExitCode = 0;
    step1FinishedAt = run.startedAt ? new Date(Date.parse(run.startedAt) + 30000).toISOString() : null;
    step2StartedAt = step1FinishedAt;
    step2FinishedAt = run.finishedAt;
  } else if (run.status === "failed") {
    step1Status = "passed";
    step2Status = "failed";
    step1ExitCode = 0;
    step2ExitCode = 1;
    step1FinishedAt = run.startedAt ? new Date(Date.parse(run.startedAt) + 30000).toISOString() : null;
    step2StartedAt = step1FinishedAt;
    step2FinishedAt = run.finishedAt;
  } else if (run.status === "running") {
    step1Status = "passed";
    step2Status = "running";
    step1ExitCode = 0;
    step1FinishedAt = run.startedAt ? new Date(Date.parse(run.startedAt) + 30000).toISOString() : null;
    step2StartedAt = step1FinishedAt;
  } else if (cancelStatuses.has(run.status)) {
    step1Status = "passed";
    step2Status = "failed";
    step1ExitCode = 0;
    step2ExitCode = 1;
    step1FinishedAt = run.startedAt ? new Date(Date.parse(run.startedAt) + 30000).toISOString() : null;
    step2StartedAt = step1FinishedAt;
    step2FinishedAt = run.finishedAt;
  } else {
    // queued, starting
    step1Status = "queued";
    step2Status = "queued";
  }

  const steps = [
    {
      id: `${run.id}-step-1`,
      runId: run.id,
      position: 1,
      name: "Install dependencies",
      command: "npm ci",
      status: step1Status,
      startedAt: step1StartedAt,
      finishedAt: step1FinishedAt,
      exitCode: step1ExitCode,
    },
    {
      id: `${run.id}-step-2`,
      runId: run.id,
      position: 2,
      name: "Run tests",
      command: "npm test",
      status: step2Status,
      startedAt: step2StartedAt,
      finishedAt: step2FinishedAt,
      exitCode: step2ExitCode,
    },
  ];

  const baseTime = run.startedAt ? Date.parse(run.startedAt) : Date.parse(run.queuedAt);
  const recentLogs = [
    {
      id: `${run.id}-log-1`,
      runId: run.id,
      seq: 1,
      stream: "system",
      chunk: "=== Step 1: Install dependencies ===",
      createdAt: new Date(baseTime).toISOString(),
    },
    {
      id: `${run.id}-log-2`,
      runId: run.id,
      seq: 2,
      stream: "stdout",
      chunk: "$ npm ci --prefer-offline",
      createdAt: new Date(baseTime + 1000).toISOString(),
    },
    {
      id: `${run.id}-log-3`,
      runId: run.id,
      seq: 3,
      stream: "stdout",
      chunk: "added 342 packages in 4.2s",
      createdAt: new Date(baseTime + 5000).toISOString(),
    },
    {
      id: `${run.id}-log-4`,
      runId: run.id,
      seq: 4,
      stream: "system",
      chunk: "=== Step 2: Run tests ===",
      createdAt: new Date(baseTime + 30000).toISOString(),
    },
    {
      id: `${run.id}-log-5`,
      runId: run.id,
      seq: 5,
      stream: run.status === "failed" ? "stderr" : "stdout",
      chunk: run.status === "failed" ? "Error: 2 tests failed" : "All tests passed (14 specs, 0 failures)",
      createdAt: new Date(baseTime + 60000).toISOString(),
    },
  ];

  const currentStep = run.status === "running" ? 2 : null;
  const errorMessage = run.status === "failed" ? "Step 'Run tests' failed with exit code 1" : null;

  return RunDetail.assertDecode({
    run,
    currentStep,
    errorMessage,
    steps,
    recentLogs,
    detailAvailable: true,
  });
};

export const buildMockDeliveries = (
  provider: WebhookProvider,
  repoUrl: string,
  defaultBranch: string,
): MockWebhookRecord["deliveries"] => {
  const base = Date.now();
  return [
    {
      deliveryId: randomString(ENTITY_ID_ALPHABET, 12),
      provider,
      eventKind: "push",
      eventName: provider === "gitlab" ? "Push Hook" : "push",
      outcome: "accepted",
      repoUrl,
      ref: `refs/heads/${defaultBranch}`,
      branch: defaultBranch,
      commitSha: randomString("abcdef0123456789", 40),
      beforeSha: randomString("abcdef0123456789", 40),
      runId: null,
      receivedAt: new Date(base - 3600000).toISOString(),
    },
    {
      deliveryId: randomString(ENTITY_ID_ALPHABET, 12),
      provider,
      eventKind: "ping",
      eventName: provider === "gitlab" ? "System Hook" : "ping",
      outcome: "ignored_ping",
      repoUrl,
      ref: null,
      branch: null,
      commitSha: null,
      beforeSha: null,
      runId: null,
      receivedAt: new Date(base - 86400000).toISOString(),
    },
    {
      deliveryId: randomString(ENTITY_ID_ALPHABET, 12),
      provider,
      eventKind: "push",
      eventName: provider === "gitlab" ? "Push Hook" : "push",
      outcome: "ignored_branch",
      repoUrl,
      ref: "refs/heads/feature-experiment",
      branch: "feature-experiment",
      commitSha: randomString("abcdef0123456789", 40),
      beforeSha: randomString("abcdef0123456789", 40),
      runId: null,
      receivedAt: new Date(base - 172800000).toISOString(),
    },
  ];
};

export const buildMockWebhookSummary = (record: MockWebhookRecord): WebhookSummary =>
  WebhookSummary.assertDecode({
    id: record.id,
    projectId: record.projectId,
    provider: record.provider,
    enabled: record.enabled,
    config: record.config,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    recentDeliveries: record.deliveries.slice(0, 10).map((d) => ({
      provider: d.provider,
      deliveryId: d.deliveryId,
      eventKind: d.eventKind,
      eventName: d.eventName,
      outcome: d.outcome,
      repoUrl: d.repoUrl,
      ref: d.ref,
      branch: d.branch,
      commitSha: d.commitSha,
      beforeSha: d.beforeSha,
      runId: d.runId,
      receivedAt: d.receivedAt,
    })),
  });
