import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { ProjectId, type WebhookProvider } from "@/contracts";
import {
  type AcceptManualRunResult,
  type AcceptManualRunInput,
  type ClaimRunWorkInput,
  type ClaimRunWorkResult,
  type FinalizeRunExecutionInput,
  type FinalizeRunExecutionResult,
  type RecordVerifiedWebhookDeliveryInput,
  type RecordVerifiedWebhookDeliveryResult,
  type ProjectDetailState,
  type RecordRunResolvedCommitInput,
  type RecordRunResolvedCommitResult,
  type RequestRunCancelInput,
  type RequestRunCancelResult,
  type RunHeartbeatInput,
  type RunHeartbeatResult,
  expectTrusted,
} from "@/worker/contracts";
import {
  ALARM_FAILURE_RETRY_MS,
  PROJECT_ALARM_MAX_ITERATIONS,
  acceptManualRun as acceptManualRunCommand,
  claimRunWork as claimRunWorkCommand,
  finalizeRunExecution as finalizeRunExecutionCommand,
  getProjectConfig as getProjectConfigCommand,
  getProjectDetailState as getProjectDetailStateCommand,
  getProjectExecutionMaterial as getProjectExecutionMaterialCommand,
  getProjectWebhookIngressState as getProjectWebhookIngressStateCommand,
  getWebhookVerificationMaterial as getWebhookVerificationMaterialCommand,
  initializeProject as initializeProjectCommand,
  listProjectWebhooks as listProjectWebhooksCommand,
  recordRunResolvedCommit as recordRunResolvedCommitCommand,
  recordRunHeartbeat as recordRunHeartbeatCommand,
  recordVerifiedWebhookDelivery as recordVerifiedWebhookDeliveryCommand,
  requestRunCancel as requestRunCancelCommand,
  rotateProjectWebhookSecret as rotateProjectWebhookSecretCommand,
  runAlarmCycle,
  rescheduleAlarm,
  scheduleAlarmAt,
  scheduleImmediateReconciliation,
  type DeleteProjectWebhookInput,
  type InitializeProjectInput,
  type ProjectConfigState,
  type ProjectDoContext,
  type ProjectExecutionMaterial,
  type ProjectWebhookIngressState,
  type RotateProjectWebhookSecretInput,
  type StoredProjectWebhook,
  type TouchProjectWebhookVersionsInput,
  type UpdateProjectConfigInput,
  type UpdateProjectConfigResult,
  type UpsertProjectWebhookInput,
  type UpsertProjectWebhookResult,
  updateProjectConfig as updateProjectConfigCommand,
  upsertProjectWebhook as upsertProjectWebhookCommand,
  deleteProjectWebhook as deleteProjectWebhookCommand,
  touchProjectWebhookVersions as touchProjectWebhookVersionsCommand,
  type WebhookVerificationMaterial,
} from "@/worker/durable/project-do/index";
import { createLogger } from "@/worker/services/logger";
import projectMigrations from "../../../drizzle/project-do/migrations.js";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

const logger = createLogger("durable.project");

