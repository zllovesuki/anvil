import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import { BranchName, CommitSha, IsoDateTime, ProjectId, RunId, WebhookId, WebhookProvider } from "@/contracts/common";

export const WebhookProviderConfig = eg.exactStrict(
  eg.object({
    instanceUrl: eg.string,
  }),
);
export type WebhookProviderConfig = TypeFromCodec<typeof WebhookProviderConfig>;

export const WebhookEventKind = eg.union([eg.literal("push"), eg.literal("ping"), eg.literal("other")]);
export type WebhookEventKind = TypeFromCodec<typeof WebhookEventKind>;

export const WebhookDeliveryOutcome = eg.union([
  eg.literal("accepted"),
  eg.literal("ignored_ping"),
  eg.literal("ignored_event"),
  eg.literal("ignored_branch"),
  eg.literal("queue_full"),
]);
export type WebhookDeliveryOutcome = TypeFromCodec<typeof WebhookDeliveryOutcome>;

export const WebhookRecentDelivery = eg.exactStrict(
  eg.object({
    provider: WebhookProvider,
    deliveryId: eg.string,
    eventKind: WebhookEventKind,
    eventName: eg.string,
    outcome: WebhookDeliveryOutcome,
    repoUrl: eg.string,
    ref: eg.union([eg.string, eg.null]),
    branch: eg.union([BranchName, eg.null]),
    commitSha: eg.union([CommitSha, eg.null]),
    beforeSha: eg.union([CommitSha, eg.null]),
    runId: eg.union([RunId, eg.null]),
    receivedAt: IsoDateTime,
  }),
);
export type WebhookRecentDelivery = TypeFromCodec<typeof WebhookRecentDelivery>;

export const WebhookSummary = eg.exactStrict(
  eg.object({
    id: WebhookId,
    projectId: ProjectId,
    provider: WebhookProvider,
    enabled: eg.boolean,
    config: eg.union([WebhookProviderConfig, eg.null]),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
    recentDeliveries: eg.array(WebhookRecentDelivery),
  }),
);
export type WebhookSummary = TypeFromCodec<typeof WebhookSummary>;

export const GetProjectWebhooksResponse = eg.exactStrict(
  eg.object({
    webhooks: eg.array(WebhookSummary),
  }),
);
export type GetProjectWebhooksResponse = TypeFromCodec<typeof GetProjectWebhooksResponse>;

export const CreateWebhookRequest = eg.exactStrict(
  eg.object({
    enabled: eg.boolean,
    config: eg.union([WebhookProviderConfig, eg.null]).optional,
    secret: eg.string.optional,
  }),
);
export type CreateWebhookRequest = TypeFromCodec<typeof CreateWebhookRequest>;

export const UpdateWebhookRequest = eg.exactStrict(
  eg.object({
    enabled: eg.boolean,
    config: eg.union([WebhookProviderConfig, eg.null]).optional,
  }),
);
export type UpdateWebhookRequest = TypeFromCodec<typeof UpdateWebhookRequest>;

export const UpsertWebhookResponse = eg.exactStrict(
  eg.object({
    webhook: WebhookSummary,
    generatedSecret: eg.union([eg.string, eg.null]),
  }),
);
export type UpsertWebhookResponse = TypeFromCodec<typeof UpsertWebhookResponse>;

export const RotateWebhookSecretResponse = eg.exactStrict(
  eg.object({
    secret: eg.string,
  }),
);
export type RotateWebhookSecretResponse = TypeFromCodec<typeof RotateWebhookSecretResponse>;
