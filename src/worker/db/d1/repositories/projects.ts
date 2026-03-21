import { and, desc, eq, inArray } from "drizzle-orm";

import { type D1DbExecutor, projectIndex, runIndex } from "@/worker/db/d1";
import type { ProjectId } from "@/contracts";

export type ProjectIndexRow = typeof projectIndex.$inferSelect;
export type ProjectRow = ProjectIndexRow;
export type NewProjectIndexRow = typeof projectIndex.$inferInsert;
export type NewProjectRow = NewProjectIndexRow;

export interface ProjectIndexReplicaValues {
  name: string;
  repoUrl: string;
  defaultBranch: string;
  configPath: string;
  updatedAt: number;
}

export const listProjectsByOwnerUserId = async (db: D1DbExecutor, ownerUserId: string): Promise<ProjectIndexRow[]> =>
  db.select().from(projectIndex).where(eq(projectIndex.ownerUserId, ownerUserId)).orderBy(desc(projectIndex.updatedAt));

export const findProjectById = async (db: D1DbExecutor, projectId: ProjectId): Promise<ProjectIndexRow | undefined> => {
  const rows = await db.select().from(projectIndex).where(eq(projectIndex.id, projectId)).limit(1);
  return rows[0];
};

export const findOwnedProjectById = async (
  db: D1DbExecutor,
  ownerUserId: string,
  projectId: ProjectId,
): Promise<ProjectIndexRow | undefined> => {
  const rows = await db
    .select()
    .from(projectIndex)
    .where(and(eq(projectIndex.ownerUserId, ownerUserId), eq(projectIndex.id, projectId)))
    .limit(1);

  return rows[0];
};

export const findProjectBySlugs = async (
  db: D1DbExecutor,
  ownerSlug: string,
  projectSlug: string,
): Promise<ProjectIndexRow | undefined> => {
  const rows = await db
    .select()
    .from(projectIndex)
    .where(and(eq(projectIndex.ownerSlug, ownerSlug), eq(projectIndex.projectSlug, projectSlug)))
    .limit(1);

  return rows[0];
};

export const insertProjectIndex = async (db: D1DbExecutor, row: NewProjectIndexRow): Promise<void> => {
  await db.insert(projectIndex).values(row);
};

export const insertProject = insertProjectIndex;

export const updateProjectIndexReplicaById = async (
  db: D1DbExecutor,
  projectId: string,
  values: ProjectIndexReplicaValues,
): Promise<boolean> => {
  const rows = await db
    .update(projectIndex)
    .set(values)
    .where(eq(projectIndex.id, projectId))
    .returning({ id: projectIndex.id });

  return rows.length === 1;
};

export const deleteProjectIndexById = async (db: D1DbExecutor, projectId: ProjectId): Promise<boolean> => {
  const rows = await db.delete(projectIndex).where(eq(projectIndex.id, projectId)).returning({ id: projectIndex.id });

  return rows.length === 1;
};

export const listLatestRunStatusByProjectIds = async (
  db: D1DbExecutor,
  projectIds: string[],
): Promise<Map<string, string>> => {
  if (projectIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      projectId: runIndex.projectId,
      status: runIndex.status,
    })
    .from(runIndex)
    .where(inArray(runIndex.projectId, projectIds))
    .orderBy(desc(runIndex.queuedAt), desc(runIndex.startedAt));

  const latestByProjectId = new Map<string, string>();

  for (const row of rows) {
    if (!latestByProjectId.has(row.projectId)) {
      latestByProjectId.set(row.projectId, row.status);
    }
  }

  return latestByProjectId;
};
