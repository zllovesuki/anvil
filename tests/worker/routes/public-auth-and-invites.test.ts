import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  MAX_INVITE_TTL_HOURS,
  MIN_PASSWORD_LENGTH,
  OwnerSlug,
  type AcceptInviteRequest,
  type CreateInviteResponse,
  type GetMeResponse,
  type LoginResponse,
} from "@/contracts";
import { createD1Db } from "@/worker/db/d1";
import * as d1Schema from "@/worker/db/d1/schema";

import { authHeaders, fetchJson, loginViaRoute, seedUser } from "../../helpers/runtime";
import { registerWorkerRuntimeHooks } from "../../helpers/worker-hooks";

const createInviteViaRoute = async (sessionId: string, expiresInHours?: number) =>
  await fetchJson<CreateInviteResponse>("/api/private/invites", {
    method: "POST",
    headers: authHeaders(sessionId, {
      "content-type": "application/json; charset=utf-8",
    }),
    body: JSON.stringify(expiresInHours === undefined ? {} : { expiresInHours }),
  });

const acceptInviteViaRoute = async (payload: AcceptInviteRequest) =>
  await fetchJson<LoginResponse>("/api/public/auth/invite/accept", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

const logoutViaRoute = async (sessionId?: string) =>
  await fetchJson("/api/public/auth/logout", {
    method: "POST",
    headers: sessionId ? authHeaders(sessionId) : undefined,
  });

const uniqueSuffix = (): string => crypto.randomUUID().replace(/-/g, "");

describe("worker public auth and invite routes", () => {
  registerWorkerRuntimeHooks();

  it("rejects invalid credentials and hides disabled users from login", async () => {
    const user = await seedUser({
      email: "public-auth@example.com",
      slug: "public-auth-user",
      password: "swordfish",
    });

    const wrongPassword = await loginViaRoute({
      email: user.email,
      password: "incorrect-password",
    });
    expect(wrongPassword.status).toBe(403);
    expect(wrongPassword.body).toMatchObject({
      error: {
        code: "invalid_credentials",
      },
    });

    const db = createD1Db(env.DB);
    await db
      .update(d1Schema.users)
      .set({
        disabledAt: Date.now(),
      })
      .where(eq(d1Schema.users.id, user.id));

    const disabledUserLogin = await loginViaRoute(user);
    expect(disabledUserLogin.status).toBe(403);
    expect(disabledUserLogin.body).toMatchObject({
      error: {
        code: "invalid_credentials",
      },
    });
  });

  it("logs out idempotently and invalidates an active session", async () => {
    const user = await seedUser({
      email: "public-logout@example.com",
      slug: "public-logout-user",
      password: "swordfish",
    });

    const login = await loginViaRoute(user);
    expect(login.status).toBe(200);
    expect(login.body).not.toBeNull();
    expect(login.body!.inviteTtlSeconds).toBe(Number(env.INVITE_TTL_SECONDS));
    const sessionId = login.body!.sessionId;

    const anonymousLogout = await logoutViaRoute();
    expect(anonymousLogout.status).toBe(204);

    const authenticatedLogout = await logoutViaRoute(sessionId);
    expect(authenticatedLogout.status).toBe(204);

    const me = await fetchJson<GetMeResponse>("/api/private/me", {
      headers: authHeaders(sessionId),
    });
    expect(me.status).toBe(403);
    expect(me.body).toMatchObject({
      error: {
        code: "invalid_session",
      },
    });
  });

  it("rate limits repeated login attempts per normalized email", async () => {
    const suffix = uniqueSuffix();
    const user = await seedUser({
      email: `login-rate-limit-${suffix}@example.com`,
      slug: `login-rate-limit-${suffix}`,
      password: "swordfish",
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const login = await loginViaRoute({
        email: user.email.toUpperCase(),
        password: "wrong-password",
      });

      expect(login.status).toBe(403);
      expect(login.response.headers.get("retry-after")).toBeNull();
      expect(login.body).toMatchObject({
        error: {
          code: "invalid_credentials",
        },
      });
    }

    const rateLimited = await loginViaRoute({
      email: user.email,
      password: "wrong-password",
    });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.response.headers.get("retry-after")).toBe("60");
    expect(rateLimited.body).toMatchObject({
      error: {
        code: "rate_limited",
      },
    });
  });

  it("keeps login rate limits separate across emails", async () => {
    const suffix = uniqueSuffix();
    const firstUser = await seedUser({
      email: `login-rate-limit-first-${suffix}@example.com`,
      slug: `login-rate-limit-first-${suffix}`,
      password: "swordfish",
    });
    const secondUser = await seedUser({
      email: `login-rate-limit-second-${suffix}@example.com`,
      slug: `login-rate-limit-second-${suffix}`,
      password: "swordfish",
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const login = await loginViaRoute({
        email: firstUser.email,
        password: "wrong-password",
      });
      expect(login.status).toBe(403);
    }

    const firstUserRateLimited = await loginViaRoute({
      email: firstUser.email,
      password: "wrong-password",
    });
    expect(firstUserRateLimited.status).toBe(429);
    expect(firstUserRateLimited.response.headers.get("retry-after")).toBe("60");

    const secondUserUnaffected = await loginViaRoute({
      email: secondUser.email,
      password: "wrong-password",
    });
    expect(secondUserUnaffected.status).toBe(403);
    expect(secondUserUnaffected.response.headers.get("retry-after")).toBeNull();
    expect(secondUserUnaffected.body).toMatchObject({
      error: {
        code: "invalid_credentials",
      },
    });
  });

  it("creates invites with requested TTLs and rejects out-of-range TTLs", async () => {
    const user = await seedUser({
      email: "private-invites@example.com",
      slug: "private-invites-user",
      password: "swordfish",
    });

    const login = await loginViaRoute(user);
    expect(login.status).toBe(200);
    expect(login.body).not.toBeNull();
    const sessionId = login.body!.sessionId;

    const createdInvite = await createInviteViaRoute(sessionId, 2);
    expect(createdInvite.status).toBe(201);
    expect(createdInvite.body).not.toBeNull();
    expect(createdInvite.body!.inviteId).toMatch(/^inv_[0-9A-Za-z]{22}$/u);
    expect(createdInvite.body!.token).toMatch(/^[A-Za-z0-9_-]+$/u);

    const ttlMs = Date.parse(createdInvite.body!.expiresAt) - Date.parse(createdInvite.body!.createdAt);
    expect(ttlMs).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000 - 5_000);
    expect(ttlMs).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 5_000);

    const zeroTtl = await createInviteViaRoute(sessionId, 0);
    expect(zeroTtl.status).toBe(400);
    expect(zeroTtl.body).toMatchObject({
      error: {
        code: "invalid_invite_ttl",
      },
    });

    const excessiveTtl = await createInviteViaRoute(sessionId, MAX_INVITE_TTL_HOURS + 1);
    expect(excessiveTtl.status).toBe(400);
    expect(excessiveTtl.body).toMatchObject({
      error: {
        code: "invalid_invite_ttl",
      },
    });
  });

  it("accepts invites and rejects missing, used, and expired tokens", async () => {
    const inviter = await seedUser({
      email: "invite-flow@example.com",
      slug: "invite-flow-user",
      password: "swordfish",
    });

    const inviterLogin = await loginViaRoute(inviter);
    expect(inviterLogin.status).toBe(200);
    expect(inviterLogin.body).not.toBeNull();
    const inviterSessionId = inviterLogin.body!.sessionId;

    const acceptedInvite = await createInviteViaRoute(inviterSessionId);
    expect(acceptedInvite.status).toBe(201);
    expect(acceptedInvite.body).not.toBeNull();

    const accepted = await acceptInviteViaRoute({
      token: acceptedInvite.body!.token,
      email: "new-operator@example.com",
      displayName: "New Operator",
      slug: OwnerSlug.assertDecode("new-operator"),
      password: "correct horse battery staple",
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body).not.toBeNull();
    expect(accepted.body!.user.email).toBe("new-operator@example.com");
    expect(accepted.body!.user.slug).toBe("new-operator");
    expect(accepted.body!.inviteTtlSeconds).toBe(Number(env.INVITE_TTL_SECONDS));

    const reusedInvite = await acceptInviteViaRoute({
      token: acceptedInvite.body!.token,
      email: "reused-operator@example.com",
      displayName: "Reused Operator",
      slug: OwnerSlug.assertDecode("reused-operator"),
      password: "correct horse battery staple",
    });
    expect(reusedInvite.status).toBe(409);
    expect(reusedInvite.body).toMatchObject({
      error: {
        code: "invite_already_used",
      },
    });

    const missingInvite = await acceptInviteViaRoute({
      token: "missing-token",
      email: "missing-operator@example.com",
      displayName: "Missing Operator",
      slug: OwnerSlug.assertDecode("missing-operator"),
      password: "correct horse battery staple",
    });
    expect(missingInvite.status).toBe(404);
    expect(missingInvite.body).toMatchObject({
      error: {
        code: "invite_not_found",
      },
    });

    const expiredInvite = await createInviteViaRoute(inviterSessionId);
    expect(expiredInvite.status).toBe(201);
    expect(expiredInvite.body).not.toBeNull();

    const db = createD1Db(env.DB);
    await db
      .update(d1Schema.invites)
      .set({
        expiresAt: Date.now() - 1_000,
      })
      .where(eq(d1Schema.invites.id, expiredInvite.body!.inviteId));

    const expiredAcceptance = await acceptInviteViaRoute({
      token: expiredInvite.body!.token,
      email: "expired-operator@example.com",
      displayName: "Expired Operator",
      slug: OwnerSlug.assertDecode("expired-operator"),
      password: "correct horse battery staple",
    });
    expect(expiredAcceptance.status).toBe(410);
    expect(expiredAcceptance.body).toMatchObject({
      error: {
        code: "invite_expired",
      },
    });
  });

  it("rejects invite acceptance when the email or slug is already taken", async () => {
    const inviter = await seedUser({
      email: "invite-conflicts@example.com",
      slug: "invite-conflicts-user",
      password: "swordfish",
    });
    const existingEmailUser = await seedUser({
      email: "taken-email@example.com",
      slug: "taken-email-user",
      password: "swordfish",
    });
    const existingSlugUser = await seedUser({
      email: "taken-slug-existing@example.com",
      slug: "taken-slug-user",
      password: "swordfish",
    });

    const inviterLogin = await loginViaRoute(inviter);
    expect(inviterLogin.status).toBe(200);
    expect(inviterLogin.body).not.toBeNull();
    const inviterSessionId = inviterLogin.body!.sessionId;

    const emailConflictInvite = await createInviteViaRoute(inviterSessionId);
    expect(emailConflictInvite.status).toBe(201);
    expect(emailConflictInvite.body).not.toBeNull();

    const emailTaken = await acceptInviteViaRoute({
      token: emailConflictInvite.body!.token,
      email: existingEmailUser.email,
      displayName: "Email Taken",
      slug: OwnerSlug.assertDecode("fresh-slug"),
      password: "correct horse battery staple",
    });
    expect(emailTaken.status).toBe(409);
    expect(emailTaken.body).toMatchObject({
      error: {
        code: "email_taken",
      },
    });

    const slugConflictInvite = await createInviteViaRoute(inviterSessionId);
    expect(slugConflictInvite.status).toBe(201);
    expect(slugConflictInvite.body).not.toBeNull();

    const slugTaken = await acceptInviteViaRoute({
      token: slugConflictInvite.body!.token,
      email: "fresh-email@example.com",
      displayName: "Slug Taken",
      slug: existingSlugUser.slug,
      password: "correct horse battery staple",
    });
    expect(slugTaken.status).toBe(409);
    expect(slugTaken.body).toMatchObject({
      error: {
        code: "slug_taken",
      },
    });
  });

  it("rejects invite acceptance with server-side field validation before consuming the invite", async () => {
    const inviter = await seedUser({
      email: "invite-validation@example.com",
      slug: "invite-validation-user",
      password: "swordfish",
    });

    const inviterLogin = await loginViaRoute(inviter);
    expect(inviterLogin.status).toBe(200);
    expect(inviterLogin.body).not.toBeNull();
    const inviterSessionId = inviterLogin.body!.sessionId;

    const passwordValidationInvite = await createInviteViaRoute(inviterSessionId);
    expect(passwordValidationInvite.status).toBe(201);
    expect(passwordValidationInvite.body).not.toBeNull();

    const shortPassword = await acceptInviteViaRoute({
      token: passwordValidationInvite.body!.token,
      email: "short-password@example.com",
      displayName: "Short Password",
      slug: OwnerSlug.assertDecode("short-password"),
      password: "x".repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(shortPassword.status).toBe(400);
    expect(shortPassword.body).toMatchObject({
      error: {
        code: "invalid_password",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
    });

    const blankDisplayName = await acceptInviteViaRoute({
      token: passwordValidationInvite.body!.token,
      email: "blank-display@example.com",
      displayName: "   ",
      slug: OwnerSlug.assertDecode("blank-display"),
      password: "correct horse battery staple",
    });
    expect(blankDisplayName.status).toBe(400);
    expect(blankDisplayName.body).toMatchObject({
      error: {
        code: "invalid_request",
        message: "displayName cannot be empty.",
      },
    });

    const acceptedAfterValidationFailures = await acceptInviteViaRoute({
      token: passwordValidationInvite.body!.token,
      email: "accepted-after-validation@example.com",
      displayName: "Accepted After Validation",
      slug: OwnerSlug.assertDecode("accepted-after-validation"),
      password: "correct horse battery staple",
    });
    expect(acceptedAfterValidationFailures.status).toBe(201);
    expect(acceptedAfterValidationFailures.body).not.toBeNull();

    const emailValidationInvite = await createInviteViaRoute(inviterSessionId);
    expect(emailValidationInvite.status).toBe(201);
    expect(emailValidationInvite.body).not.toBeNull();

    const blankEmail = await acceptInviteViaRoute({
      token: emailValidationInvite.body!.token,
      email: "   ",
      displayName: "Blank Email",
      slug: OwnerSlug.assertDecode("blank-email"),
      password: "correct horse battery staple",
    });
    expect(blankEmail.status).toBe(400);
    expect(blankEmail.body).toMatchObject({
      error: {
        code: "invalid_request",
        message: "email cannot be empty.",
      },
    });
  });

  it("rate limits repeated invite acceptance attempts per token", async () => {
    const suffix = uniqueSuffix();
    const missingToken = `missing-token-${suffix}`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteAcceptance = await acceptInviteViaRoute({
        token: missingToken,
        email: `missing-operator-${attempt}-${suffix}@example.com`,
        displayName: `Missing Operator ${attempt}`,
        slug: OwnerSlug.assertDecode(`missing-operator-${attempt}-${suffix}`),
        password: "correct horse battery staple",
      });

      expect(inviteAcceptance.status).toBe(404);
      expect(inviteAcceptance.response.headers.get("retry-after")).toBeNull();
      expect(inviteAcceptance.body).toMatchObject({
        error: {
          code: "invite_not_found",
        },
      });
    }

    const rateLimited = await acceptInviteViaRoute({
      token: missingToken,
      email: `missing-operator-rate-limited-${suffix}@example.com`,
      displayName: "Missing Operator Rate Limited",
      slug: OwnerSlug.assertDecode(`missing-operator-rl-${suffix}`),
      password: "correct horse battery staple",
    });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.response.headers.get("retry-after")).toBe("60");
    expect(rateLimited.body).toMatchObject({
      error: {
        code: "rate_limited",
      },
    });
  });
});
