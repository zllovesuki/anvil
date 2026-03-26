import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import type { DispatchMode, ExecutionRuntime, ProjectId, UnixTimestampMs, WebhookProvider } from "@/contracts";
import type { ProjectRunStatus } from "@/worker/contracts";
import type * as projectSchema from "@/worker/db/durable/schema/project-do";
import type { EncryptedSecret } from "@/worker/security/secrets";
import type { Logger } from "@/worker/services/logger";
import type { WebhookVerificationMaterial } from "./webhooks/types";

export type ProjectTx = Parameters<DrizzleSqliteDODatabase<typeof projectSchema>["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;
export type ProjectDb = DrizzleSqliteDODatabase<typeof projectSchema>;
export type ProjectStore = ProjectDb | ProjectTx;

export type ProjectConfigRow = typeof projectSchema.projectConfig.$inferSelect;
export type ProjectRunRow = typeof projectSchema.projectRuns.$inferSelect;
export type ProjectStateRow = typeof projectSchema.projectState.$inferSelect;

export type ProjectIndexSyncStatus = "current" | "needs_update";
export type D1RetryPhase = "create" | "metadata" | "terminal";
export type ProjectIndexRetryPhase = "project_index";

export interface D1RetryState {
  attempt: number;
  nextAt: number;
  phase: D1RetryPhase;
}

export interface ProjectIndexRetryState {
  attempt: number;
  nextAt: number;
  phase: ProjectIndexRetryPhase;
}

export interface SandboxCleanupRetryState {
  attempt: number;
  nextAt: number;
}

export interface CancelTransitionResult {
  row: ProjectRunRow;
  runStatus: ProjectRunStatus;
  cancelRequestedAt: UnixTimestampMs | null;
  runDoAction: "none" | "cancel_requested" | "canceled";
}

export type RunDoCancelUpdateOutcome = "applied" | "deferred" | "noop";

export interface InitializeProjectInput {
  projectId: ProjectId;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  configPath: string;
  encryptedRepoToken: EncryptedSecret | null;
  dispatchMode: DispatchMode;
  executionRuntime: ExecutionRuntime;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateProjectConfigInput {
  projectId: ProjectId;
  name?: string;
  repoUrl?: string;
  defaultBranch?: string;
  configPath?: string;
  dispatchMode?: DispatchMode;
  encryptedRepoToken?: EncryptedSecret | null;
  now: number;
}

export interface ProjectConfigState {
  projectId: ProjectId;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  configPath: string;
  dispatchMode: DispatchMode;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectExecutionMaterial {
  projectId: ProjectId;
  encryptedRepoToken: EncryptedSecret | null;
}

export interface ProjectWebhookIngressState {
  projectId: ProjectId;
  repoUrl: string;
  defaultBranch: string;
  configPath: string;
  webhook: WebhookVerificationMaterial;
}

export type UpdateProjectConfigResult =
  | {
      kind: "applied";
      config: ProjectConfigState;
    }
  | {
      kind: "invalid";
      status: number;
      code: string;
      message: string;
      details?: {
        providers: string[];
      };
    }
  | {
      kind: "not_found";
    };

export interface ProjectDoContext {
  ctx: DurableObjectState;
  env: Env;
  db: ProjectDb;
  logger: Logger;
  cacheProjectId: (projectId: ProjectId) => void;
}
