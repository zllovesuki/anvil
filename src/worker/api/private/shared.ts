import { ProjectId } from "@/contracts";
import { toCodecIssueDetails } from "@/lib/codec-errors";
import { findOwnedProjectById, type ProjectRow } from "@/worker/db/d1/repositories";
import type { AppContext } from "@/worker/hono";
import { HttpError } from "@/worker/http";

export interface OwnedProjectResolution {
  projectId: ProjectId;
  project: ProjectRow;
}

export const decodeProjectIdParam = (projectId: string): ProjectId => {
  try {
    return ProjectId.assertDecode(projectId);
  } catch (error) {
    throw new HttpError(404, "project_not_found", "Project was not found.", toCodecIssueDetails(error));
  }
};

export const findOwnedProjectForCurrentUser = async (
  c: AppContext,
  projectId: ProjectId,
): Promise<ProjectRow | undefined> => {
  const user = c.get("user");
  return await findOwnedProjectById(c.get("db"), user.id, projectId);
};

export const requireOwnedProject = async (c: AppContext): Promise<OwnedProjectResolution> => {
  const projectId = c.req.param("projectId");
  if (!projectId) {
    throw new HttpError(404, "project_not_found", "Project was not found.");
  }

  const decodedProjectId = decodeProjectIdParam(projectId);
  const project = await findOwnedProjectForCurrentUser(c, decodedProjectId);
  if (!project) {
    throw new HttpError(404, "project_not_found", "Project was not found.");
  }

  return { projectId: decodedProjectId, project };
};
