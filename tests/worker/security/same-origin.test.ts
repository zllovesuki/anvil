import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "@/worker/hono";
import { HttpError, toErrorResponse } from "@/worker/http";
import { requireSameOrigin } from "@/worker/security/same-origin";

const buildApp = () => {
  const app = new Hono<AppEnv>();
  app.use("*", requireSameOrigin);
  app.all("/guarded", (c) => c.json({ ok: true }));
  app.onError((error, c) => toErrorResponse(c, error instanceof Error ? error : new HttpError(500, "error", "error")));
  return app;
};

const fetchGuarded = async (method: string, headers?: HeadersInit): Promise<Response> =>
  await buildApp().fetch(new Request("https://example.com/guarded", { method, headers }), env);

describe("same-origin guard", () => {
  it("skips safe methods", async () => {
    expect((await fetchGuarded("GET")).status).toBe(200);
  });

  it("allows same-origin Origin and trusted Fetch Metadata", async () => {
    expect((await fetchGuarded("POST", { origin: "https://example.com" })).status).toBe(200);
    expect((await fetchGuarded("POST", { "sec-fetch-site": "none" })).status).toBe(200);
  });

  it("rejects missing and cross-origin unsafe requests", async () => {
    const missingOrigin = await fetchGuarded("POST");
    expect(missingOrigin.status).toBe(403);

    const crossOrigin = await fetchGuarded("POST", { origin: "https://evil.example" });
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toMatchObject({
      error: {
        code: "cross_origin_blocked",
      },
    });
  });
});
