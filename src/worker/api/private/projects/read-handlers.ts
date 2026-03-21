import { type GetProjectRunsResponse, type GetProjectsResponse, toRunStatusOrNull } from "@/contracts";
import type { AppContext } from "@/worker/hono";
import {
  listLatestRunStatusByProjectIds,
  listProjectRunsPage,
  listProjectsByOwnerUserId,
} from "@/worker/db/d1/repositories";
import {
  serializePendingRunSummary,
  serializeProjectDetail,
  serializeProjectSummary,
  serializeRunSummary,
} from "@/worker/presentation/serializers";
import { queueProjectReconciliation } from "@/worker/api/private/reconciliation";
import { requireOwnedProject } from "@/worker/api/private/shared";

import {
  decodeRunCursor,
  encodeRunCursor,
  getProjectStub,
  getRunStub,
  mergeRunSummaryWithMeta,
  parseProjectRunsQuery,
} from "./shared";
export const handleGetProjects = async (c: AppContext): Promise<Response> => {
  const user = c.get("user");
  const db = c.get("db");
  const projectRows = await listProjectsByOwnerUserId(db, user.id);
  const latestRunStatusByProjectId = await listLatestRunStatusByProjectIds(
    db,
    projectRows.map((project) => project.id),
  );

  const projects = projectRows.map((project) =>
    serializeProjectSummary(project, toRunStatusOrNull(latestRunStatusByProjectId.get(project.id))),
  );

  const response: GetProjectsResponse = { projects };
  return c.json(response, 200);
};

export const handleGetProjectDetail = async (c: AppContext): Promise<Response> => {
  const { projectId, project: projectIndex } = await requireOwnedProject(c);
  const db = c.get("db");
  const projectStub = getProjectStub(c.env, projectId);
  const [projectConfig, coordination, latestRunStatusByProjectId] = await Promise.all([
    projectStub.getProjectConfig(projectId),
    projectStub.getProjectDetailState(projectId),
    listLatestRunStatusByProjectIds(db, [projectIndex.id]),
  ]);
  if (!projectConfig) {
    throw new Error(`Project config ${projectId} is missing.`);
  }

  let activeRun = null;
  if (coordination.activeRunId) {
    const runMeta = await getRunStub(c.env, coordination.activeRunId).getRunSummary(coordination.activeRunId);
    if (runMeta) {
      activeRun = mergeRunSummaryWithMeta(coordination.activeRunId, runMeta, null);
    }
  }

  const detail = serializeProjectDetail({
    project: {
      ...projectIndex,
      ...projectConfig,
    },
    lastRunStatus:
      activeRun?.status ??
      (coordination.pendingRuns.length > 0
        ? "queued"
        : toRunStatusOrNull(latestRunStatusByProjectId.get(projectIndex.id))),
    activeRun,
    pendingRuns: coordination.pendingRuns.map(serializePendingRunSummary),
  });

  if (coordination.activeRunId || coordination.pendingRuns.length > 0) {
    queueProjectReconciliation(c, projectId, "get_project_detail");
  }

  return c.json(detail, 200);
};

export const handleGetProjectRuns = async (c: AppContext): Promise<Response> => {
  const { projectId } = await requireOwnedProject(c);
  const db = c.get("db");

  const query = parseProjectRunsQuery(c);
  const cursor = query.cursor ? decodeRunCursor(query.cursor) : undefined;
  const rows = await listProjectRunsPage(db, projectId, query.limit + 1, cursor);
  let runs = rows.slice(0, query.limit).map(serializeRunSummary);

  if (!query.cursor) {
    const coordination = await getProjectStub(c.env, projectId).getProjectDetailState(projectId);
    if (coordination.activeRunId) {
      const activeMeta = await getRunStub(c.env, coordination.activeRunId).getRunSummary(coordination.activeRunId);
      if (activeMeta) {
        const existingIndex = runs.findIndex((run) => run.id === coordination.activeRunId);
        if (existingIndex !== -1) {
          const activeSummary = mergeRunSummaryWithMeta(coordination.activeRunId, activeMeta, runs[existingIndex]);
          runs.splice(existingIndex, 1, activeSummary);
        }
      }
    }
  }

  const nextCursor =
    rows.length > query.limit && runs.length > 0
      ? encodeRunCursor({
          queuedAt: Date.parse(runs[runs.length - 1].queuedAt),
          runId: runs[runs.length - 1].id,
        })
      : null;

  const response: GetProjectRunsResponse = { runs, nextCursor };
  return c.json(response, 200);
};
