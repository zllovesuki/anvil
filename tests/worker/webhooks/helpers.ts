import type {
  CreateWebhookRequest,
  GetProjectWebhooksResponse,
  ProjectDetail,
  ProjectResponse,
  RotateWebhookSecretResponse,
  UpdateWebhookRequest,
  UpdateProjectRequest,
  UpsertWebhookResponse,
  WebhookProvider,
} from "@/contracts";

import {
  authHeaders,
  createAuthenticatedSession,
  fetchJson,
  seedProject,
  seedUser,
  type SeededProject,
  type SeededUser,
} from "../../helpers/runtime";

export interface OwnedProjectContext {
  user: SeededUser;
  sessionId: string;
  project: SeededProject;
}

const textToBuffer = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer as ArrayBuffer;

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const signHmacSha256Hex = async (secret: string, body: string): Promise<string> => {
  const key = await crypto.subtle.importKey("raw", textToBuffer(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, textToBuffer(body));
  return toHex(signature);
};

export const signGitHubPayload = async (secret: string, body: string): Promise<string> =>
  `sha256=${await signHmacSha256Hex(secret, body)}`;

export const signGiteaPayload = async (secret: string, body: string): Promise<string> =>
  await signHmacSha256Hex(secret, body);

export const createOwnedProjectContext = async (options?: {
  user?: {
    email?: string;
    slug?: string;
    password?: string;
  };
  project?: {
    projectSlug?: string;
    repoUrl?: string;
    defaultBranch?: string;
    configPath?: string;
    name?: string;
  };
}): Promise<OwnedProjectContext> => {
  const user = await seedUser({
    email: options?.user?.email,
    slug: options?.user?.slug,
    password: options?.user?.password,
  });
  const project = await seedProject(user, {
    projectSlug: options?.project?.projectSlug,
    repoUrl: options?.project?.repoUrl,
    defaultBranch: options?.project?.defaultBranch,
    configPath: options?.project?.configPath,
    name: options?.project?.name,
  });
  const sessionId = await createAuthenticatedSession(user.id);

  return {
    user,
    sessionId,
    project,
  };
};

export const putWebhook = async (
  sessionId: string,
  projectId: string,
  provider: WebhookProvider,
  payload: CreateWebhookRequest | UpdateWebhookRequest,
) =>
  await fetchJson<UpsertWebhookResponse>(`/api/private/projects/${projectId}/webhooks/${provider}`, {
    method: "PUT",
    headers: authHeaders(sessionId, {
      "content-type": "application/json; charset=utf-8",
    }),
    body: JSON.stringify(payload),
  });

export const getWebhooks = async (sessionId: string, projectId: string) =>
  await fetchJson<GetProjectWebhooksResponse>(`/api/private/projects/${projectId}/webhooks`, {
    headers: authHeaders(sessionId),
  });

export const rotateWebhookSecret = async (sessionId: string, projectId: string, provider: WebhookProvider) =>
  await fetchJson<RotateWebhookSecretResponse>(
    `/api/private/projects/${projectId}/webhooks/${provider}/rotate-secret`,
    {
      method: "POST",
      headers: authHeaders(sessionId),
    },
  );

export const deleteWebhook = async (sessionId: string, projectId: string, provider: WebhookProvider) =>
  await fetchJson(`/api/private/projects/${projectId}/webhooks/${provider}`, {
    method: "DELETE",
    headers: authHeaders(sessionId),
  });

export const patchProject = async (sessionId: string, projectId: string, payload: UpdateProjectRequest) =>
  await fetchJson<ProjectResponse>(`/api/private/projects/${projectId}`, {
    method: "PATCH",
    headers: authHeaders(sessionId, {
      "content-type": "application/json; charset=utf-8",
    }),
    body: JSON.stringify(payload),
  });

export const getProjectDetail = async (sessionId: string, projectId: string) =>
  await fetchJson<ProjectDetail>(`/api/private/projects/${projectId}`, {
    headers: authHeaders(sessionId),
  });

export const postPublicWebhook = async <T>(
  provider: WebhookProvider,
  project: Pick<SeededProject, "ownerSlug" | "projectSlug">,
  body: string,
  headers: HeadersInit,
) =>
  await fetchJson<T>(`/api/public/hooks/${provider}/${project.ownerSlug}/${project.projectSlug}`, {
    method: "POST",
    headers,
    body,
  });

export const toGitHubFullName = (repositoryUrl: string): string => {
  const url = new URL(repositoryUrl);
  return url.pathname.replace(/^\/+/u, "");
};

export const buildGitHubRepository = (repositoryUrl: string, defaultBranch = "main") => {
  const fullName = toGitHubFullName(repositoryUrl);

  return {
    full_name: fullName,
    html_url: repositoryUrl,
    clone_url: `${repositoryUrl}.git`,
    default_branch: defaultBranch,
  };
};

export const buildGitLabProjectPayload = (
  repositoryUrl: string,
  defaultBranch = "main",
): {
  default_branch: string;
  git_http_url: string;
  http_url: string;
  path_with_namespace: string;
} => ({
  default_branch: defaultBranch,
  git_http_url: `${repositoryUrl}.git`,
  http_url: repositoryUrl,
  path_with_namespace: new URL(repositoryUrl).pathname.replace(/^\/+/u, ""),
});

export const buildGitLabRepositoryPayload = (repositoryUrl: string) => ({
  git_http_url: `${repositoryUrl}.git`,
});
