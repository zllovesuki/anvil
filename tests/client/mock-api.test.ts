import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockApiClient } from "@/client/lib/mock-api";
import { MOCK_DEMO_EMAIL, MOCK_DEMO_PASSWORD } from "@/client/lib/mock";
import { seedProjects } from "@/client/lib/mock/seed-data";
import { setStoredSessionId } from "@/client/lib/storage";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

const createLocalStorage = (): Pick<Storage, "getItem" | "setItem" | "removeItem"> => {
  const values = new Map<string, string>();

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
};

const setTestWindow = (): void => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: createLocalStorage(),
    },
  });
};

const restoreWindow = (): void => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, "window");
};

const expectedSeedProjectIds = [...seedProjects]
  .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  .map((project) => project.id);

describe("mock api demo workspace", () => {
  beforeEach(() => {
    setTestWindow();
  });

  afterEach(() => {
    restoreWindow();
  });

  it("returns the seeded projects for the canonical mock fixture account", async () => {
    const client = createMockApiClient();
    const loginResponse = await client.login({
      email: MOCK_DEMO_EMAIL,
      password: MOCK_DEMO_PASSWORD,
    });

    setStoredSessionId(loginResponse.sessionId);

    const projectsResponse = await client.getProjects();

    expect(loginResponse.user.email).toBe(MOCK_DEMO_EMAIL);
    expect(projectsResponse.projects.map((project) => project.id)).toEqual(expectedSeedProjectIds);
  });

  it("keeps unrelated mock users on an empty workspace", async () => {
    const client = createMockApiClient();
    const loginResponse = await client.login({
      email: "someone@example.com",
      password: "pw",
    });

    setStoredSessionId(loginResponse.sessionId);

    const projectsResponse = await client.getProjects();

    expect(projectsResponse.projects).toEqual([]);
  });

  it("ignores stale pre-fix mock storage and recreates the seeded workspace", async () => {
    window.localStorage.setItem(
      "anvil.mock.db.v1",
      JSON.stringify({
        version: 1,
        bookmarkCounter: 0,
        users: [],
        sessions: {},
        projects: [],
        invites: [],
        runs: [],
        webhooks: [],
      }),
    );

    const client = createMockApiClient();
    const loginResponse = await client.login({
      email: MOCK_DEMO_EMAIL,
      password: MOCK_DEMO_PASSWORD,
    });

    setStoredSessionId(loginResponse.sessionId);

    const projectsResponse = await client.getProjects();

    expect(projectsResponse.projects.map((project) => project.id)).toEqual(expectedSeedProjectIds);
  });
});
