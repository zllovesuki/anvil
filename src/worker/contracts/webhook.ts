import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";
import {
  BranchName,
  CommitSha,
  ProjectId,
  RunId,
  UnixTimestampMs,
  WebhookProvider,
  WebhookDeliveryOutcome,
  WebhookEventKind,
} from "@/contracts";
export const WebhookTriggerPayload = eg.exactStrict(
  eg.object({
    provider: WebhookProvider,
    deliveryId: eg.string,
    eventKind: WebhookEventKind,
    eventName: eg.string,
    repoUrl: eg.string,
    ref: eg.union([eg.string, eg.null]),
    branch: eg.union([BranchName, eg.null]),
    commitSha: eg.union([CommitSha, eg.null]),
    beforeSha: eg.union([CommitSha, eg.null]),
  }),
);
export type WebhookTriggerPayload = TypeFromCodec<typeof WebhookTriggerPayload>;
export const RecordVerifiedWebhookDeliveryInput = eg.exactStrict(
  eg.object({
    projectId: ProjectId,
    payload: WebhookTriggerPayload,
    outcome: WebhookDeliveryOutcome,
    verifiedWebhookUpdatedAt: UnixTimestampMs,
  }),
);
export type RecordVerifiedWebhookDeliveryInput = TypeFromCodec<typeof RecordVerifiedWebhookDeliveryInput>;
export const RecordVerifiedWebhookDeliveryResult = eg.exactStrict(
  eg.object({
    outcome: WebhookDeliveryOutcome,
    duplicate: eg.boolean,
    runId: eg.union([RunId, eg.null]),
    queuedAt: eg.union([UnixTimestampMs, eg.null]),
    executable: eg.union([eg.boolean, eg.null]),
    staleVerification: eg.boolean,
  }),
);
export type RecordVerifiedWebhookDeliveryResult = TypeFromCodec<typeof RecordVerifiedWebhookDeliveryResult>;
