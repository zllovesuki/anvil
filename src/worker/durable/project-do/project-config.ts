import { eq } from "drizzle-orm";

import { DispatchMode, ProjectId, type WebhookProvider } from "@/contracts";
import { expectTrusted } from "@/worker/contracts";
import { getWebhookProviderCatalogEntry, validateWebhookConfigForUpsert } from "@/lib/webhooks";
import * as projectSchema from "@/worker/db/durable/schema/project-do";
import type { EncryptedSecret } from "@/worker/security/secrets";

import { getProjectConfig, getProjectConfigRow } from "./repo";
import { rescheduleAlarmInTransaction } from "./sidecar-state";
import { ensureProjectState } from "./transitions/shared";
import type {
  InitializeProjectInput,
  ProjectConfigRow,
  ProjectConfigState,
  ProjectDoContext,
  ProjectExecutionMaterial,
  ProjectStore,
  ProjectWebhookIngressState,
  UpdateProjectConfigInput,
  UpdateProjectConfigResult,
} from "./types";
import {
  getProjectWebhookRow,
  listProjectWebhookRows,
  parseStoredWebhook,
  parseWebhookVerificationMaterial,
} from "./webhooks";
import { touchProjectWebhookRows } from "./webhooks/repo";

const getNextProjectUpdatedAt = (now: number, previousUpdatedAt?: number): number =>
  previousUpdatedAt === undefined ? now : Math.max(now, previousUpdatedAt + 1);

const toEncryptedRepoToken = (
  row: Pick<ProjectConfigRow, "repoTokenCiphertext" | "repoTokenKeyVersion" | "repoTokenNonce">,
): EncryptedSecret | null =>
  row.repoTokenCiphertext !== null && row.repoTokenKeyVersion !== null && row.repoTokenNonce !== null
    ? {
        ciphertext: row.repoTokenCiphertext,
        keyVersion: row.repoTokenKeyVersion,
        nonce: row.repoTokenNonce,
      }
    : null;

