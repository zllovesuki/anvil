import {
  BranchName,
  CommitSha,
  type CreateInviteResponse,
  type LogEvent,
  InviteId,
  OwnerSlug,
  type PendingRunSummary,
  type ProjectConfigSummary,
  ProjectId,
  type ProjectDetail,
  ProjectSlug,
  type ProjectSummary,
  type RunDetail,
  type RunExecutionState,
  RunId,
  RunStatus,
  type RunStep,
  type RunSummary,
  TriggerType,
  type UserSummary,
  UserId,
  type WebhookRecentDelivery,
  type WebhookSummary,
  WebhookDeliveryOutcome,
  WebhookEventKind,
  WebhookId,
  WebhookProvider,
} from "@/contracts";
import {
  expectTrusted,
  isoDateTimeFromTimestamp,
  nullableIsoDateTimeFromTimestamp,
  nullableTrusted,
  type PendingRunState,
  type RunLogRecord,
  type RunMetaState,
  type RunStepState,
} from "@/worker/contracts";
import type { InviteRow, RunIndexRow, UserRow } from "@/worker/db/d1/repositories";
import type { ParsedWebhookDeliveryRow, StoredProjectWebhook } from "@/worker/durable/project-do/webhooks/types";

interface ProjectSummarySource {
  id: string;
  ownerUserId: string;
  ownerSlug: string;
  projectSlug: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  configPath: string;
  createdAt: number;
  updatedAt: number;
}

interface ProjectConfigSummarySource extends ProjectSummarySource {
  dispatchMode: "queue" | "workflows";
}

const toIso = (value: number | null) => nullableIsoDateTimeFromTimestamp(value);

export const serializeUserSummary = (user: UserRow): UserSummary => ({
  id: expectTrusted(UserId, user.id, "UserId"),
  slug: expectTrusted(OwnerSlug, user.slug, "OwnerSlug"),
  email: user.email,
  displayName: user.displayName,
  createdAt: isoDateTimeFromTimestamp(user.createdAt),
  disabledAt: toIso(user.disabledAt),
});

export const serializeInvite = (invite: InviteRow, token: string): CreateInviteResponse => ({
  inviteId: expectTrusted(InviteId, invite.id, "InviteId"),
  token,
  expiresAt: isoDateTimeFromTimestamp(invite.expiresAt),
  createdAt: isoDateTimeFromTimestamp(invite.createdAt),
});

export const serializeProjectSummary = (
  project: ProjectSummarySource,
  lastRunStatus: RunStatus | null,
): ProjectSummary => ({
  id: expectTrusted(ProjectId, project.id, "ProjectId"),
  ownerUserId: expectTrusted(UserId, project.ownerUserId, "UserId"),
  ownerSlug: expectTrusted(OwnerSlug, project.ownerSlug, "OwnerSlug"),
  projectSlug: expectTrusted(ProjectSlug, project.projectSlug, "ProjectSlug"),
  name: project.name,
  repoUrl: project.repoUrl,
  defaultBranch: expectTrusted(BranchName, project.defaultBranch, "BranchName"),
  configPath: project.configPath,
  createdAt: isoDateTimeFromTimestamp(project.createdAt),
  updatedAt: isoDateTimeFromTimestamp(project.updatedAt),
  lastRunStatus,
});

export const serializeProjectConfigSummary = (
  project: ProjectConfigSummarySource,
  lastRunStatus: RunStatus | null,
): ProjectConfigSummary => ({
  ...serializeProjectSummary(project, lastRunStatus),
  dispatchMode: project.dispatchMode,
});

export const serializePendingRunSummary = (pendingRun: PendingRunState): PendingRunSummary => ({
  runId: pendingRun.runId,
  branch: pendingRun.branch,
  queuedAt: isoDateTimeFromTimestamp(pendingRun.queuedAt),
});

export const serializeRunSummary = (
  run: Pick<
    RunIndexRow,
    | "id"
    | "projectId"
    | "triggeredByUserId"
    | "triggerType"
    | "branch"
    | "commitSha"
    | "status"
    | "queuedAt"
    | "startedAt"
    | "finishedAt"
    | "exitCode"
  >,
): RunSummary => ({
  id: expectTrusted(RunId, run.id, "RunId"),
  projectId: expectTrusted(ProjectId, run.projectId, "ProjectId"),
  triggeredByUserId: nullableTrusted(UserId, run.triggeredByUserId, "UserId"),
  triggerType: expectTrusted(TriggerType, run.triggerType, "TriggerType"),
  branch: expectTrusted(BranchName, run.branch, "BranchName"),
  commitSha: nullableTrusted(CommitSha, run.commitSha, "CommitSha"),
  status: expectTrusted(RunStatus, run.status, "RunStatus"),
  queuedAt: isoDateTimeFromTimestamp(run.queuedAt),
  startedAt: toIso(run.startedAt),
  finishedAt: toIso(run.finishedAt),
  exitCode: run.exitCode,
});

