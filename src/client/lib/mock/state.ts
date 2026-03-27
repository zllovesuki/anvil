import { ApiError } from "@/client/lib/api-contract";
import { getStoredSessionId, readStoredString, setStoredBookmark, writeStoredString } from "@/client/lib/storage";
import { DEFAULT_DISPATCH_MODE } from "@/contracts";
import type { MockState } from "./types";
import { seedProjects, seedRuns, seedUser, seedWebhooks } from "./seed-data";
import { buildMockDeliveries } from "./builders";
import { MOCK_DB_KEY } from "./utils";

export const createSeedState = (): MockState => ({
  version: 2,
  bookmarkCounter: 0,
  users: [seedUser],
  sessions: {},
  projects: seedProjects,
  invites: [],
  runs: seedRuns,
  webhooks: seedWebhooks,
});

export const writeState = (state: MockState): void => {
  writeStoredString(MOCK_DB_KEY, JSON.stringify(state));
};

export const touchBookmark = (state: MockState): void => {
  state.bookmarkCounter += 1;
  setStoredBookmark(`mock-${String(state.bookmarkCounter).padStart(6, "0")}`);
};

export const loadState = (): MockState => {
  const raw = readStoredString(MOCK_DB_KEY);

  if (!raw) {
    const state = createSeedState();
    writeState(state);
    return state;
  }

  try {
    const parsed = JSON.parse(raw) as MockState;
    const state: MockState = parsed.version === 2 ? parsed : createSeedState();
    if (!state.invites) {
      state.invites = [];
    }
    if (!Array.isArray(state.runs)) state.runs = [];
    if (!Array.isArray(state.webhooks)) {
      state.webhooks = seedWebhooks.filter((w) => state.projects.some((p) => p.id === w.projectId));
    }

    // Backfill dispatchMode for projects that predate the field
    for (const project of state.projects) {
      if (!project.dispatchMode) {
        project.dispatchMode = DEFAULT_DISPATCH_MODE;
      }
    }

    // Backfill mock deliveries for webhooks that have none
    for (const webhook of state.webhooks) {
      if (webhook.deliveries.length === 0) {
        const project = state.projects.find((p) => p.id === webhook.projectId);
        if (project) {
          webhook.deliveries = buildMockDeliveries(webhook.provider, project.repoUrl, project.defaultBranch);
        }
      }
    }

    const now = Date.now();
    let mutated = false;

    for (const [sessionId, session] of Object.entries(state.sessions)) {
      if (Date.parse(session.expiresAt) <= now) {
        delete state.sessions[sessionId];
        mutated = true;
      }
    }

    if (mutated) {
      writeState(state);
    }

    return state;
  } catch {
    const state = createSeedState();
    writeState(state);
    return state;
  }
};

export const persistState = (state: MockState): void => {
  touchBookmark(state);
  writeState(state);
};

export const requireSession = (state: MockState) => {
  const sessionId = getStoredSessionId();
  if (!sessionId) {
    throw new ApiError(403, "invalid_session", "Session is missing or expired.");
  }

  const session = state.sessions[sessionId];
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    if (sessionId in state.sessions) {
      delete state.sessions[sessionId];
      writeState(state);
    }

    throw new ApiError(403, "invalid_session", "Session is missing or expired.");
  }

  const user = state.users.find((candidate) => candidate.id === session.userId);
  if (!user) {
    throw new ApiError(403, "invalid_session", "Session user no longer exists.");
  }

  return { sessionId, session, user };
};
