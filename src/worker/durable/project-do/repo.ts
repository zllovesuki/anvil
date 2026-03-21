import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";

import type { ProjectId, RunId } from "@/contracts";
import type { D1SyncStatus } from "@/worker/contracts";
import * as projectSchema from "@/worker/db/durable/schema/project-do";

import type { ProjectConfigRow, ProjectDoContext, ProjectRunRow, ProjectStateRow, ProjectStore } from "./types";

export const getHighestQueuePosition = (tx: ProjectStore, projectId: ProjectId): number => {
  const row = tx
    .select({ position: projectSchema.projectRuns.position })
    .from(projectSchema.projectRuns)
    .where(and(eq(projectSchema.projectRuns.projectId, projectId), isNotNull(projectSchema.projectRuns.position)))
    .orderBy(desc(projectSchema.projectRuns.position))
    .limit(1)
    .get();

  return row?.position ?? 0;
};

export const countQueuedRuns = (tx: ProjectStore, projectId: ProjectId): number => {
  const rows = tx
    .select({ runId: projectSchema.projectRuns.runId })
    .from(projectSchema.projectRuns)
    .where(
      and(
        eq(projectSchema.projectRuns.projectId, projectId),
        or(eq(projectSchema.projectRuns.status, "pending"), eq(projectSchema.projectRuns.status, "executable")),
      ),
    )
    .all();

  return rows.length;
};

export const getProjectStateRow = (tx: ProjectStore, projectId: ProjectId): ProjectStateRow | undefined =>
  tx
    .select()
    .from(projectSchema.projectState)
    .where(eq(projectSchema.projectState.projectId, projectId))
    .limit(1)
    .get();

export const getProjectConfigRow = (tx: ProjectStore, projectId: ProjectId): ProjectConfigRow | undefined =>
  tx
    .select()
    .from(projectSchema.projectConfig)
    .where(eq(projectSchema.projectConfig.projectId, projectId))
    .limit(1)
    .get();

export const getRunRow = (tx: ProjectStore, projectId: ProjectId, runId: RunId): ProjectRunRow | undefined =>
  tx
    .select()
    .from(projectSchema.projectRuns)
    .where(and(eq(projectSchema.projectRuns.projectId, projectId), eq(projectSchema.projectRuns.runId, runId)))
    .limit(1)
    .get();

export const getProjectState = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectStateRow | undefined> => {
  const rows = await context.db
    .select()
    .from(projectSchema.projectState)
    .where(eq(projectSchema.projectState.projectId, projectId))
    .limit(1);

  return rows[0];
};

export const getProjectConfig = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectConfigRow | undefined> => {
  const rows = await context.db
    .select()
    .from(projectSchema.projectConfig)
    .where(eq(projectSchema.projectConfig.projectId, projectId))
    .limit(1);

  return rows[0];
};

export const getRunRowByRunId = async (context: ProjectDoContext, runId: RunId): Promise<ProjectRunRow | undefined> => {
  const rows = await context.db
    .select()
    .from(projectSchema.projectRuns)
    .where(eq(projectSchema.projectRuns.runId, runId))
    .limit(1);

  return rows[0];
};

export const listProjectRuns = async (context: ProjectDoContext, projectId: ProjectId): Promise<ProjectRunRow[]> =>
  context.db
    .select()
    .from(projectSchema.projectRuns)
    .where(eq(projectSchema.projectRuns.projectId, projectId))
    .orderBy(asc(projectSchema.projectRuns.position));

export const listPendingProjectDetailRows = async (context: ProjectDoContext, projectId: ProjectId) =>
  context.db
    .select({
      runId: projectSchema.projectRuns.runId,
      branch: projectSchema.projectRuns.branch,
      queuedAt: projectSchema.projectRuns.createdAt,
    })
    .from(projectSchema.projectRuns)
    .where(
      and(
        eq(projectSchema.projectRuns.projectId, projectId),
        or(eq(projectSchema.projectRuns.status, "pending"), eq(projectSchema.projectRuns.status, "executable")),
      ),
    )
    .orderBy(asc(projectSchema.projectRuns.position));

export const getOldestCancelRequestedRun = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectRunRow | undefined> => {
  const rows = await context.db
    .select()
    .from(projectSchema.projectRuns)
    .where(
      and(eq(projectSchema.projectRuns.projectId, projectId), eq(projectSchema.projectRuns.status, "cancel_requested")),
    )
    .orderBy(asc(projectSchema.projectRuns.cancelRequestedAt), asc(projectSchema.projectRuns.createdAt))
    .limit(1);

  return rows[0];
};

export const getOldestRunByD1SyncStatus = async (
  context: ProjectDoContext,
  projectId: ProjectId,
  d1SyncStatus: Extract<D1SyncStatus, "needs_create" | "needs_update" | "needs_terminal_update">,
): Promise<ProjectRunRow | undefined> => {
  const rows = await context.db
    .select()
    .from(projectSchema.projectRuns)
    .where(
      and(eq(projectSchema.projectRuns.projectId, projectId), eq(projectSchema.projectRuns.d1SyncStatus, d1SyncStatus)),
    )
    .orderBy(asc(projectSchema.projectRuns.createdAt))
    .limit(1);

  return rows[0];
};

export const getNextDispatchableRun = async (
  context: ProjectDoContext,
  projectId: ProjectId,
): Promise<ProjectRunRow | undefined> => {
  const rows = await context.db
    .select()
    .from(projectSchema.projectRuns)
    .where(
      and(
        eq(projectSchema.projectRuns.projectId, projectId),
        eq(projectSchema.projectRuns.status, "executable"),
        eq(projectSchema.projectRuns.dispatchStatus, "pending"),
      ),
    )
    .orderBy(asc(projectSchema.projectRuns.position))
    .limit(1);

  return rows[0];
};
