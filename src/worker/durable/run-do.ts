import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { RunId } from "@/contracts";
import {
  type AppendRunLogsInput,
  type EnsureRunInput,
  RunDetailState,
  RunMetaState,
  type UpdateRunStateInput,
  type UpdateRunStepStateInput,
  type ReplaceRunStepsInput,
} from "@/worker/contracts";
import runMigrations from "../../../drizzle/run-do/migrations.js";
import * as runSchema from "@/worker/db/durable/schema/run-do";
import type { TryUpdateRunStateResult } from "@/worker/durable/run-do/repo/core";
import { createLogger } from "@/worker/services";
import {
  appendLogs,
  listRunLogs,
  deleteRunData,
  ensureInitialized,
  getRunMeta,
  listRunSteps,
  repairTerminalState,
  replaceSteps,
  tryUpdateRunState,
  updateRunState,
  updateStepState,
  broadcastLogEvents,
  broadcastStateUpdate,
  handleRunLogStreamFetch,
  logRunSocketError,
} from "@/worker/durable/run-do/index";

const logger = createLogger("durable.run");

export class RunDO extends DurableObject {
  private readonly db: DrizzleSqliteDODatabase<typeof runSchema>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema: runSchema });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, runMigrations);
    });
  }
  public async fetch(request: Request): Promise<Response> {
    return handleRunLogStreamFetch(this.ctx, this.db, request);
  }
  async ensureInitialized(input: EnsureRunInput): Promise<void> {
    await ensureInitialized(this.db, input);
  }
  async getRunSummary(runId: RunId): Promise<RunMetaState | null> {
    return getRunMeta(this.db, runId);
  }
  async getRunDetail(runId: RunId): Promise<RunDetailState> {
    const meta = await getRunMeta(this.db, runId);
    const steps = await listRunSteps(this.db, runId);
    const recentLogs = await listRunLogs(this.db, runId);
    return {
      meta,
      steps,
      recentLogs,
    };
  }
  async updateRunState(input: UpdateRunStateInput): Promise<void> {
    await updateRunState(this.db, input);
    await broadcastStateUpdate(this.ctx, this.db, logger, input.runId);
  }
  async tryUpdateRunState(input: UpdateRunStateInput): Promise<TryUpdateRunStateResult> {
    const result = await tryUpdateRunState(this.db, input);
    if (result.kind === "applied") {
      await broadcastStateUpdate(this.ctx, this.db, logger, input.runId);
    }
    return result;
  }
  async repairTerminalState(input: UpdateRunStateInput): Promise<void> {
    await repairTerminalState(this.db, input);
    await broadcastStateUpdate(this.ctx, this.db, logger, input.runId);
  }
  async replaceSteps(input: ReplaceRunStepsInput): Promise<void> {
    await replaceSteps(this.db, input);
    await broadcastStateUpdate(this.ctx, this.db, logger, input.runId);
  }
  async updateStepState(input: UpdateRunStepStateInput): Promise<void> {
    await updateStepState(this.db, input);
    await broadcastStateUpdate(this.ctx, this.db, logger, input.runId);
  }
  async appendLogs(input: AppendRunLogsInput): Promise<void> {
    const appendedLogs = await appendLogs(this.db, input);
    broadcastLogEvents(this.ctx, logger, input.runId, appendedLogs);
  }
  async deleteRunData(runId: RunId): Promise<void> {
    await deleteRunData(this.db, runId);
  }
  webSocketMessage(): void {}
  webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    ws.close(code, reason);
  }
  webSocketError(ws: WebSocket, error: unknown): void {
    logRunSocketError(logger, ws, error);
  }
}
