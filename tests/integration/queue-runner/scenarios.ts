import type { RunDetail, RunStatus } from "@/contracts";

import {
  EXPECTED_LOG_MARKERS,
  EXPECTED_STEP_NAMES,
  FIXTURE_CONFIG_PATH,
  FIXTURE_DEFAULT_BRANCH,
  FIXTURE_REPO_URL,
  GITHUB_WEBHOOK_PROVIDER,
  type ProjectId,
  type RunId,
  type SessionId,
  assert,
  createProject,
  getProjectDetail,
  getProjectWebhooks,
  postGitHubPushWebhook,
  putGitHubWebhook,
  resolveFixtureHeadCommitSha,
  triggerRun,
  waitForAcceptedWebhookDelivery,
  waitForIndexedRun,
  waitForProjectSettled,
  waitForTerminalRun,
} from "./harness";

const assertRunPassed = (detail: RunDetail): void => {
  assert(detail.run.status === "passed", `Expected run ${detail.run.id} to pass, got ${detail.run.status}.`);
  assert(detail.run.exitCode === 0, `Expected run ${detail.run.id} exitCode=0, got ${detail.run.exitCode}.`);
  assert(detail.errorMessage === null, `Expected run ${detail.run.id} errorMessage=null, got ${detail.errorMessage}.`);
  assert(detail.detailAvailable, `Expected run ${detail.run.id} to have detailAvailable=true.`);
  assert(
    typeof detail.run.commitSha === "string" && /^[a-f0-9]{40}$/iu.test(detail.run.commitSha),
    `Expected run ${detail.run.id} to expose a resolved commitSha, got ${detail.run.commitSha}.`,
  );

  const stepNames = detail.steps.map((step) => step.name);
  assert(
    JSON.stringify(stepNames) === JSON.stringify(EXPECTED_STEP_NAMES),
    `Expected step names ${EXPECTED_STEP_NAMES.join(", ")}, got ${stepNames.join(", ")}.`,
  );

  for (const step of detail.steps) {
    assert(step.status === "passed", `Expected step ${step.name} to pass, got ${step.status}.`);
    assert(step.startedAt !== null, `Expected step ${step.name} to have startedAt.`);
    assert(step.finishedAt !== null, `Expected step ${step.name} to have finishedAt.`);
  }

  const logText = detail.recentLogs.map((event) => event.chunk).join("");
  for (const marker of EXPECTED_LOG_MARKERS) {
    assert(logText.includes(marker), `Expected run logs to include "${marker}".`);
  }
};

export const scenarioSingleRunPasses = async (baseUrl: string, sessionId: SessionId): Promise<void> => {
  const project = await createProject(baseUrl, sessionId, "Queue Runner Happy Path");
  const projectId = project.id;
  assert(project.name === "Queue Runner Happy Path", `Expected project name to match, got ${project.name}.`);
  assert(project.repoUrl === FIXTURE_REPO_URL, `Expected project repoUrl to match, got ${project.repoUrl}.`);
  assert(
    project.defaultBranch === FIXTURE_DEFAULT_BRANCH,
    `Expected project defaultBranch to match, got ${project.defaultBranch}.`,
  );
  assert(
    project.configPath === FIXTURE_CONFIG_PATH,
    `Expected project configPath to match, got ${project.configPath}.`,
  );
  const runId = await triggerRun(baseUrl, sessionId, projectId);
  const terminalRun = await waitForTerminalRun(baseUrl, sessionId, runId);
  assertRunPassed(terminalRun);

  await waitForProjectSettled(baseUrl, sessionId, projectId);
  const indexedRun = await waitForIndexedRun(baseUrl, sessionId, projectId, runId, "passed");
  assert(indexedRun.exitCode === 0, `Expected indexed run ${runId} exitCode=0, got ${indexedRun.exitCode}.`);
  assert(
    typeof indexedRun.commitSha === "string" && /^[a-f0-9]{40}$/iu.test(indexedRun.commitSha),
    `Expected indexed run ${runId} to have a resolved commitSha, got ${indexedRun.commitSha}.`,
  );

  const projectDetail = await getProjectDetail(baseUrl, sessionId, projectId);
  assert(projectDetail.project.lastRunStatus === "passed", "Expected project lastRunStatus to be passed.");
};

export const scenarioBackToBackRunsAreSerial = async (baseUrl: string, sessionId: SessionId): Promise<void> => {
  const project = await createProject(baseUrl, sessionId, "Queue Runner Serial Dispatch");
  const projectId = project.id;
  const firstRunId = await triggerRun(baseUrl, sessionId, projectId);
  const secondRunId = await triggerRun(baseUrl, sessionId, projectId);

  const firstRun = await waitForTerminalRun(baseUrl, sessionId, firstRunId);
  const secondRun = await waitForTerminalRun(baseUrl, sessionId, secondRunId);

  assertRunPassed(firstRun);
  assertRunPassed(secondRun);
  const firstFinishedAt = firstRun.run.finishedAt;
  const secondStartedAt = secondRun.run.startedAt;
  assert(firstFinishedAt !== null, `Expected run ${firstRunId} to have finishedAt.`);
  assert(secondStartedAt !== null, `Expected run ${secondRunId} to have startedAt.`);
  assert(
    Date.parse(secondStartedAt) >= Date.parse(firstFinishedAt),
    `Expected run ${secondRunId} to start after ${firstRunId} finished.`,
  );

  await waitForProjectSettled(baseUrl, sessionId, projectId);
  await waitForIndexedRun(baseUrl, sessionId, projectId, firstRunId, "passed");
  await waitForIndexedRun(baseUrl, sessionId, projectId, secondRunId, "passed");
};

