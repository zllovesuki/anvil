import { describe, expect, it } from "vitest";

import { authHeaders, fetchJson, mintCookieAuth, seedUser } from "../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";

describe("worker routes", () => {
  registerWorkerRuntimeHooks();

  describe("auth and request validation", () => {
    it("reports app encryption configuration health on the public config route", async () => {
      const result = await fetchJson("/api/public/app-config");

      expect(result.status).toBe(200);
      expect(result.body).toEqual({});
    });

    it("rejects private routes without a valid session", async () => {
      const result = await fetchJson("/api/private/me");

      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({
        error: {
          code: "missing_session",
        },
      });
    });

    it("rejects unsafe private routes without same-origin evidence", async () => {
      const user = await seedUser({
        email: "routes-missing-origin@example.com",
        slug: "routes-missing-origin",
      });

      const { sessionId } = await mintCookieAuth(user.id);
      const headers = authHeaders(sessionId, {
        "content-type": "application/json; charset=utf-8",
      });
      headers.delete("origin");

      const createdProject = await fetchJson("/api/private/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectSlug: "missing-origin",
          name: "Missing Origin",
          repoUrl: "https://github.com/example/missing-origin",
          defaultBranch: "main",
          configPath: ".anvil.yml",
        }),
      });

      expect(createdProject.status).toBe(403);
      expect(createdProject.body).toMatchObject({
        error: {
          code: "cross_origin_blocked",
        },
      });
    });

    it("returns structured codec issues for branded request validation failures", async () => {
      const user = await seedUser({
        email: "routes-invalid@example.com",
        slug: "routes-invalid-user",
      });

      const { sessionId } = await mintCookieAuth(user.id);

      const createdProject = await fetchJson("/api/private/projects", {
        method: "POST",
        headers: authHeaders(sessionId, {
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({
          projectSlug: "api-tests",
          name: "API Tests",
          repoUrl: "https://github.com/example/api-tests",
          defaultBranch: "",
          configPath: ".anvil.yml",
        }),
      });

      expect(createdProject.status).toBe(400);
      expect(createdProject.body).toMatchObject({
        error: {
          code: "invalid_request",
          details: {
            issues: [
              {
                path: "defaultBranch",
                expected: "BranchName",
                message: null,
              },
            ],
          },
        },
      });
    });

    it("treats invalid project ids as project not found on private project routes", async () => {
      const user = await seedUser({
        email: "routes-invalid-project-id@example.com",
        slug: "routes-invalid-project-id",
      });

      const { sessionId } = await mintCookieAuth(user.id);

      const result = await fetchJson("/api/private/projects/not-a-project-id", {
        headers: authHeaders(sessionId),
      });

      expect(result.status).toBe(404);
      expect(result.body).toMatchObject({
        error: {
          code: "project_not_found",
        },
      });
    });
  });
});
