import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import {
  BranchName,
  IsoDateTime,
  OwnerSlug,
  ProjectId,
  ProjectSlug,
  RunId,
  RunStatus,
  UserId,
} from "@/contracts/common";
import { RunSummary } from "@/contracts/run";

export const CreateProjectRequest = eg.exactStrict(
  eg.object({
    projectSlug: ProjectSlug,
    name: eg.string,
    repoUrl: eg.string,
    defaultBranch: BranchName,
    configPath: eg.string.optional,
    repoToken: eg.union([eg.string, eg.null]).optional,
  }),
);
export type CreateProjectRequest = TypeFromCodec<typeof CreateProjectRequest>;

export const UpdateProjectRequest = eg.exactStrict(
  eg.object({
    name: eg.string.optional,
    repoUrl: eg.string.optional,
    defaultBranch: BranchName.optional,
    configPath: eg.string.optional,
    repoToken: eg.union([eg.string, eg.null]).optional,
  }),
);
export type UpdateProjectRequest = TypeFromCodec<typeof UpdateProjectRequest>;

export const ProjectSummary = eg.exactStrict(
  eg.object({
    id: ProjectId,
    ownerUserId: UserId,
    ownerSlug: OwnerSlug,
    projectSlug: ProjectSlug,
    name: eg.string,
    repoUrl: eg.string,
    defaultBranch: BranchName,
    configPath: eg.string,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
    lastRunStatus: eg.union([RunStatus, eg.null]),
  }),
);
export type ProjectSummary = TypeFromCodec<typeof ProjectSummary>;

export const GetProjectsResponse = eg.exactStrict(
  eg.object({
    projects: eg.array(ProjectSummary),
  }),
);
export type GetProjectsResponse = TypeFromCodec<typeof GetProjectsResponse>;

export const ProjectResponse = eg.exactStrict(
  eg.object({
    project: ProjectSummary,
  }),
);
export type ProjectResponse = TypeFromCodec<typeof ProjectResponse>;

export const PendingRunSummary = eg.exactStrict(
  eg.object({
    runId: RunId,
    branch: BranchName,
    queuedAt: IsoDateTime,
  }),
);
export type PendingRunSummary = TypeFromCodec<typeof PendingRunSummary>;

export const ProjectDetail = eg.exactStrict(
  eg.object({
    project: ProjectSummary,
    activeRun: eg.union([RunSummary, eg.null]),
    pendingRuns: eg.array(PendingRunSummary),
  }),
);
export type ProjectDetail = TypeFromCodec<typeof ProjectDetail>;
