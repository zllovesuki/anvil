import { and, asc, desc, eq, lt } from "drizzle-orm";

import {
  type ProjectId,
  ProjectId as ProjectIdCodec,
  UnixTimestampMs,
  WebhookProviderConfig as WebhookProviderConfigCodec,
  WebhookProvider as WebhookProviderCodec,
  type WebhookProviderConfig,
  type WebhookProvider,
  WebhookDeliveryOutcome,
  WebhookEventKind,
} from "@/contracts";
import {
  type RecordVerifiedWebhookDeliveryInput,
  type RecordVerifiedWebhookDeliveryResult,
  expectTrusted,
} from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";
import { generateDurableEntityId } from "@/worker/services";

import type { ProjectStore } from "../types";
import type {
  DeleteProjectWebhookInput,
  ParsedWebhookDeliveryRow,
  RotateProjectWebhookSecretInput,
  StoredProjectWebhook,
  TouchProjectWebhookVersionsInput,
  WebhookVerificationMaterial,
} from "./types";

const parseWebhookConfig = (configJson: string | null): WebhookProviderConfig | null => {
  if (configJson === null) {
    return null;
  }

  return WebhookProviderConfigCodec.assertDecode(JSON.parse(configJson) as unknown);
};

export const serializeWebhookConfig = (config: WebhookProviderConfig | null): string | null =>
  config === null ? null : JSON.stringify(config);

const getNextWebhookUpdatedAt = (now: number, previousUpdatedAt?: number): number =>
  previousUpdatedAt === undefined ? now : Math.max(now, previousUpdatedAt + 1);

const parseWebhookRowState = (row: typeof projectSchema.projectWebhooks.$inferSelect) => ({
  id: row.id,
  projectId: expectTrusted(ProjectIdCodec, row.projectId, "ProjectId"),
  provider: expectTrusted(WebhookProviderCodec, row.provider, "WebhookProvider"),
  enabled: row.enabled !== 0,
  config: parseWebhookConfig(row.configJson),
  updatedAt: expectTrusted(UnixTimestampMs, row.updatedAt, "UnixTimestampMs"),
});

export const getProjectWebhookRow = (
  tx: ProjectStore,
  projectId: ProjectId,
  provider: WebhookProvider,
): typeof projectSchema.projectWebhooks.$inferSelect | undefined =>
  tx
    .select()
    .from(projectSchema.projectWebhooks)
    .where(
      and(eq(projectSchema.projectWebhooks.projectId, projectId), eq(projectSchema.projectWebhooks.provider, provider)),
    )
    .limit(1)
    .get();

export const listProjectWebhookRows = (
  tx: ProjectStore,
  projectId: ProjectId,
): Array<typeof projectSchema.projectWebhooks.$inferSelect> =>
  tx
    .select()
    .from(projectSchema.projectWebhooks)
    .where(eq(projectSchema.projectWebhooks.projectId, projectId))
    .orderBy(asc(projectSchema.projectWebhooks.provider))
    .all();

export const listRecentWebhookDeliveryRows = (
  tx: ProjectStore,
  projectId: ProjectId,
  provider: WebhookProvider,
  limit: number,
): Array<typeof projectSchema.projectWebhookDeliveries.$inferSelect> =>
  tx
    .select()
    .from(projectSchema.projectWebhookDeliveries)
    .where(
      and(
        eq(projectSchema.projectWebhookDeliveries.projectId, projectId),
        eq(projectSchema.projectWebhookDeliveries.provider, provider),
      ),
    )
    .orderBy(desc(projectSchema.projectWebhookDeliveries.receivedAt), desc(projectSchema.projectWebhookDeliveries.id))
    .limit(limit)
    .all();

export const getWebhookDeliveryRow = (
  tx: ProjectStore,
  projectId: ProjectId,
  provider: WebhookProvider,
  deliveryId: string,
): typeof projectSchema.projectWebhookDeliveries.$inferSelect | undefined =>
  tx
    .select()
    .from(projectSchema.projectWebhookDeliveries)
    .where(
      and(
        eq(projectSchema.projectWebhookDeliveries.projectId, projectId),
        eq(projectSchema.projectWebhookDeliveries.provider, provider),
        eq(projectSchema.projectWebhookDeliveries.deliveryId, deliveryId),
      ),
    )
    .limit(1)
    .get();

export const updateWebhookDeliveryRow = (
  tx: ProjectStore,
  rowId: string,
  input: RecordVerifiedWebhookDeliveryInput,
  outcome: RecordVerifiedWebhookDeliveryResult["outcome"],
  runId: string | null,
  receivedAt: number,
): void => {
  tx.update(projectSchema.projectWebhookDeliveries)
    .set({
      eventKind: input.payload.eventKind,
      eventName: input.payload.eventName,
      outcome,
      repoUrl: input.payload.repoUrl,
      ref: input.payload.ref,
      branch: input.payload.branch,
      commitSha: input.payload.commitSha,
      beforeSha: input.payload.beforeSha,
      runId,
      receivedAt,
    })
    .where(eq(projectSchema.projectWebhookDeliveries.id, rowId))
    .run();
};

