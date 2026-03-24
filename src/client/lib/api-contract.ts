import type {
  CreateWebhookRequest,
  CreateInviteResponse,
  GetMeResponse,
  GetProjectRunsResponse,
  GetProjectsResponse,
  GetProjectWebhooksResponse,
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
  WebhookProvider,
} from "@/contracts";

export interface ApiClient {
  checkAppConfig(): Promise<void>;
  login(payload: unknown): Promise<LoginResponse>;
  logout(): Promise<void>;
  getMe(): Promise<GetMeResponse>;
  getProjects(): Promise<GetProjectsResponse>;
  createProject(payload: unknown): Promise<ProjectResponse>;
  updateProject(projectId: string, payload: unknown): Promise<ProjectResponse>;
  acceptInvite(payload: unknown): Promise<LoginResponse>;
  createInvite(payload: unknown): Promise<CreateInviteResponse>;
  getProjectDetail(projectId: string): Promise<ProjectDetail>;
  getProjectRuns(projectId: string, query?: { limit?: number; cursor?: string }): Promise<GetProjectRunsResponse>;
  triggerRun(projectId: string, payload?: TriggerRunRequest): Promise<TriggerRunAcceptedResponse>;
  getRunDetail(runId: string): Promise<RunDetail>;
  cancelRun(runId: string): Promise<RunDetail>;
  getLogStreamTicket(runId: string): Promise<LogStreamTicketResponse>;
  getProjectWebhooks(projectId: string): Promise<GetProjectWebhooksResponse>;
  createWebhook(
    projectId: string,
    provider: WebhookProvider,
    payload: CreateWebhookRequest,
  ): Promise<UpsertWebhookResponse>;
  updateWebhook(
    projectId: string,
    provider: WebhookProvider,
    payload: UpdateWebhookRequest,
  ): Promise<UpsertWebhookResponse>;
  rotateWebhookSecret(projectId: string, provider: WebhookProvider): Promise<RotateWebhookSecretResponse>;
  deleteWebhook(projectId: string, provider: WebhookProvider): Promise<void>;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  public constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}
