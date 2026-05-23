import {
  CreateWebhookRequest,
  CreateProjectRequest,
  UpdateProjectRequest,
  GetMeResponse,
  PublicAppConfigResponse,
  GetProjectRunsResponse,
  GetProjectsResponse,
  GetProjectWebhooksResponse,
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
  getAppConfig() {
    return request({
      path: "/api/public/app-config",
      method: "GET",
      decode: (value) => PublicAppConfigResponse.assertDecode(value),
    });
  },

  async logout() {
    await request({
      path: "/api/public/auth/logout",
      method: "POST",
    });
  },

  getMe() {
    return request({
      path: "/api/private/me",
      method: "GET",
      decode: (value) => GetMeResponse.assertDecode(value),
    });
  },

  getProjects() {
    return request({
      path: "/api/private/projects",
      method: "GET",
      decode: (value) => GetProjectsResponse.assertDecode(value),
    });
  },

  createProject(payload) {
    const body = CreateProjectRequest.assertDecode(payload);

    return request({
      path: "/api/private/projects",
      method: "POST",
      body,
      decode: (value) => ProjectResponse.assertDecode(value),
    });
  },

  updateProject(projectId, payload) {
    const body = UpdateProjectRequest.assertDecode(payload);

    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}`,
      method: "PATCH",
      body,
      decode: (value) => ProjectResponse.assertDecode(value),
    });
  },

  getProjectDetail(projectId) {
    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}`,
      method: "GET",
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
      decode: (value) => GetProjectRunsResponse.assertDecode(value),
    });
  },

  triggerRun(projectId, payload) {
    const body = TriggerRunRequest.assertDecode(payload ?? {});

    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/runs`,
      method: "POST",
      body,
      decode: (value) => TriggerRunAcceptedResponse.assertDecode(value),
    });
  },

  getRunDetail(runId) {
    return request({
      path: `/api/private/runs/${encodeURIComponent(runId)}`,
      method: "GET",
      decode: (value) => RunDetail.assertDecode(value),
    });
  },

  cancelRun(runId) {
    return request({
      path: `/api/private/runs/${encodeURIComponent(runId)}/cancel`,
      method: "POST",
      decode: (value) => RunDetail.assertDecode(value),
    });
  },

  getLogStreamTicket(runId) {
    return request({
      path: `/api/private/runs/${encodeURIComponent(runId)}/log-ticket`,
      method: "POST",
      decode: (value) => LogStreamTicketResponse.assertDecode(value),
    });
  },

  getProjectWebhooks(projectId) {
    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks`,
      method: "GET",
      decode: (value) => GetProjectWebhooksResponse.assertDecode(value),
    });
  },

  createWebhook(projectId, provider, payload) {
    const body = CreateWebhookRequest.assertDecode(payload);

    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks/${encodeURIComponent(provider)}`,
      method: "PUT",
      body,
      decode: (value) => UpsertWebhookResponse.assertDecode(value),
    });
  },

  updateWebhook(projectId, provider, payload) {
    const body = UpdateWebhookRequest.assertDecode(payload);

    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks/${encodeURIComponent(provider)}`,
      method: "PUT",
      body,
      decode: (value) => UpsertWebhookResponse.assertDecode(value),
    });
  },

  rotateWebhookSecret(projectId, provider) {
    return request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks/${encodeURIComponent(provider)}/rotate-secret`,
      method: "POST",
      decode: (value) => RotateWebhookSecretResponse.assertDecode(value),
    });
  },

  async deleteWebhook(projectId, provider) {
    await request({
      path: `/api/private/projects/${encodeURIComponent(projectId)}/webhooks/${encodeURIComponent(provider)}`,
      method: "DELETE",
    });
  },
});