export const pruneWebhookDeliveries = (tx: ProjectStore, projectId: ProjectId, receivedBefore: number): void => {
  tx.delete(projectSchema.projectWebhookDeliveries)
    .where(
      and(
        eq(projectSchema.projectWebhookDeliveries.projectId, projectId),
        lt(projectSchema.projectWebhookDeliveries.receivedAt, receivedBefore),
      ),
    )
    .run();
};

export const insertProjectWebhookRow = (
  tx: ProjectStore,
  input: {
    projectId: ProjectId;
    provider: WebhookProvider;
    enabled: boolean;
    config: WebhookProviderConfig | null;
    encryptedSecret: RotateProjectWebhookSecretInput["encryptedSecret"];
    now: number;
  },
): void => {
  const updatedAt = getNextWebhookUpdatedAt(input.now);
  tx.insert(projectSchema.projectWebhooks)
    .values({
      id: generateDurableEntityId("whk", input.now),
      projectId: input.projectId,
      provider: input.provider,
      configJson: serializeWebhookConfig(input.config),
      secretCiphertext: input.encryptedSecret.ciphertext,
      secretKeyVersion: input.encryptedSecret.keyVersion,
      secretNonce: input.encryptedSecret.nonce,
      enabled: input.enabled ? 1 : 0,
      createdAt: input.now,
      updatedAt,
    })
    .run();
};

export const updateProjectWebhookSettingsRow = (
  tx: ProjectStore,
  input: {
    rowId: string;
    previousUpdatedAt: number;
    enabled: boolean;
    config: WebhookProviderConfig | null | undefined;
    now: number;
  },
): void => {
  const updatedAt = getNextWebhookUpdatedAt(input.now, input.previousUpdatedAt);
  tx.update(projectSchema.projectWebhooks)
    .set({
      enabled: input.enabled ? 1 : 0,
      updatedAt,
      ...(input.config === undefined ? {} : { configJson: serializeWebhookConfig(input.config) }),
    })
    .where(eq(projectSchema.projectWebhooks.id, input.rowId))
    .run();
};

export const rotateProjectWebhookSecretRow = (tx: ProjectStore, input: RotateProjectWebhookSecretInput): boolean => {
  const existingRow = getProjectWebhookRow(tx, input.projectId, input.provider);
  if (!existingRow) {
    return false;
  }

  const updatedAt = getNextWebhookUpdatedAt(input.now, existingRow.updatedAt);
  tx.update(projectSchema.projectWebhooks)
    .set({
      secretCiphertext: input.encryptedSecret.ciphertext,
      secretKeyVersion: input.encryptedSecret.keyVersion,
      secretNonce: input.encryptedSecret.nonce,
      updatedAt,
    })
    .where(eq(projectSchema.projectWebhooks.id, existingRow.id))
    .run();

  return true;
};

export const deleteProjectWebhookRow = (tx: ProjectStore, input: DeleteProjectWebhookInput): boolean => {
  const existingRow = getProjectWebhookRow(tx, input.projectId, input.provider);
  if (!existingRow) {
    return false;
  }

  tx.delete(projectSchema.projectWebhooks).where(eq(projectSchema.projectWebhooks.id, existingRow.id)).run();
  return true;
};

export const touchProjectWebhookRows = (tx: ProjectStore, input: TouchProjectWebhookVersionsInput): void => {
  const rows = listProjectWebhookRows(tx, input.projectId);
  for (const row of rows) {
    tx.update(projectSchema.projectWebhooks)
      .set({
        updatedAt: getNextWebhookUpdatedAt(input.now, row.updatedAt),
      })
      .where(eq(projectSchema.projectWebhooks.id, row.id))
      .run();
  }
};

export const parseStoredWebhook = (
  row: typeof projectSchema.projectWebhooks.$inferSelect,
  recentDeliveries: Array<typeof projectSchema.projectWebhookDeliveries.$inferSelect>,
): StoredProjectWebhook => ({
  ...parseWebhookRowState(row),
  createdAt: row.createdAt,
  recentDeliveries: recentDeliveries.map(parseWebhookDeliveryRow),
});

export const parseWebhookVerificationMaterial = (
  row: typeof projectSchema.projectWebhooks.$inferSelect,
): WebhookVerificationMaterial => ({
  ...parseWebhookRowState(row),
  encryptedSecret: {
    ciphertext: row.secretCiphertext,
    keyVersion: row.secretKeyVersion,
    nonce: row.secretNonce,
  },
});

export const parseWebhookDeliveryRow = (
  row: typeof projectSchema.projectWebhookDeliveries.$inferSelect,
): ParsedWebhookDeliveryRow => ({
  ...row,
  provider: expectTrusted(WebhookProviderCodec, row.provider, "WebhookProvider"),
  eventKind: expectTrusted(WebhookEventKind, row.eventKind, "WebhookEventKind"),
  outcome: expectTrusted(WebhookDeliveryOutcome, row.outcome, "WebhookDeliveryOutcome"),
});
