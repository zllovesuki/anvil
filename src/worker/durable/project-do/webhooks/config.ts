import type { ProjectId, WebhookProvider } from "@/contracts";
import { validateWebhookConfigForUpsert } from "@/lib/webhooks";

import type { ProjectDoContext, ProjectStore } from "../types";
import { getProjectConfigRow } from "../repo";
import {
  deleteProjectWebhookRow,
  insertProjectWebhookRow,
  getProjectWebhookRow,
  listProjectWebhookRows,
  listRecentWebhookDeliveryRows,
  parseStoredWebhook,
  parseWebhookVerificationMaterial,
  pruneWebhookDeliveries,
  rotateProjectWebhookSecretRow,
  touchProjectWebhookRows,
  updateProjectWebhookSettingsRow,
} from "./repo";
import {
  MAX_WEBHOOK_RECENT_DELIVERIES,
  type DeleteProjectWebhookInput,
  type RotateProjectWebhookSecretInput,
  type StoredProjectWebhook,
  type TouchProjectWebhookVersionsInput,
  type UpsertProjectWebhookInput,
  type UpsertProjectWebhookResult,
  WEBHOOK_DELIVERY_RETENTION_MS,
  type WebhookVerificationMaterial,
} from "./types";

const loadStoredProjectWebhook = (
  tx: ProjectStore,
  projectId: ProjectId,
  provider: WebhookProvider,
): StoredProjectWebhook | null => {
  const row = getProjectWebhookRow(tx, projectId, provider);
  if (!row) {
    return null;
  }

  const recentDeliveries = listRecentWebhookDeliveryRows(tx, projectId, provider, MAX_WEBHOOK_RECENT_DELIVERIES);

  return parseStoredWebhook(row, recentDeliveries);
};

const transitionUpsertProjectWebhook = (
  tx: ProjectStore,
  input: UpsertProjectWebhookInput,
): UpsertProjectWebhookResult => {
  const existingWebhook = loadStoredProjectWebhook(tx, input.projectId, input.provider);

  if (input.creating) {
    if (existingWebhook) {
      return {
        kind: "conflict",
        reason: "create_conflict",
      };
    }

    if (!input.encryptedSecret) {
      throw new Error(`Missing encrypted secret for new webhook ${input.provider}.`);
    }

    const projectConfigRow = getProjectConfigRow(tx, input.projectId);
    if (!projectConfigRow) {
      throw new Error(`Project config ${input.projectId} is missing during webhook create.`);
    }

    const config = validateWebhookConfigForUpsert({
      provider: input.provider,
      projectRepoUrl: projectConfigRow.repoUrl,
      incomingConfig: input.config,
      existingConfig: null,
      creating: true,
    });
    if (!config.ok) {
      return {
        kind: "invalid",
        status: config.status,
        code: config.code,
        message: config.message,
      };
    }

    insertProjectWebhookRow(tx, {
      projectId: input.projectId,
      provider: input.provider,
      enabled: input.enabled,
      config: config.config,
      encryptedSecret: input.encryptedSecret,
      now: input.now,
    });

    const createdWebhook = loadStoredProjectWebhook(tx, input.projectId, input.provider);
    if (!createdWebhook) {
      throw new Error(`Webhook ${input.provider} for project ${input.projectId} is missing after create.`);
    }

    return {
      kind: "applied",
      created: true,
      webhook: createdWebhook,
    };
  }

  if (!existingWebhook) {
    return {
      kind: "not_found",
    };
  }

  if (input.encryptedSecret) {
    return {
      kind: "rejected",
      reason: "secret_not_allowed",
    };
  }

  const projectConfigRow = getProjectConfigRow(tx, input.projectId);
  if (!projectConfigRow) {
    throw new Error(`Project config ${input.projectId} is missing during webhook update.`);
  }

  const resolvedConfig = validateWebhookConfigForUpsert({
    provider: input.provider,
    projectRepoUrl: projectConfigRow.repoUrl,
    incomingConfig: input.config,
    existingConfig: existingWebhook.config,
    creating: false,
  });
  if (!resolvedConfig.ok) {
    return {
      kind: "invalid",
      status: resolvedConfig.status,
      code: resolvedConfig.code,
      message: resolvedConfig.message,
    };
  }

  updateProjectWebhookSettingsRow(tx, {
    rowId: existingWebhook.id,
    previousUpdatedAt: existingWebhook.updatedAt,
    enabled: input.enabled,
    config: input.config === undefined ? undefined : resolvedConfig.config,
    now: input.now,
  });

  const updatedWebhook = loadStoredProjectWebhook(tx, input.projectId, input.provider);
  if (!updatedWebhook) {
    throw new Error(`Webhook ${input.provider} for project ${input.projectId} is missing after update.`);
  }

  return {
    kind: "applied",
    created: false,
    webhook: updatedWebhook,
  };
};

export const getWebhookVerificationMaterial = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  provider: WebhookProvider,
): Promise<WebhookVerificationMaterial | null> => {
  const row = getProjectWebhookRow(context.db, projectId, provider);
  return row ? parseWebhookVerificationMaterial(row) : null;
};

export const listProjectWebhooks = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<StoredProjectWebhook[]> => {
  const rows = listProjectWebhookRows(context.db, projectId);
  return rows.map((row) =>
    parseStoredWebhook(
      row,
      listRecentWebhookDeliveryRows(
        context.db,
        projectId,
        row.provider as WebhookProvider,
        MAX_WEBHOOK_RECENT_DELIVERIES,
      ),
    ),
  );
};

export const upsertProjectWebhook = async (
  context: ProjectDoContext,
  input: UpsertProjectWebhookInput,
): Promise<UpsertProjectWebhookResult> => {
  return context.db.transaction((tx) => {
    pruneWebhookDeliveries(tx, input.projectId, input.now - WEBHOOK_DELIVERY_RETENTION_MS);
    return transitionUpsertProjectWebhook(tx, input);
  });
};

export const rotateProjectWebhookSecret = async (
  context: ProjectDoContext,
  input: RotateProjectWebhookSecretInput,
): Promise<StoredProjectWebhook | null> => {
  return context.db.transaction((tx) => {
    const rotated = rotateProjectWebhookSecretRow(tx, input);
    if (!rotated) {
      return null;
    }

    const storedWebhook = loadStoredProjectWebhook(tx, input.projectId, input.provider);
    if (!storedWebhook) {
      throw new Error(`Webhook ${input.provider} for project ${input.projectId} is missing after rotate.`);
    }

    return storedWebhook;
  });
};

export const deleteProjectWebhook = async (
  context: ProjectDoContext,
  input: DeleteProjectWebhookInput,
): Promise<boolean> =>
  context.db.transaction((tx) => {
    const deleted = deleteProjectWebhookRow(tx, input);
    if (!deleted) {
      return false;
    }

    return true;
  });

export const touchProjectWebhookVersions = async (
  context: ProjectDoContext,
  input: TouchProjectWebhookVersionsInput,
): Promise<void> => {
  context.db.transaction((tx) => {
    touchProjectWebhookRows(tx, input);
  });
};
