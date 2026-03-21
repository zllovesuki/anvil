import type {
  ProjectId,
  UnixTimestampMs,
  WebhookDeliveryOutcome,
  WebhookEventKind,
  WebhookProviderConfig,
  WebhookProvider,
} from "@/contracts";
import type { RecordVerifiedWebhookDeliveryResult, WebhookTriggerPayload } from "@/worker/contracts";
import type * as projectSchema from "@/worker/db/durable/schema/project-do";
import type { EncryptedSecret } from "@/worker/security/secrets";

export interface WebhookVerificationMaterial {
  id: string;
  projectId: ProjectId;
  provider: WebhookProvider;
  enabled: boolean;
  config: WebhookProviderConfig | null;
  updatedAt: UnixTimestampMs;
  encryptedSecret: EncryptedSecret;
}

export interface StoredProjectWebhook {
  id: string;
  projectId: ProjectId;
  provider: WebhookProvider;
  enabled: boolean;
  config: WebhookProviderConfig | null;
  createdAt: number;
  updatedAt: number;
  recentDeliveries: ParsedWebhookDeliveryRow[];
}

export interface UpsertProjectWebhookInput {
  projectId: ProjectId;
  provider: WebhookProvider;
  enabled: boolean;
  config: WebhookProviderConfig | null | undefined;
  encryptedSecret?: EncryptedSecret;
  creating: boolean;
  now: number;
}

export type UpsertProjectWebhookResult =
  | {
      kind: "applied";
      created: boolean;
      webhook: StoredProjectWebhook;
    }
  | {
      kind: "conflict";
      reason: "create_conflict";
    }
  | {
      kind: "rejected";
      reason: "secret_not_allowed";
    }
  | {
      kind: "invalid";
      status: number;
      code: string;
      message: string;
    }
  | {
      kind: "not_found";
    };

export interface RotateProjectWebhookSecretInput {
  projectId: ProjectId;
  provider: WebhookProvider;
  encryptedSecret: EncryptedSecret;
  now: number;
}

export interface DeleteProjectWebhookInput {
  projectId: ProjectId;
  provider: WebhookProvider;
}

export interface TouchProjectWebhookVersionsInput {
  projectId: ProjectId;
  now: number;
}

export interface ParsedWebhookDeliveryRow extends ProjectWebhookDeliveryRow {
  provider: WebhookProvider;
  eventKind: WebhookEventKind;
  outcome: WebhookDeliveryOutcome;
}

type ProjectWebhookRow = typeof projectSchema.projectWebhooks.$inferSelect;
type ProjectWebhookDeliveryRow = typeof projectSchema.projectWebhookDeliveries.$inferSelect;

export interface StoredWebhookReplayResult extends RecordVerifiedWebhookDeliveryResult {
  payload: WebhookTriggerPayload;
  runInitialization: null;
}

export const MAX_WEBHOOK_RECENT_DELIVERIES = 10;
export const WEBHOOK_DELIVERY_RETENTION_MS = 72 * 60 * 60 * 1000;
