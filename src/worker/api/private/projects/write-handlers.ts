import {
  CreateProjectRequest,
  DEFAULT_DISPATCH_MODE,
  DEFAULT_EXECUTION_RUNTIME,
  ProjectId,
  type ProjectResponse,
  TriggerRunRequest,
  type TriggerRunAcceptedResponse,
  toRunStatusOrNull,
  UpdateProjectRequest,
} from "@/contracts";
import { type AcceptManualRunInput, expectTrusted } from "@/worker/contracts";
import type { AppContext } from "@/worker/hono";
import {
  deleteProjectIndexById,
  insertProjectIndex,
  listLatestRunStatusByProjectIds,
} from "@/worker/db/d1/repositories";
import { HttpError, parseJson } from "@/worker/http";
import { serializeProjectSummary } from "@/worker/presentation/serializers";
import { encryptSecret } from "@/worker/security/secrets";
import { generateDurableEntityId } from "@/worker/services";
import { queueProjectReconciliation } from "@/worker/api/private/reconciliation";
import { requireOwnedProject } from "@/worker/api/private/shared";
import {
  assertValidSlug,
  normalizeBranchName,
  normalizeConfigPath,
  normalizeProjectName,
  normalizeRepositoryUrl,
} from "@/worker/validation";

import {
  getProjectStub,
  isConstraintError,
  logger,
  toTriggeredByUserId,
  UNIQUE_PROJECT_SLUG_CONSTRAINT,
} from "./shared";

export const handleCreateProject = async (c: AppContext): Promise<Response> => {
  const user = c.get("user");
  const db = c.get("db");
  const payload = await parseJson(c.req.raw, CreateProjectRequest);
  assertValidSlug(payload.projectSlug, "projectSlug");

  const now = Date.now();
  const encryptedToken = typeof payload.repoToken === "string" ? await encryptSecret(c.env, payload.repoToken) : null;
  const projectId = expectTrusted(ProjectId, generateDurableEntityId("prj", now), "ProjectId");

  const project = {
    id: projectId,
    ownerUserId: user.id,
    ownerSlug: user.slug,
    projectSlug: payload.projectSlug,
    name: normalizeProjectName(payload.name),
    repoUrl: normalizeRepositoryUrl(payload.repoUrl),
    defaultBranch: normalizeBranchName(payload.defaultBranch),
    configPath: normalizeConfigPath(payload.configPath ?? ".anvil.yml"),
    createdAt: now,
    updatedAt: now,
  } as const;

  try {
    await insertProjectIndex(db, project);
  } catch (error) {
    if (isConstraintError(error, UNIQUE_PROJECT_SLUG_CONSTRAINT)) {
      throw new HttpError(409, "project_slug_taken", "Project slug is already in use for this owner.");
    }

    throw error;
  }

  try {
    await getProjectStub(c.env, projectId).initializeProject({
      projectId,
      name: project.name,
      repoUrl: project.repoUrl,
      defaultBranch: project.defaultBranch,
      configPath: project.configPath,
      encryptedRepoToken: encryptedToken,
      dispatchMode: DEFAULT_DISPATCH_MODE,
      executionRuntime: DEFAULT_EXECUTION_RUNTIME,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    try {
      await deleteProjectIndexById(db, projectId);
    } catch (cleanupError) {
      logger.error("project_create_compensation_failed", {
        projectId,
        userId: user.id,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    throw error;
  }

  logger.info("project_created", {
    projectId: project.id,
    userId: user.id,
  });

  const response: ProjectResponse = {
    project: serializeProjectSummary(project, null),
  };

  return c.json(response, 201);
};

export const handleUpdateProject = async (c: AppContext): Promise<Response> => {
  const { projectId, project: projectIndex } = await requireOwnedProject(c);
  const db = c.get("db");
  const user = c.get("user");

  const payload = await parseJson(c.req.raw, UpdateProjectRequest);
  if (
    payload.name === undefined &&
    payload.repoUrl === undefined &&
    payload.defaultBranch === undefined &&
    payload.configPath === undefined &&
    payload.repoToken === undefined
  ) {
    throw new HttpError(400, "empty_update", "At least one project field must be provided.");
  }

  const encryptedToken =
    typeof payload.repoToken === "string"
      ? await encryptSecret(c.env, payload.repoToken)
      : payload.repoToken === null
        ? null
        : undefined;
  const projectStub = getProjectStub(c.env, projectId);
  const result = await projectStub.updateProjectConfig({
    projectId,
    name: payload.name === undefined ? undefined : normalizeProjectName(payload.name),
    repoUrl: payload.repoUrl === undefined ? undefined : normalizeRepositoryUrl(payload.repoUrl),
    defaultBranch: payload.defaultBranch === undefined ? undefined : normalizeBranchName(payload.defaultBranch),
    configPath: payload.configPath === undefined ? undefined : normalizeConfigPath(payload.configPath),
    encryptedRepoToken: encryptedToken,
    now: Date.now(),
  });
  switch (result.kind) {
    case "invalid":
      throw new HttpError(result.status as 400 | 404 | 409 | 500, result.code, result.message, result.details);
    case "not_found":
      throw new HttpError(500, "project_config_missing", "Project configuration is missing.");
    case "applied":
      break;
  }

  queueProjectReconciliation(c, projectId, "update_project");
  const latestRunStatusByProjectId = await listLatestRunStatusByProjectIds(db, [projectIndex.id]);

  logger.info("project_updated", {
    projectId: projectIndex.id,
    userId: user.id,
  });

  const response: ProjectResponse = {
    project: serializeProjectSummary(
      {
        ...projectIndex,
        ...result.config,
      },
      toRunStatusOrNull(latestRunStatusByProjectId.get(projectIndex.id)),
    ),
  };

  return c.json(response, 200);
};

export const handleTriggerProjectRun = async (c: AppContext): Promise<Response> => {
  const { projectId } = await requireOwnedProject(c);
  const user = c.get("user");

  const payload = await parseJson(c.req.raw, TriggerRunRequest);
  const branch = payload.branch === undefined ? null : normalizeBranchName(payload.branch);
  const triggeredByUserId = toTriggeredByUserId(user.id);

  const projectStub = getProjectStub(c.env, projectId);
  const acceptInput: AcceptManualRunInput = {
    projectId,
    triggeredByUserId,
    branch,
  };
  const accepted = await projectStub.acceptManualRun(acceptInput);
  if (accepted.kind === "rejected") {
    throw new HttpError(409, "project_queue_full", "Project already has the maximum number of queued runs.");
  }

  queueProjectReconciliation(c, projectId, "trigger_run");

  logger.info("run_triggered", {
    projectId,
    runId: accepted.runId,
    userId: user.id,
  });

  const response: TriggerRunAcceptedResponse = { runId: accepted.runId };
  return c.json(response, 202);
};