// Stable entrypoint for the ProjectDO RPC surface. The implementation is split across
// `src/worker/durable/project-do/`, but this file keeps the existing export path and class shape.
export class ProjectDO extends DurableObject {
  private readonly db: DrizzleSqliteDODatabase<typeof projectSchema>;
  private cachedProjectId: ProjectId | null | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema: projectSchema });

    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, projectMigrations);
      const projectId = await this.loadStoredProjectId();
      if (!projectId) {
        logger.warn("project_state_missing_project_id", {
          phase: "constructor",
          objectId: this.ctx.id.toString(),
        });
        return;
      }
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm !== null) {
        return;
      }
      try {
        await rescheduleAlarm(this.getProjectContext(), projectId);
      } catch (error) {
        logger.error("project_constructor_alarm_rearm_failed", {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
  private getProjectContext(): ProjectDoContext {
    return {
      ctx: this.ctx,
      env: this.env,
      db: this.db,
      logger,
      cacheProjectId: (projectId) => {
        this.cachedProjectId = projectId;
      },
    };
  }
  private async loadStoredProjectId(): Promise<ProjectId | null> {
    if (this.cachedProjectId !== undefined) {
      return this.cachedProjectId;
    }
    // Do not use ctx.id.name here. Cloudflare does not populate DurableObjectId.name inside
    // the Durable Object runtime, even when the Worker created the stub with idFromName().
    const rows = await this.db
      .select({ projectId: projectSchema.projectState.projectId })
      .from(projectSchema.projectState)
      .limit(1);
    const projectId = rows[0]?.projectId;
    if (!projectId) {
      this.cachedProjectId = null;
      return null;
    }
    try {
      const decodedProjectId = expectTrusted(ProjectId, projectId, "ProjectId");
      this.cachedProjectId = decodedProjectId;
      return decodedProjectId;
    } catch {
      this.cachedProjectId = null;
      return null;
    }
  }
  public fetch(): Response {
    return new Response("ProjectDO not implemented yet.", { status: 501 });
  }
  async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
    const context = this.getProjectContext();
    const alarmContext = {
      objectId: this.ctx.id.toString(),
      retryCount: alarmInfo?.retryCount ?? 0,
      isRetry: alarmInfo?.isRetry ?? false,
    };
    const projectId = await this.loadStoredProjectId();
    if (!projectId) {
      logger.warn("project_state_missing_project_id", {
        phase: "alarm",
        ...alarmContext,
      });
      return;
    }
    logger.info("project_alarm_started", {
      projectId,
      action: "start",
      ...alarmContext,
    });
    try {
      let progressCount = 0;
      while (true) {
        if (progressCount >= PROJECT_ALARM_MAX_ITERATIONS) {
          logger.warn("project_alarm_iteration_cap_exceeded", {
            projectId,
            iterationCap: PROJECT_ALARM_MAX_ITERATIONS,
            ...alarmContext,
          });
          break;
        }
        const progress = await runAlarmCycle(context, projectId);
        if (!progress) {
          break;
        }
        progressCount += 1;
        logger.info("project_alarm_progress", {
          projectId,
          runId: progress.runId,
          action: progress.action,
          ...alarmContext,
        });
      }
      if (progressCount === 0) {
        logger.info("project_alarm_idle", {
          projectId,
          action: "idle",
          ...alarmContext,
        });
      }
      await rescheduleAlarm(context, projectId);
      const nextAlarmAt = await this.ctx.storage.getAlarm();
      logger.info("project_alarm_rescheduled", {
        projectId,
        action: "rescheduled",
        nextAlarmAt,
        progressCount,
        ...alarmContext,
      });
    } catch (error) {
      logger.error("project_alarm_failed", {
        projectId,
        ...alarmContext,
        error: error instanceof Error ? error.message : String(error),
      });
      // Keep reconciliation alive beyond the runtime's limited automatic alarm retries.
      const retryAt = Date.now() + ALARM_FAILURE_RETRY_MS;
      await scheduleAlarmAt(context, retryAt);
      logger.info("project_alarm_retry_scheduled", {
        projectId,
        action: "retry_scheduled",
        nextAlarmAt: retryAt,
        ...alarmContext,
      });
    }
  }
  // Keep the public RPC method names and signatures stable. Other Worker modules and the queue
  // consumer call these methods directly through the ProjectDO stub.
  async getProjectDetailState(projectId: ProjectId): Promise<ProjectDetailState> {
    return await getProjectDetailStateCommand(this.getProjectContext(), projectId);
  }
  async initializeProject(input: InitializeProjectInput): Promise<void> {
    await initializeProjectCommand(this.getProjectContext(), input);
  }
  async getProjectConfig(projectId: ProjectId): Promise<ProjectConfigState | null> {
    return await getProjectConfigCommand(this.getProjectContext(), projectId);
  }
  async updateProjectConfig(input: UpdateProjectConfigInput): Promise<UpdateProjectConfigResult> {
    return await updateProjectConfigCommand(this.getProjectContext(), input);
  }
  async getProjectExecutionMaterial(projectId: ProjectId): Promise<ProjectExecutionMaterial | null> {
    return await getProjectExecutionMaterialCommand(this.getProjectContext(), projectId);
  }
  async getProjectWebhookIngressState(
    projectId: ProjectId,
    provider: WebhookProvider,
  ): Promise<ProjectWebhookIngressState | null> {
    return await getProjectWebhookIngressStateCommand(this.getProjectContext(), projectId, provider);
  }
  async acceptManualRun(input: AcceptManualRunInput): Promise<AcceptManualRunResult> {
    return await acceptManualRunCommand(this.getProjectContext(), input);
  }
  async claimRunWork(input: ClaimRunWorkInput): Promise<ClaimRunWorkResult> {
    return await claimRunWorkCommand(this.getProjectContext(), input);
  }
  async finalizeRunExecution(input: FinalizeRunExecutionInput): Promise<FinalizeRunExecutionResult> {
    return await finalizeRunExecutionCommand(this.getProjectContext(), input);
  }
  async recordRunResolvedCommit(input: RecordRunResolvedCommitInput): Promise<RecordRunResolvedCommitResult> {
    return await recordRunResolvedCommitCommand(this.getProjectContext(), input);
  }
  async requestRunCancel(input: RequestRunCancelInput): Promise<RequestRunCancelResult> {
    return await requestRunCancelCommand(this.getProjectContext(), input);
  }
  async recordRunHeartbeat(input: RunHeartbeatInput): Promise<RunHeartbeatResult> {
    return await recordRunHeartbeatCommand(this.getProjectContext(), input);
  }
  async getWebhookVerificationMaterial(
    projectId: ProjectId,
    provider: WebhookProvider,
  ): Promise<WebhookVerificationMaterial | null> {
    return await getWebhookVerificationMaterialCommand(this.getProjectContext(), projectId, provider);
  }
  async listProjectWebhooks(projectId: ProjectId): Promise<StoredProjectWebhook[]> {
    return await listProjectWebhooksCommand(this.getProjectContext(), projectId);
  }
  async upsertProjectWebhook(input: UpsertProjectWebhookInput): Promise<UpsertProjectWebhookResult> {
    return await upsertProjectWebhookCommand(this.getProjectContext(), input);
  }
  async rotateProjectWebhookSecret(input: RotateProjectWebhookSecretInput): Promise<StoredProjectWebhook | null> {
    return await rotateProjectWebhookSecretCommand(this.getProjectContext(), input);
  }
  async deleteProjectWebhook(input: DeleteProjectWebhookInput): Promise<boolean> {
    return await deleteProjectWebhookCommand(this.getProjectContext(), input);
  }
  async touchProjectWebhookVersions(input: TouchProjectWebhookVersionsInput): Promise<void> {
    await touchProjectWebhookVersionsCommand(this.getProjectContext(), input);
  }
  async recordVerifiedWebhookDelivery(
    input: RecordVerifiedWebhookDeliveryInput,
  ): Promise<RecordVerifiedWebhookDeliveryResult> {
    return await recordVerifiedWebhookDeliveryCommand(this.getProjectContext(), input);
  }
  async kickReconciliation(): Promise<void> {
    // Worker read/write paths call this through executionCtx.waitUntil() to give alarm-driven reconciliation
    // a fresh external trigger without making the HTTP response wait on D1 sync or queue delivery.
    await scheduleImmediateReconciliation(this.getProjectContext());
  }
}
