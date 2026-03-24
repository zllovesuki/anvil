import {
  CreateWebhookRequest,
  AcceptInviteRequest,
  CreateInviteRequest,
  CreateInviteResponse,
  CreateProjectRequest,
  UpdateProjectRequest,
  GetMeResponse,
  GetProjectRunsResponse,
  GetProjectsResponse,
  GetProjectWebhooksResponse,
  LoginRequest,
  LoginResponse,
  LogStreamTicketResponse,
  ProjectDetail,
  ProjectResponse,
  RotateWebhookSecretResponse,
  RunDetail,
  TriggerRunAcceptedResponse,
  TriggerRunRequest,
  UpdateWebhookRequest,
  UpsertWebhookResponse,
} from "@/contracts";
import type { ApiClient } from "@/client/lib/api-contract";
import { request } from "@/client/lib/live-api-request";

export const createLiveApiClient = (): ApiClient => ({
  async checkAppConfig() {
    await request({
      path: "/api/public/app-config",
      method: "GET",
    });
  },

  login(payload) {
    const body = LoginRequest.assertDecode(payload);

    return request({
      path: "/api/public/auth/login",
      method: "POST",
      body,
      decode: (value) => LoginResponse.assertDecode(value),
    });
  },

  async logout() {
    await request({
      path: "/api/public/auth/logout",
      method: "POST",
      includeAuth: true,
    });
  },

  getMe() {
    return request({
      path: "/api/private/me",
      method: "GET",
      includeAuth: true,
      decode: (value) => GetMeResponse.assertDecode(value),
    });
  },

  getProjects() {
    return request({
      path: "/api/private/projects",
      method: "GET",
      includeAuth: true,
      decode: (value) => GetProjectsResponse.assertDecode(value),
    });
  },

  createProject(payload) {
    const body = CreateProjectRequest.assertDecode(payload);

    return request({
      path: "/api/private/projects",
      method: "POST",
      body,
      includeAuth: true,
      decode: (value) => ProjectResponse.assertDecode(value),
    });
  },

  updateProject(projectId, payload) {
    const body = UpdateProjectRequest.assertDecode(payload);

    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}`,
      method: "PATCH",
      body,
      includeAuth: true,
      decode: (value) => ProjectResponse.assertDecode(value),
    });
  },

  acceptInvite(payload) {
    const body = AcceptInviteRequest.assertDecode(payload);

    return request({
      path: "/api/public/auth/invite/accept",
      method: "POST",
      body,
      decode: (value) => LoginResponse.assertDecode(value),
    });
  },

  createInvite(payload) {
    const body = CreateInviteRequest.assertDecode(payload);

    return request({
      path: "/api/private/invites",
      method: "POST",
      body,
      includeAuth: true,
      decode: (value) => CreateInviteResponse.assertDecode(value),
    });
  },

  getProjectDetail(projectId) {
    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}`,
      method: "GET",
      includeAuth: true,
      decode: (value) => ProjectDetail.assertDecode(value),
    });
  },

  getProjectRuns(projectId, query) {
    const params = new URLSearchParams();
    if (query?.limit !== undefined) params.set("limit", String(query.limit));
    if (query?.cursor) params.set("cursor", query.cursor);
    const qs = params.toString();

    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/runs${qs ? `?${qs}` : ""}`,
      method: "GET",
      includeAuth: true,
      decode: (value) => GetProjectRunsResponse.assertDecode(value),
    });
  },

  triggerRun(projectId, payload) {
    const body = TriggerRunRequest.assertDecode(payload ?? {});

    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/runs`,
      method: "POST",
      body,
      includeAuth: true,
      decode: (value) => TriggerRunAcceptedResponse.assertDecode(value),
    });
  },

  getRunDetail(runId) {
    return request({
      path: `/api/private/runs/${encodeURIComponent(runId)}`,
      method: "GET",
      includeAuth: true,
      decode: (value) => RunDetail.assertDecode(value),
    });
  },

  cancelRun(runId) {
    return request({
      path: `/api/private/runs/${encodeURIComponent(runId)}/cancel`,
      method: "POST",
      includeAuth: true,
      decode: (value) => RunDetail.assertDecode(value),
    });
  },

  getLogStreamTicket(runId) {
    return request({
      path: `/api/private/runs/${encodeURIComponent(runId)}/log-ticket`,
      method: "POST",
      includeAuth: true,
      decode: (value) => LogStreamTicketResponse.assertDecode(value),
    });
  },

  getProjectWebhooks(projectId) {
    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks`,
      method: "GET",
      includeAuth: true,
      decode: (value) => GetProjectWebhooksResponse.assertDecode(value),
    });
  },

  createWebhook(projectId, provider, payload) {
    const body = CreateWebhookRequest.assertDecode(payload);

    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks/${encodeURIComponent(provider)}`,
      method: "PUT",
      body,
      includeAuth: true,
      decode: (value) => UpsertWebhookResponse.assertDecode(value),
    });
  },

  updateWebhook(projectId, provider, payload) {
    const body = UpdateWebhookRequest.assertDecode(payload);

    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks/${encodeURIComponent(provider)}`,
      method: "PUT",
      body,
      includeAuth: true,
      decode: (value) => UpsertWebhookResponse.assertDecode(value),
    });
  },

  rotateWebhookSecret(projectId, provider) {
    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks/${encodeURIComponent(provider)}/rotate-secret`,
      method: "POST",
      includeAuth: true,
      decode: (value) => RotateWebhookSecretResponse.assertDecode(value),
    });
  },

  async deleteWebhook(projectId, provider) {
    await request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks/${encodeURIComponent(provider)}`,
      method: "DELETE",
      includeAuth: true,
    });
  },
});