const toProjectConfigState = (row: ProjectConfigRow): ProjectConfigState => ({
  projectId: expectTrusted(ProjectId, row.projectId, "ProjectId"),
  name: row.name,
  repoUrl: row.repoUrl,
  defaultBranch: row.defaultBranch,
  configPath: row.configPath,
  dispatchMode: expectTrusted(DispatchMode, row.dispatchMode, "DispatchMode"),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const validateProjectRepoUrlAgainstConfiguredWebhooks = (
  tx: ProjectStore,
  projectId: ProjectId,
  nextRepoUrl: string,
): UpdateProjectConfigResult | null => {
  const conflictingProviders: WebhookProvider[] = [];
  const webhookRows = listProjectWebhookRows(tx, projectId);

  for (const webhookRow of webhookRows) {
    const storedWebhook = parseStoredWebhook(webhookRow, []);
    const result = validateWebhookConfigForUpsert({
      provider: storedWebhook.provider,
      projectRepoUrl: nextRepoUrl,
      incomingConfig: undefined,
      existingConfig: storedWebhook.config,
      creating: false,
    });

    if (!result.ok) {
      conflictingProviders.push(storedWebhook.provider);
    }
  }

  if (conflictingProviders.length === 0) {
    return null;
  }

  const providerNames = conflictingProviders.map((provider) => getWebhookProviderCatalogEntry(provider).displayName);
  return {
    kind: "invalid",
    status: 400,
    code: "project_repo_url_conflicts_with_webhook",
    message: `Project repoUrl conflicts with configured webhook providers: ${providerNames.join(", ")}. Update or delete those webhooks first.`,
    details: {
      providers: conflictingProviders,
    },
  };
};

const upsertProjectConfigRow = (tx: ProjectStore, input: InitializeProjectInput): void => {
  const updatedAt = getNextProjectUpdatedAt(input.updatedAt);
  const existingRow = getProjectConfigRow(tx, input.projectId);

  if (!existingRow) {
    tx.insert(projectSchema.projectConfig)
      .values({
        projectId: input.projectId,
        name: input.name,
        repoUrl: input.repoUrl,
        defaultBranch: input.defaultBranch,
        configPath: input.configPath,
        repoTokenCiphertext: input.encryptedRepoToken?.ciphertext ?? null,
        repoTokenKeyVersion: input.encryptedRepoToken?.keyVersion ?? null,
        repoTokenNonce: input.encryptedRepoToken?.nonce ?? null,
        dispatchMode: input.dispatchMode,
        executionRuntime: input.executionRuntime,
        createdAt: input.createdAt,
        updatedAt,
      })
      .run();
    return;
  }

  tx.update(projectSchema.projectConfig)
    .set({
      name: input.name,
      repoUrl: input.repoUrl,
      defaultBranch: input.defaultBranch,
      configPath: input.configPath,
      repoTokenCiphertext: input.encryptedRepoToken?.ciphertext ?? null,
      repoTokenKeyVersion: input.encryptedRepoToken?.keyVersion ?? null,
      repoTokenNonce: input.encryptedRepoToken?.nonce ?? null,
      dispatchMode: input.dispatchMode,
      executionRuntime: input.executionRuntime,
      createdAt: input.createdAt,
      updatedAt,
    })
    .where(eq(projectSchema.projectConfig.projectId, input.projectId))
    .run();
};

export const initializeProject = async (context: ProjectDoContext, input: InitializeProjectInput): Promise<void> => {
  context.db.transaction((tx) => {
    ensureProjectState(context, tx, input.projectId);
    upsertProjectConfigRow(tx, input);
    tx.update(projectSchema.projectState)
      .set({
        projectIndexSyncStatus: "current",
      })
      .where(eq(projectSchema.projectState.projectId, input.projectId))
      .run();
  });
};

export const getProjectConfigState = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectConfigState | null> => {
  const row = await getProjectConfig(context, projectId);
  return row ? toProjectConfigState(row) : null;
};

export const getProjectExecutionMaterial = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectExecutionMaterial | null> => {
  const row = await getProjectConfig(context, projectId);
  if (!row) {
    return null;
  }

  return {
    projectId,
    encryptedRepoToken: toEncryptedRepoToken(row),
  };
};

export const getProjectWebhookIngressState = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  provider: WebhookProvider,
): Promise<ProjectWebhookIngressState | null> => {
  const configRow = await getProjectConfig(context, projectId);
  if (!configRow) {
    return null;
  }

  const webhookRow = getProjectWebhookRow(context.db, projectId, provider);
  if (!webhookRow) {
    return null;
  }

  return {
    projectId,
    repoUrl: configRow.repoUrl,
    defaultBranch: configRow.defaultBranch,
    configPath: configRow.configPath,
    webhook: parseWebhookVerificationMaterial(webhookRow),
  };
};

export const updateProjectConfig = async (
  context: ProjectDoContext,
  input: UpdateProjectConfigInput,
): Promise<UpdateProjectConfigResult> =>
  context.ctx.storage.transaction(async (txn) => {
    const result = context.db.transaction((tx): UpdateProjectConfigResult => {
      ensureProjectState(context, tx, input.projectId);

      const existingRow = getProjectConfigRow(tx, input.projectId);
      if (!existingRow) {
        return {
          kind: "not_found",
        };
      }

      const nextRepoUrl = input.repoUrl ?? existingRow.repoUrl;
      const repoConflict = validateProjectRepoUrlAgainstConfiguredWebhooks(tx, input.projectId, nextRepoUrl);
      if (repoConflict) {
        return repoConflict;
      }

      const nextDefaultBranch = input.defaultBranch ?? existingRow.defaultBranch;
      const nextConfigPath = input.configPath ?? existingRow.configPath;
      const nextDispatchMode =
        input.dispatchMode ?? expectTrusted(DispatchMode, existingRow.dispatchMode, "DispatchMode");
      const updatedAt = getNextProjectUpdatedAt(input.now, existingRow.updatedAt);
      const webhookHandlingChanged =
        nextRepoUrl !== existingRow.repoUrl ||
        nextDefaultBranch !== existingRow.defaultBranch ||
        nextConfigPath !== existingRow.configPath;

      tx.update(projectSchema.projectConfig)
        .set({
          name: input.name ?? existingRow.name,
          repoUrl: nextRepoUrl,
          defaultBranch: nextDefaultBranch,
          configPath: nextConfigPath,
          dispatchMode: nextDispatchMode,
          repoTokenCiphertext:
            input.encryptedRepoToken === undefined
              ? existingRow.repoTokenCiphertext
              : (input.encryptedRepoToken?.ciphertext ?? null),
          repoTokenKeyVersion:
            input.encryptedRepoToken === undefined
              ? existingRow.repoTokenKeyVersion
              : (input.encryptedRepoToken?.keyVersion ?? null),
          repoTokenNonce:
            input.encryptedRepoToken === undefined
              ? existingRow.repoTokenNonce
              : (input.encryptedRepoToken?.nonce ?? null),
          updatedAt,
        })
        .where(eq(projectSchema.projectConfig.projectId, input.projectId))
        .run();

      if (webhookHandlingChanged) {
        touchProjectWebhookRows(tx, {
          projectId: input.projectId,
          now: updatedAt,
        });
      }

      tx.update(projectSchema.projectState)
        .set({
          projectIndexSyncStatus: "needs_update",
        })
        .where(eq(projectSchema.projectState.projectId, input.projectId))
        .run();

      return {
        kind: "applied",
        config: {
          projectId: input.projectId,
          name: input.name ?? existingRow.name,
          repoUrl: nextRepoUrl,
          defaultBranch: nextDefaultBranch,
          configPath: nextConfigPath,
          dispatchMode: nextDispatchMode,
          createdAt: existingRow.createdAt,
          updatedAt,
        },
      };
    });

    if (result.kind === "applied") {
      await rescheduleAlarmInTransaction(context, txn, input.projectId);
    }

    return result;
  });
