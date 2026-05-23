import { describe, expect, it } from "vitest";

import { authHeaders, createAuthenticatedSession, fetchJson, seedUser } from "../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";

describe("worker public auth routes", () => {
  registerWorkerRuntimeHooks();

  it("removes password login, invite acceptance, and private invite creation routes", async () => {
    const user = await seedUser({
      email: "removed-auth-routes@example.com",
      slug: "removed-auth-routes",
    });
    const sessionId = await createAuthenticatedSession(user.id);

    const login = await fetchJson("/api/public/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: "https://example.com",
      },
      body: JSON.stringify({}),
    });
    expect(login.status).toBe(404);

    const acceptInvite = await fetchJson("/api/public/auth/invite/accept", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: "https://example.com",
      },
      body: JSON.stringify({}),
    });
    expect(acceptInvite.status).toBe(404);

    const createInvite = await fetchJson("/api/private/invites", {
      method: "POST",
      headers: authHeaders(sessionId, {
        "content-type": "application/json; charset=utf-8",
      }),
      body: JSON.stringify({}),
    });
    expect(createInvite.status).toBe(404);
  });

  it("logs out idempotently with the session cookie transport", async () => {
    const user = await seedUser({
      email: "cookie-logout@example.com",
      slug: "cookie-logout",
    });
    const sessionId = await createAuthenticatedSession(user.id);

    const authenticatedLogout = await fetchJson("/api/public/auth/logout", {
      method: "POST",
      headers: authHeaders(sessionId),
    });
    expect(authenticatedLogout.status).toBe(204);
    expect(authenticatedLogout.response.headers.get("set-cookie")).toContain("__Host-anvil_session=");

    const me = await fetchJson("/api/private/me", {
      headers: authHeaders(sessionId),
    });
    expect(me.status).toBe(403);
    expect(me.body).toMatchObject({
      error: {
        code: "invalid_session",
      },
    });

    const anonymousLogout = await fetchJson("/api/public/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://example.com",
      },
    });
    expect(anonymousLogout.status).toBe(204);
  });

  it("blocks cookie-bound logout without same-origin evidence", async () => {
    const result = await fetchJson("/api/public/auth/logout", {
      method: "POST",
    });

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      error: {
        code: "cross_origin_blocked",
      },
    });
  });
});
