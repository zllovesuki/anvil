import type {
  DispatchMode,
  ProjectSummary,
  RunSummary,
  UserSummary,
  WebhookProvider,
  WebhookProviderConfig,
} from "@/contracts";

interface MockSessionRecord {
  userId: string;
  expiresAt: string;
}

interface MockInviteRecord {
  inviteId: string;
  tokenHash: string;
  createdByUserId: string;
  expiresAt: string;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

interface MockWebhookRecord {
  id: string;
  projectId: string;
  provider: WebhookProvider;
  enabled: boolean;
  config: WebhookProviderConfig | null;
  secret: string;
  createdAt: string;
  updatedAt: string;
  deliveries: Array<{
    deliveryId: string;
    provider: WebhookProvider;
    eventKind: string;
    eventName: string;
    outcome: string;
    repoUrl: string;
    ref: string | null;
    branch: string | null;
    commitSha: string | null;
    beforeSha: string | null;
    runId: string | null;
    receivedAt: string;
  }>;
}

interface MockProjectRecord extends ProjectSummary {
  dispatchMode?: DispatchMode;
}

interface MockState {
  version: 2;
  bookmarkCounter: number;
  users: UserSummary[];
  sessions: Record<string, MockSessionRecord>;
  projects: MockProjectRecord[];
  invites: MockInviteRecord[];
  runs: RunSummary[];
  webhooks: MockWebhookRecord[];
}

export type { MockSessionRecord, MockInviteRecord, MockProjectRecord, MockWebhookRecord, MockState };