export const scenarioWebhookTriggeredRunPasses = async (baseUrl: string, sessionId: SessionId): Promise<void> => {
  const project = await createProject(baseUrl, sessionId, "Queue Runner Webhook Happy Path");
  const projectId = project.id;
  const webhookSecret = "queue-runner-integration-webhook-secret";
  const expectedCommitSha = await resolveFixtureHeadCommitSha();
  const createdWebhook = await putGitHubWebhook(baseUrl, sessionId, projectId, webhookSecret);

  assert(
    createdWebhook.provider === GITHUB_WEBHOOK_PROVIDER,
    `Expected webhook provider github, got ${createdWebhook.provider}.`,
  );
  assert(createdWebhook.enabled, "Expected created GitHub webhook to be enabled.");

  const deliveryId = `github-int-${Date.now().toString(36)}`;
  const webhookResponse = await postGitHubPushWebhook(baseUrl, project, webhookSecret, deliveryId, expectedCommitSha);
  assert(
    webhookResponse.status === 202,
    `Expected webhook delivery ${deliveryId} to return HTTP 202, got ${webhookResponse.status}: ${webhookResponse.text}`,
  );

  const delivery = await waitForAcceptedWebhookDelivery(baseUrl, sessionId, projectId, deliveryId);
  assert(delivery.runId !== null, `Expected webhook delivery ${deliveryId} to include a runId.`);
  assert(delivery.provider === GITHUB_WEBHOOK_PROVIDER, `Expected delivery provider github, got ${delivery.provider}.`);
  assert(
    delivery.commitSha === expectedCommitSha,
    `Expected delivery commitSha ${expectedCommitSha}, got ${delivery.commitSha}.`,
  );

  const runId = delivery.runId;
  const terminalRun = await waitForTerminalRun(baseUrl, sessionId, runId);
  assertRunPassed(terminalRun);
  assert(
    terminalRun.run.triggerType === "webhook",
    `Expected run ${runId} triggerType=webhook, got ${terminalRun.run.triggerType}.`,
  );
  assert(terminalRun.run.triggeredByUserId === null, `Expected run ${runId} triggeredByUserId=null.`);
  assert(terminalRun.run.branch === FIXTURE_DEFAULT_BRANCH, `Expected run ${runId} branch=${FIXTURE_DEFAULT_BRANCH}.`);
  assert(
    terminalRun.run.commitSha === expectedCommitSha,
    `Expected run ${runId} commitSha=${expectedCommitSha}, got ${terminalRun.run.commitSha}.`,
  );

  await waitForProjectSettled(baseUrl, sessionId, projectId);
  const indexedRun = await waitForIndexedRun(baseUrl, sessionId, projectId, runId, "passed");
  assert(indexedRun.exitCode === 0, `Expected indexed run ${runId} exitCode=0, got ${indexedRun.exitCode}.`);
  assert(
    indexedRun.triggerType === "webhook",
    `Expected indexed run ${runId} triggerType=webhook, got ${indexedRun.triggerType}.`,
  );
  assert(indexedRun.triggeredByUserId === null, `Expected indexed run ${runId} triggeredByUserId=null.`);
  assert(
    indexedRun.commitSha === expectedCommitSha,
    `Expected indexed run ${runId} commitSha=${expectedCommitSha}, got ${indexedRun.commitSha}.`,
  );

  const webhookListing = await getProjectWebhooks(baseUrl, sessionId, projectId);
  const webhook = webhookListing.webhooks.find((candidate) => candidate.provider === GITHUB_WEBHOOK_PROVIDER);
  assert(webhook !== undefined, "Expected GitHub webhook to be listed.");
  const recordedDelivery = webhook.recentDeliveries.find((candidate) => candidate.deliveryId === deliveryId);
  assert(recordedDelivery !== undefined, `Expected webhook recent deliveries to include ${deliveryId}.`);
  assert(recordedDelivery.outcome === "accepted", `Expected delivery ${deliveryId} outcome=accepted.`);
  assert(
    recordedDelivery.runId === runId,
    `Expected delivery ${deliveryId} runId=${runId}, got ${recordedDelivery.runId}.`,
  );
  assert(
    recordedDelivery.commitSha === expectedCommitSha,
    `Expected delivery ${deliveryId} commitSha=${expectedCommitSha}, got ${recordedDelivery.commitSha}.`,
  );

  const projectDetail = await getProjectDetail(baseUrl, sessionId, projectId);
  assert(projectDetail.project.lastRunStatus === "passed", "Expected project lastRunStatus to be passed.");
};