export const serializeRunStep = (step: RunStepState): RunStep => ({
  id: step.id,
  runId: step.runId,
  position: step.position,
  name: step.name,
  command: step.command,
  status: step.status,
  startedAt: toIso(step.startedAt),
  finishedAt: toIso(step.finishedAt),
  exitCode: step.exitCode,
});

export const serializeRunExecutionState = (meta: RunMetaState): RunExecutionState => ({
  status: meta.status,
  currentStep: meta.currentStep,
  startedAt: toIso(meta.startedAt),
  finishedAt: toIso(meta.finishedAt),
  exitCode: meta.exitCode,
  errorMessage: meta.errorMessage,
});

export const serializeLogEvent = (event: RunLogRecord): LogEvent => ({
  id: event.id,
  runId: event.runId,
  seq: event.seq,
  stream: event.stream,
  chunk: event.chunk,
  createdAt: isoDateTimeFromTimestamp(event.createdAt),
});

export const serializeProjectDetail = (detail: {
  project: ProjectConfigSummarySource;
  lastRunStatus: RunStatus | null;
  activeRun: RunSummary | null;
  pendingRuns: PendingRunSummary[];
}): ProjectDetail => ({
  project: serializeProjectConfigSummary(detail.project, detail.lastRunStatus),
  activeRun: detail.activeRun,
  pendingRuns: detail.pendingRuns,
});

export const serializeRunDetail = (detail: {
  run: RunSummary;
  currentStep: number | null;
  errorMessage: string | null;
  steps: RunStep[];
  recentLogs: LogEvent[];
  detailAvailable: boolean;
}): RunDetail => ({
  run: detail.run,
  currentStep: detail.currentStep,
  errorMessage: detail.errorMessage,
  steps: detail.steps,
  recentLogs: detail.recentLogs,
  detailAvailable: detail.detailAvailable,
});

export const serializeWebhookRecentDelivery = (
  delivery: Pick<
    ParsedWebhookDeliveryRow,
    | "provider"
    | "deliveryId"
    | "eventKind"
    | "eventName"
    | "outcome"
    | "repoUrl"
    | "ref"
    | "branch"
    | "commitSha"
    | "beforeSha"
    | "runId"
    | "receivedAt"
  >,
): WebhookRecentDelivery => ({
  provider: expectTrusted(WebhookProvider, delivery.provider, "WebhookProvider"),
  deliveryId: delivery.deliveryId,
  eventKind: expectTrusted(WebhookEventKind, delivery.eventKind, "WebhookEventKind"),
  eventName: delivery.eventName,
  outcome: expectTrusted(WebhookDeliveryOutcome, delivery.outcome, "WebhookDeliveryOutcome"),
  repoUrl: delivery.repoUrl,
  ref: delivery.ref,
  branch: nullableTrusted(BranchName, delivery.branch, "BranchName"),
  commitSha: nullableTrusted(CommitSha, delivery.commitSha, "CommitSha"),
  beforeSha: nullableTrusted(CommitSha, delivery.beforeSha, "CommitSha"),
  runId: nullableTrusted(RunId, delivery.runId, "RunId"),
  receivedAt: isoDateTimeFromTimestamp(delivery.receivedAt),
});

export const serializeWebhookSummary = (webhook: StoredProjectWebhook): WebhookSummary => ({
  id: expectTrusted(WebhookId, webhook.id, "WebhookId"),
  projectId: expectTrusted(ProjectId, webhook.projectId, "ProjectId"),
  provider: expectTrusted(WebhookProvider, webhook.provider, "WebhookProvider"),
  enabled: webhook.enabled,
  config: webhook.config,
  createdAt: isoDateTimeFromTimestamp(webhook.createdAt),
  updatedAt: isoDateTimeFromTimestamp(webhook.updatedAt),
  recentDeliveries: webhook.recentDeliveries.map(serializeWebhookRecentDelivery),
});
