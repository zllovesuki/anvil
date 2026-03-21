import {
  AcceptInviteRequest,
  CreateWebhookRequest,
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
  ProjectSummary,
  RotateWebhookSecretResponse,
  RunSummary,
  TriggerRunAcceptedResponse,
  UpdateWebhookRequest,
  UpsertWebhookResponse,
  UserSummary,
} from "@/contracts";
import { ApiError, type ApiClient } from "@/client/lib/api-contract";
import { getStoredSessionId } from "@/client/lib/storage";
import {
  ENTITY_ID_ALPHABET,
  SESSION_ID_ALPHABET,
  randomString,
  randomEntityId,
  randomSessionId,
  nowIso,
  plusHoursIso,
  toSlug,
  simpleHash,
  assertMockWebhookConfigAllowed,
  buildMockRunDetail,
  buildMockDeliveries,
  buildMockWebhookSummary,
  loadState,
  writeState,
  touchBookmark,
  persistState,
  requireSession,
} from "./mock/index";
const MOCK_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const createMockApiClient = (): ApiClient => ({
  async login(payload) {
    const body = LoginRequest.assertDecode(payload);
    const state = loadState();
    const normalizedEmail = body.email.trim().toLowerCase();
    if (!normalizedEmail || !body.password.trim()) {
      throw new ApiError(400, "invalid_credentials", "Mock mode requires both email and password.");
    }
    let user = state.users.find((candidate) => candidate.email === normalizedEmail);
    if (!user) {
      user = UserSummary.assertDecode({
        id: randomEntityId("usr"),
        slug: toSlug(normalizedEmail.split("@")[0] ?? normalizedEmail),
        email: normalizedEmail,
        displayName: normalizedEmail.split("@")[0] || "New Operator",
        createdAt: nowIso(),
        disabledAt: null,
      });
      state.users.push(user);
    }
    const sessionId = randomSessionId();
    const expiresAt = plusHoursIso(6);
    state.sessions[sessionId] = {
      userId: user.id,
      expiresAt,
    };
    persistState(state);
    return LoginResponse.assertDecode({
      sessionId,
      expiresAt,
      user,
      inviteTtlSeconds: MOCK_INVITE_TTL_SECONDS,
    });
  },
  async logout() {
    const state = loadState();
    const sessionId = getStoredSessionId();
    if (sessionId && sessionId in state.sessions) {
      delete state.sessions[sessionId];
      persistState(state);
      return;
    }
    touchBookmark(state);
    writeState(state);
  },
  async getMe() {
    const state = loadState();
    const { user } = requireSession(state);
    persistState(state);
    return GetMeResponse.assertDecode({
      user,
      inviteTtlSeconds: MOCK_INVITE_TTL_SECONDS,
    });
  },
  async getProjects() {
    const state = loadState();
    const { user } = requireSession(state);
    const projects = [...state.projects]
      .filter((project) => project.ownerUserId === user.id)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    persistState(state);
    return GetProjectsResponse.assertDecode({
      projects,
    });
  },
  async acceptInvite(payload) {
    const body = AcceptInviteRequest.assertDecode(payload);
    const state = loadState();
    if (!body.token.trim()) {
      throw new ApiError(400, "invalid_request", "Invite token is required.");
    }
    const tokenHash = simpleHash(body.token);
    const invite = state.invites.find((inv) => inv.tokenHash === tokenHash);
    if (!invite) {
      throw new ApiError(404, "invite_not_found", "Invite token is invalid or has already been used.");
    }
    if (invite.acceptedByUserId) {
      throw new ApiError(409, "invite_already_accepted", "This invite has already been accepted.");
    }
    if (Date.parse(invite.expiresAt) <= Date.now()) {
      throw new ApiError(410, "invite_expired", "This invite has expired.");
    }
    const normalizedEmail = body.email.trim().toLowerCase();
    const existingUser = state.users.find((u) => u.email === normalizedEmail);
    if (existingUser) {
      throw new ApiError(409, "email_taken", "A user with this email already exists.");
    }
    const existingSlug = state.users.find((u) => u.slug === body.slug);
    if (existingSlug) {
      throw new ApiError(409, "slug_taken", "This slug is already in use.");
    }
    const newUser = UserSummary.assertDecode({
      id: randomEntityId("usr"),
      slug: body.slug,
      email: normalizedEmail,
      displayName: body.displayName,
      createdAt: nowIso(),
      disabledAt: null,
    });
    state.users.push(newUser);
    invite.acceptedByUserId = newUser.id;
    invite.acceptedAt = nowIso();
    const sessionId = randomSessionId();
    const expiresAt = plusHoursIso(6);
    state.sessions[sessionId] = {
      userId: newUser.id,
      expiresAt,
    };
    persistState(state);
    return LoginResponse.assertDecode({
      sessionId,
      expiresAt,
      user: newUser,
      inviteTtlSeconds: MOCK_INVITE_TTL_SECONDS,
    });
  },
  async createInvite(payload) {
    const body = CreateInviteRequest.assertDecode(payload);
    const state = loadState();
    const { user } = requireSession(state);
    const token = randomString(SESSION_ID_ALPHABET, 48);
    const hoursUntilExpiry = body.expiresInHours ?? MOCK_INVITE_TTL_SECONDS / 60 / 60;
    const inviteId = randomEntityId("inv");
    const now = nowIso();
    state.invites.push({
      inviteId,
      tokenHash: simpleHash(token),
      createdByUserId: user.id,
      expiresAt: plusHoursIso(hoursUntilExpiry),
      acceptedByUserId: null,
      acceptedAt: null,
      createdAt: now,
    });
    persistState(state);
    return CreateInviteResponse.assertDecode({
      inviteId,
      token,
      expiresAt: plusHoursIso(hoursUntilExpiry),
      createdAt: now,
    });
  },
  async createProject(payload) {
    const body = CreateProjectRequest.assertDecode(payload);
    const state = loadState();
    const { user } = requireSession(state);
    const projectSlug = body.projectSlug.trim().toLowerCase();
    if (!body.name.trim()) {
      throw new ApiError(400, "invalid_request", "Project name is required.");
    }
    if (!body.repoUrl.startsWith("https://")) {
      throw new ApiError(400, "invalid_request", "Repository URL must use https:// in mock mode.");
    }
    const duplicate = state.projects.find(
      (project) => project.ownerSlug === user.slug && project.projectSlug === projectSlug,
    );
    if (duplicate) {
      throw new ApiError(409, "project_slug_taken", "Project slug is already in use for this owner.");
    }
    const timestamp = nowIso();
    const project = ProjectSummary.assertDecode({
      id: randomEntityId("prj"),
      ownerUserId: user.id,
      ownerSlug: user.slug,
      projectSlug,
      name: body.name.trim(),
      repoUrl: body.repoUrl.trim(),
      defaultBranch: body.defaultBranch.trim(),
      configPath: body.configPath?.trim() || ".anvil.yml",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastRunStatus: null,
    });
    state.projects.push(project);
    persistState(state);
    return ProjectResponse.assertDecode({
      project,
    });
  },
  async updateProject(projectId, payload) {
    const body = UpdateProjectRequest.assertDecode(payload);
    const state = loadState();
    const { user } = requireSession(state);
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Project not found.");
    }
    if (body.name !== undefined) project.name = body.name.trim();
    if (body.repoUrl !== undefined) project.repoUrl = body.repoUrl.trim();
    if (body.defaultBranch !== undefined)
      project.defaultBranch = body.defaultBranch.trim() as typeof project.defaultBranch;
    if (body.configPath !== undefined) project.configPath = body.configPath.trim();
    project.updatedAt = nowIso() as typeof project.updatedAt;
    persistState(state);
    return ProjectResponse.assertDecode({
      project,
    });
  },
  async getProjectDetail(projectId) {
    const state = loadState();
    const { user } = requireSession(state);
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Project not found.");
    }
    const projectRuns = state.runs.filter((run) => run.projectId === projectId);
    const activeStatuses = new Set(["running", "starting", "cancel_requested", "canceling"]);
    const activeRun = projectRuns.find((run) => activeStatuses.has(run.status)) ?? null;
    const pendingRuns = projectRuns
      .filter((run) => run.status === "queued")
      .map((run) => ({ runId: run.id, branch: run.branch, queuedAt: run.queuedAt }));
    persistState(state);
    return ProjectDetail.assertDecode({
      project,
      activeRun,
      pendingRuns,
    });
  },
  async getProjectRuns(projectId, query) {
    const state = loadState();
    const { user } = requireSession(state);
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Project not found.");
    }
    const sorted = state.runs
      .filter((run) => run.projectId === projectId)
      .sort((left, right) => right.queuedAt.localeCompare(left.queuedAt));
    const limit = query?.limit ?? 20;
    const cursorIndex = query?.cursor ? parseInt(query.cursor, 10) : 0;
    const page = sorted.slice(cursorIndex, cursorIndex + limit);
    const nextIndex = cursorIndex + limit;
    const nextCursor = nextIndex < sorted.length ? String(nextIndex) : null;
    persistState(state);
    return GetProjectRunsResponse.assertDecode({
      runs: page,
      nextCursor,
    });
  },
  async triggerRun(projectId, payload) {
    const state = loadState();
    const { user } = requireSession(state);
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Project not found.");
    }
    const branch = payload?.branch?.trim() || project.defaultBranch;
    const timestamp = nowIso();
    const run = RunSummary.assertDecode({
      id: randomEntityId("run"),
      projectId,
      triggeredByUserId: user.id,
      triggerType: "manual",
      branch,
      commitSha: null,
      status: "queued",
      queuedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
    });
    state.runs.push(run);
    project.lastRunStatus = "queued";
    project.updatedAt = timestamp as typeof project.updatedAt;
    persistState(state);
    return TriggerRunAcceptedResponse.assertDecode({
      runId: run.id,
    });
  },
  async getRunDetail(runId) {
    const state = loadState();
    const { user } = requireSession(state);
    const run = state.runs.find((candidate) => candidate.id === runId);
    if (!run) {
      throw new ApiError(404, "not_found", "Run not found.");
    }
    const project = state.projects.find((candidate) => candidate.id === run.projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Run not found.");
    }
    persistState(state);
    return buildMockRunDetail(run);
  },
  async cancelRun(runId) {
    const state = loadState();
    const { user } = requireSession(state);
    const run = state.runs.find((candidate) => candidate.id === runId);
    if (!run) {
      throw new ApiError(404, "not_found", "Run not found.");
    }
    const project = state.projects.find((candidate) => candidate.id === run.projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Run not found.");
    }
    const terminalStatuses = new Set(["passed", "failed", "canceled"]);
    if (terminalStatuses.has(run.status)) {
      throw new ApiError(409, "already_terminal", "Run has already finished.");
    }
    run.status = "canceled" as typeof run.status;
    run.finishedAt = nowIso() as typeof run.finishedAt;
    persistState(state);
    return buildMockRunDetail(run);
  },
  async getLogStreamTicket(runId) {
    const state = loadState();
    const { user } = requireSession(state);
    const run = state.runs.find((candidate) => candidate.id === runId);
    if (!run) {
      throw new ApiError(404, "not_found", "Run not found.");
    }
    const project = state.projects.find((candidate) => candidate.id === run.projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Run not found.");
    }
    return LogStreamTicketResponse.assertDecode({
      ticket: `mock-ticket-${randomString(ENTITY_ID_ALPHABET, 16)}`,
      expiresAt: plusHoursIso(1),
    });
  },
  async getProjectWebhooks(projectId) {
    const state = loadState();
    const { user } = requireSession(state);
    const project = state.projects.find((p) => p.id === projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Project not found.");
    }
    const webhooks = state.webhooks.filter((w) => w.projectId === projectId).map(buildMockWebhookSummary);
    persistState(state);
    return GetProjectWebhooksResponse.assertDecode({ webhooks });
  },
  async createWebhook(projectId, provider, payload) {
    const body = CreateWebhookRequest.assertDecode(payload);
    const state = loadState();
    const { user } = requireSession(state);
    const project = state.projects.find((p) => p.id === projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Project not found.");
    }
    const existing = state.webhooks.find((w) => w.projectId === projectId && w.provider === provider);
    if (existing) {
      throw new ApiError(
        409,
        "webhook_create_conflict",
        "Webhook already exists. Retry without a secret or rotate the secret instead.",
      );
    }
    assertMockWebhookConfigAllowed({
      provider,
      config: body.config,
      creating: true,
    });
    const timestamp = nowIso();
    let generatedSecret: string | null = null;
    const secret = body.secret ?? randomString(SESSION_ID_ALPHABET, 32);
    generatedSecret = body.secret ? null : secret;
    state.webhooks.push({
      id: randomEntityId("whk"),
      projectId,
      provider,
      enabled: body.enabled,
      config: body.config ?? null,
      secret,
      createdAt: timestamp,
      updatedAt: timestamp,
      deliveries: buildMockDeliveries(provider, project.repoUrl, project.defaultBranch),
    });
    const record = state.webhooks.find((w) => w.projectId === projectId && w.provider === provider)!;
    persistState(state);
    return UpsertWebhookResponse.assertDecode({
      webhook: buildMockWebhookSummary(record),
      generatedSecret,
    });
  },
  async updateWebhook(projectId, provider, payload) {
    const body = UpdateWebhookRequest.assertDecode(payload);
    const state = loadState();
    const { user } = requireSession(state);
    const project = state.projects.find((p) => p.id === projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Project not found.");
    }
    const existing = state.webhooks.find((w) => w.projectId === projectId && w.provider === provider);
    if (!existing) {
      throw new ApiError(404, "webhook_not_found", "Webhook was not found.");
    }
    assertMockWebhookConfigAllowed({
      provider,
      config: body.config,
      creating: false,
    });
    existing.enabled = body.enabled;
    if (body.config !== undefined) {
      existing.config = body.config ?? null;
    }
    existing.updatedAt = nowIso();
    persistState(state);
    return UpsertWebhookResponse.assertDecode({
      webhook: buildMockWebhookSummary(existing),
      generatedSecret: null,
    });
  },
  async rotateWebhookSecret(projectId, provider) {
    const state = loadState();
    const { user } = requireSession(state);
    const project = state.projects.find((p) => p.id === projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Project not found.");
    }
    const webhook = state.webhooks.find((w) => w.projectId === projectId && w.provider === provider);
    if (!webhook) {
      throw new ApiError(404, "webhook_not_found", "Webhook was not found.");
    }
    const newSecret = randomString(SESSION_ID_ALPHABET, 32);
    webhook.secret = newSecret;
    webhook.updatedAt = nowIso();
    persistState(state);
    return RotateWebhookSecretResponse.assertDecode({ secret: newSecret });
  },
  async deleteWebhook(projectId, provider) {
    const state = loadState();
    const { user } = requireSession(state);
    const project = state.projects.find((p) => p.id === projectId);
    if (!project || project.ownerUserId !== user.id) {
      throw new ApiError(404, "not_found", "Project not found.");
    }
    const index = state.webhooks.findIndex((w) => w.projectId === projectId && w.provider === provider);
    if (index === -1) {
      throw new ApiError(404, "webhook_not_found", "Webhook was not found.");
    }
    state.webhooks.splice(index, 1);
    persistState(state);
  },
});
