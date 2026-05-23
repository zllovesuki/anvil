# tessera integration plan for anvil

Status: proposed implementation plan. Saving this artifact is the only implementation step for the current session; code changes follow in a later task.
Scope: Phase 1 (hard cutover, non-destructive for legacy data) and Phase 2 (destructive cleanup after soak).

## 1. Correctness invariant

Every accepted tessera `sub` resolves to at most one non-disabled anvil user, every non-disabled anvil user has at most one bound `sub`, and verified-email collisions never silently reassign identity. D1 PRIMARY KEY on `tessera_identities.sub` and UNIQUE on `tessera_identities.user_id` are the race guard; D1 `batch()` is the atomic write boundary.

### State / transition matrix (callback, after openid-client validation succeeds)

| Case | sub bound? | claims.email vs user.email | user state | Writes | Outcome |
|---|---|---|---|---|---|
| A | yes | equal | not disabled | `tessera_identities.last_seen_at = now` | `signed_in` |
| B | yes | different, free | not disabled | `users.email`; `tessera_identities.last_seen_at = now` | `email_updated` |
| C | yes | different, collides another user | not disabled | none | fail `tessera_email_conflict` |
| D | yes | any | `disabledAt` set | none | fail `user_disabled` |
| E | no | matches unbound user | not disabled | INSERT `tessera_identities` (`created_at = now`, `last_seen_at = now`); UNIQUE re-check | `bound_legacy` or `identity_conflict` |
| F | no | matches user already bound to another sub | not disabled | none | fail `identity_conflict` |
| G | no | matches a disabled user | disabled | none | fail `user_disabled` |
| H | no | no user match | n/a | `db.batch([INSERT users, INSERT tessera_identities])` with `created_at = now`, `last_seen_at = now` on identity | `created` |
| I | no | no user match, race on sub | n/a | UNIQUE on sub fires; recheck classifies | `raced_to_existing` or `identity_conflict` |

Pre-callback validation failures (no sub, no email, `email_verified=false`, expired/tampered tx cookie, state mismatch, openid-client throw) redirect with `oidc_unverified_email`, `oidc_session_expired`, or `oidc_provider_error` codes. No DB writes on any failure path.

Use Drizzle `.returning()` on insert/update to avoid a second SELECT in the happy path; re-query only after UNIQUE-constraint races to classify the outcome.

### Slug generation for Case H

When auto-provisioning a new user, build `users.slug` from the first non-empty claim source in this order: `preferred_username`, the email local part (the substring before `@`), then `name`. Lowercase the candidate and replace every character outside `/[A-Za-z0-9_-]/` with `-`, collapse repeated `-`, and strip leading/trailing `-`, so the result passes the `OwnerSlug` codec (`/^[A-Za-z0-9_-]+$/u`). If the cleaned candidate is empty, fall back to `usr-<last-6-of-generated-usr-id>`. On `idx_users_slug` UNIQUE collision, retry with the suffix `-<last-6-of-generated-usr-id>` for up to 3 attempts; if collision still persists, fail closed with `identity_conflict`. The chosen slug is externally visible via `/api/public/hooks/:provider/:ownerSlug/:projectSlug` and must remain stable for the user's lifetime.

## 2. Phase split

### Phase 1 (this PR): hard auth cutover, non-destructive for legacy data

- Add `tessera_identities` table.
- Add `GET /api/public/oidc/start` and `GET /api/public/oidc/callback`. Both handlers call `enforcePublicOidcRateLimit(c)` (keyed on `cf-connecting-ip`) before doing any work.
- Move auth transport from `Authorization: Bearer` to `__Host-anvil_session` HttpOnly cookie.
- Add same-origin Origin guard for unsafe-method private routes and cookie-bound logout.
- Remove from active worker exports/routes: password login, accept-invite acceptance, and invite creation. Specifically: drop `POST /api/public/auth/login`, `POST /api/public/auth/invite/accept`, `POST /api/private/invites` from the routers, and delete their handlers along with `src/worker/auth/passwords.ts`, `src/worker/auth/headers.ts`, `src/worker/db/d1/repositories/password-credentials.ts`, `src/worker/db/d1/repositories/invites.ts`, and `src/worker/api/private/invites.ts`.
- Remove Turnstile UI/widget, server verification, CSP allowances, env vars, dependency, and tests.
- Remove the SPA mock-auth surface entirely (mock-api, mock state, AuthMode toggle).
- Rename rate-limit binding to `PUBLIC_OIDC_RATE_LIMITER`; drop the two old bindings.
- Active contract changes: `PublicAppConfigResponse` loses `turnstileSiteKey`; `GetMeResponse` loses `inviteTtlSeconds`.
- Dormant rollback surface retained in Phase 1: `password_credentials` and `invites` schema files under `src/worker/db/d1/schema/`, the D1 tables themselves, `scripts/seed-bootstrap-invite.ts`, and the password/invite request/response/codec exports in `src/contracts/auth.ts`. These are unreachable from active code; reverting the PR restores the routes and reuses the live data.
- Dependencies: remove `@marsidev/react-turnstile`; add `openid-client` to dependencies; add `@mongodb-js/oidc-mock-provider` to devDependencies.

### Phase 2 (later, after soak): destructive cleanup

- Drop `password_credentials` and `invites` tables (new D1 migration after deleting their schema files).
- Delete `scripts/seed-bootstrap-invite.ts` and the `db:seed-initial-user` npm script.
- Delete dormant password/invite request/response/codec exports from `src/contracts/auth.ts` (`LoginRequest`, `LoginResponse`, `AcceptInviteRequest`, `CreateInviteRequest`, `CreateInviteResponse`, `InviteTtlSeconds`, `MIN_PASSWORD_LENGTH`, `MIN_INVITE_TTL_HOURS`, `MAX_INVITE_TTL_HOURS`).
- Remove `PASSWORD_PBKDF2_DIGEST`, `PASSWORD_PBKDF2_ITERATIONS`, `INVITE_TTL_SECONDS`, `INVITE_TOKEN_BYTES` from `wrangler.jsonc` vars.
- Decide whether `PUBLIC_OIDC_RATE_LIMITER` stays or is replaced by a tighter scheme.

## 3. Schema changes (Phase 1)

New Drizzle table at `src/worker/db/d1/schema/tessera-identities.ts`:

```ts
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/worker/db/d1/schema/users";

export const tesseraIdentities = sqliteTable(
  "tessera_identities",
  {
    sub: text("sub").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at"),
  },
  (table) => [uniqueIndex("idx_tessera_identities_user_id").on(table.userId)],
);
```

Export added to `src/worker/db/d1/schema/index.ts`. Integer ms timestamps match anvil's existing `users.createdAt` / `users.disabledAt` convention; deviates from bland's ISO text deliberately.

Existing `password_credentials` and `invites` schema files are NOT touched in Phase 1 so drizzle does not emit a DROP TABLE migration.

## 4. File and module touchpoints

### Worker, additions

- `src/worker/db/d1/schema/tessera-identities.ts` (new).
- `src/worker/db/d1/repositories/tessera-identities.ts` (new) -- `findIdentityBySub`, `findUserIdBySub`, `bumpLastSeenAt`, `insertIdentity`.
- `src/worker/auth/oidc.ts` (new) -- OIDC config validation, loopback HTTP allowance, discovery cache, tx-cookie HKDF sign/verify (key derived from `TESSERA_OIDC_CLIENT_SECRET` via HKDF-SHA-256 with a fixed info string `anvil-oidc-transaction-v1`; no new secret introduced), `validateClaims`, `sanitizeReturnTo`, `appendOidcMarker`, `oidcErrorContext`, and a file-scoped `__test` namespace for unit-test injection (mirror bland's shape).
- `src/worker/api/public/oidc.ts` (new) -- `handleOidcStart`, `handleOidcCallback`, internal `bindIdentity` that implements the state/transition matrix, and a `generateUserSlug(claims, attempt)` helper that returns an `OwnerSlug`-conforming candidate built from `preferred_username` / email-local / name with a `-<usr-suffix-6>` collision fallback (max 3 retries) per Section 1's slug rule. Both handlers call `enforcePublicOidcRateLimit(c)` as the first step.
- `src/worker/auth/cookies.ts` (new) -- `setSessionCookie`, `clearSessionCookie`, `readSessionCookie`. Hono `setCookie`/`deleteCookie`/`getCookie`. Cookie name `__Host-anvil_session`, options `{ path: "/", httpOnly: true, secure: true, sameSite: "Lax", maxAge: AUTH_SESSION_TTL_SECONDS }`. Browsers accept Secure cookies on `http://localhost`, so no localhost branch is needed.
- `src/worker/security/same-origin.ts` (new) -- `requireSameOrigin` middleware. Skips safe methods; for unsafe methods requires `Origin` equal to request origin, else `Sec-Fetch-Site` in `{same-origin, none}`. Rejects with 403 `cross_origin_blocked` otherwise.
- `src/worker/security/rate-limit.ts` -- replace login/invite helpers with `enforcePublicOidcRateLimit(c)` keyed on `cf-connecting-ip`.

### Worker, modifications

- `src/worker/auth/middleware.ts` -- read `__Host-anvil_session` instead of bearer; on `invalid_session`, clear the cookie. `maybeRefreshSession` callers re-set the cookie when the KV record refreshes (cookie max-age tracks the KV TTL).
- `src/worker/auth/index.ts` -- drop the `headers` and `passwords` re-exports.
- `src/worker/api/public/router.ts` -- remove `auth/login`, `auth/invite/accept`; add `oidc/start`, `oidc/callback`; keep `auth/logout` with cookie-read, same-origin guard, and 204 on missing session.
- `src/worker/api/private/router.ts` -- remove `POST /invites` route. Apply `requireSameOrigin` middleware on unsafe-method routes: `POST /runs/:runId/cancel`, `POST /runs/:runId/log-ticket`, `POST /projects`, `PATCH /projects/:projectId`, `PUT/POST/DELETE` webhook subroutes, `POST /projects/:projectId/runs`. Skip guard on `GET /runs/:runId/logs` WebSocket upgrade.
- `src/worker/router.ts` -- drop the Turnstile origin from CSP `script-src`, `connect-src`, `frame-src`. Keep ws/wss `connect-src`.
- `src/worker/api/public/auth.ts` -- delete `handleLogin` and `handleInviteAccept`. Reshape `handleLogout` to read cookie, delete KV session, clear cookie, 204.
- `src/worker/api/private/invites.ts` -- delete file (route removed).
- `src/worker/api/public/app-config.ts` -- drop `turnstileSiteKey` from response.
- `src/worker/api/private/me.ts` -- drop `inviteTtlSeconds` from response.
- `src/worker/services/turnstile.ts` -- delete; remove from `src/worker/services/index.ts`.
- `src/worker/config.ts` -- drop `inviteTtlSeconds`, drop turnstile config.
- `wrangler.jsonc` -- `vars`: add `TESSERA_OIDC_ISSUER` (placeholder for prod). `ratelimits`: drop the two old bindings, add `PUBLIC_OIDC_RATE_LIMITER` (limit 20 / period 60, new namespace id). Secrets required: `TESSERA_OIDC_CLIENT_ID` and `TESSERA_OIDC_CLIENT_SECRET` (both held as secrets to keep registered RP client IDs out of committed config). Existing `TURNSTILE_*` secrets are unset at deploy.
- `.dev.vars.example` -- remove `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`; add local placeholders for `TESSERA_OIDC_ISSUER`, `TESSERA_OIDC_CLIENT_ID`, and `TESSERA_OIDC_CLIENT_SECRET`. `wrangler types --env-file .dev.vars.example` (via `npm run types:generate`) regenerates `worker-configuration.d.ts` from this file, so it must list every secret/var the Env type requires.
- `worker-configuration.d.ts` -- regenerate via `npm run types:generate` after `wrangler.jsonc` and `.dev.vars.example` edits.

### Client, modifications

- `src/client/pages/login-page.tsx` -- replace form with a "Sign in with tessera" button that does `window.location.assign("/api/public/oidc/start?return_to=" + encodeURIComponent(returnTo))`. Read `?error=...` and render the matching message. Drop password fields, mock-mode toggle, Turnstile widget.
- `src/client/pages/accept-invite-page.tsx` -- delete. Remove the `/app/invite/accept` route from `src/client/app.tsx`.
- `src/client/components/turnstile-challenge.tsx`, `src/client/components/turnstile-widget.tsx` -- delete. Remove from `src/client/components/index.ts`.
- `src/client/components/invite-dialog.tsx` -- delete.
- `src/client/components/app-shell.tsx` -- remove the `InviteDialog` import, the `inviteOpen` state, and the rendered dialog.
- `src/client/components/header.tsx`, `src/client/components/user-menu.tsx` -- drop `AuthMode` props/imports, the mode toggle, and any "Mint invite" affordance.
- `src/client/auth/auth-provider.tsx` -- drop `signIn(LoginRequest)`, `loginDirect`, mock/live toggle, sessionId storage. On mount, call `/api/private/me`; 403 means unauthenticated. Sign-out hits `POST /api/public/auth/logout` (cookie attached automatically). `SESSION_EXPIRED_EVENT` still fires from live-api-request.
- `src/client/auth/auth-context.ts` -- shrink to `user`, `isAuthenticated`, `isInitializing`, `startupError`, `signOut`.
- `src/client/lib/storage.ts` -- delete sessionId helpers and the AuthMode toggle. Keep D1 bookmark helpers.
- `src/client/lib/live-api-request.ts` -- drop `Authorization` header injection; set `credentials: "same-origin"` on the fetch options.
- `src/client/lib/mock-api.ts`, `src/client/lib/mock/*` -- delete entirely. `src/client/lib/api.ts` collapses to the live client.
- `src/client/lib/api-contract.ts` -- remove `login`, `acceptInvite`, and `createInvite` from the interface, plus the now-unused `LoginResponse` / `CreateInviteResponse` imports.
- `src/client/lib/live-api.ts` -- delete the concrete `login`, `acceptInvite`, and `createInvite` implementations and their contract imports.
- `src/client/lib/query-keys.ts` -- drop the `mode: AuthMode` discriminator from every query key and update call sites to invoke the keys without the mode argument.
- `src/client/pages/landing-page.tsx` -- replace accept-invite CTAs and invite-only copy with tessera sign-in messaging.
- `src/client/pages/profile-page.tsx` -- remove the `AuthMode` ModeToggle and the bearer-session description; reword to "Session is HttpOnly cookie via tessera OIDC."
- `src/client/pages/run-detail-page.tsx`, `src/client/pages/project-settings-page.tsx` -- drop `AuthMode` type usage from component props and imports.

### Shared contracts

Phase 1 leaves dormant password/invite request/response exports (`LoginRequest`, `LoginResponse`, `AcceptInviteRequest`, `CreateInviteRequest`, `CreateInviteResponse`, `InviteTtlSeconds`, `MIN_PASSWORD_LENGTH`, `MIN_INVITE_TTL_HOURS`, `MAX_INVITE_TTL_HOURS`) in `src/contracts/auth.ts` unchanged for rollback. Active contracts change: `PublicAppConfigResponse` drops `turnstileSiteKey`; `GetMeResponse` drops `inviteTtlSeconds`. Phase 2 removes the dormant exports.

## 5. Dependency changes

Install with `--ignore-scripts` per anvil convention:

```
npm install --ignore-scripts openid-client
npm install --ignore-scripts --save-dev @mongodb-js/oidc-mock-provider
npm uninstall --ignore-scripts @marsidev/react-turnstile
```

Pin to `openid-client` ^6.x and `@mongodb-js/oidc-mock-provider` ^0.13.x, matching bland. Lockfile is committed.

## 6. Migration generation

D1 schema only changes in Phase 1, so use the narrow generator:

```
npm run db:generate:d1
```

Confirm the produced file under `drizzle/d1/` adds `tessera_identities` with PK on `sub`, FK `user_id -> users(id) ON DELETE CASCADE`, and unique index `idx_tessera_identities_user_id`. Commit the generated file unedited.

Apply locally:

```
npm run db:migrate:local
```

Production apply happens through `npm run deploy` per existing workflow.

## 7. Test plan

### Worker unit tests (new, in `tests/worker/`)

- `auth/oidc-config.test.ts`: `validateIssuerUrl` accepts https, rejects unknown protocols, accepts http only on loopback; missing env throws.
- `auth/oidc-tx-cookie.test.ts`: encode/decode round-trip, expired payload rejected, tampered payload rejected, wrong-secret payload rejected. Asserts HKDF key is derived from `TESSERA_OIDC_CLIENT_SECRET`.
- `auth/oidc-claims.test.ts`: missing `sub`/`email` rejected, `email_verified=false` rejected, name/preferred_username/email-local fallback for display name, slug normalization passes `OwnerSlug` codec.
- `security/same-origin.test.ts`: POST without `Origin` and without `Sec-Fetch-Site` fails; same-origin `Origin` passes; cross-origin `Origin` fails; GET always passes; `Sec-Fetch-Site: none` passes.

### Worker route tests (new, `tests/worker/routes/oidc.test.ts`)

Use a file-scoped `__test.setAuthorizationCodeGrantImpl` to inject claims. Prove each matrix cell:

- A: existing sub, same email -> `signed_in`, sets `__Host-anvil_session`, redirects to returnTo.
- B: existing sub, new free email -> `email_updated`.
- C: existing sub, colliding email -> `tessera_email_conflict`, no email change.
- D: existing sub, disabled user -> `user_disabled`.
- E (success): new sub, legacy user by email -> `bound_legacy`, identity inserted, no users row created.
- E (race): two parallel callbacks for same sub onto same legacy user -> one wins, the other classified `bound_legacy` via recheck.
- F: new sub, target email belongs to user already bound to another sub -> `identity_conflict`.
- G: new sub, target email belongs to disabled user -> `user_disabled`.
- H: new sub, no matching user -> `created`; `users` row id matches `^usr_[0-9A-Za-z]{22}$`, `slug` passes `OwnerSlug`, `tessera_identities.created_at` and `last_seen_at` both set.
- H (slug collision fallback): seed an existing user holding the slug the OIDC claims would resolve to; the callback completes with the `-<usr-suffix-6>` fallback slug, the row writes successfully, and the test asserts the fallback shape (not just that the final slug passes the codec).
- H (slug empty source): claims with no `preferred_username`, no `name`, and an unrouteable email local part fall back to `usr-<usr-suffix-6>` and still produce a valid `OwnerSlug`.
- I: race on sub during auto-provision -> `raced_to_existing` or `identity_conflict`.
- Negative: missing tx cookie, tampered tx cookie, state mismatch, openid-client throw all redirect to `/app/login?error=<code>` with no DB writes.
- Start: redirects to discovered authorization URL with `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`; sets `__Host-anvil_oidc_tx`; `return_to` is sanitized by `sanitizeReturnTo`.
- Rate limit: start and callback both call `enforcePublicOidcRateLimit(c)` and respond with the standard 429 + `Retry-After: 60` when over the IP budget.

### Schema tests (extend `tests/worker/structure.test.ts`)

- duplicate `sub` insert rejected by PK.
- duplicate `user_id` insert rejected by unique index.
- delete users row cascades to `tessera_identities`.

### Same-origin guard in existing route tests

- Add `Origin` header to private-route helpers; verify unsafe-method routes reject missing-Origin requests with 403 `cross_origin_blocked`.

### Existing worker test reshape

- `tests/helpers/runtime.ts` -- `authHeaders(sessionId)` switches from `Authorization: Bearer ...` to `cookie: __Host-anvil_session=...`. `loginViaRoute` deleted; new `mintCookieAuth(env, userId)` mints a session directly via `createSession` and returns cookie + same-origin headers.
- `tests/worker/routes/public-auth-and-invites.test.ts` -- drop password/invite-acceptance assertions; replace with smoke check that `auth/login`, `auth/invite/accept`, and `private/invites` are 404 after removal.
- `tests/worker/services/turnstile.test.ts` -- delete.
- `tests/worker/routes/auth-and-validation.test.ts` -- drop bearer-specific assertions; add cookie + missing-Origin equivalents on a representative private route.

### Browser e2e

- `tests/e2e/global-setup.ts` -- start `OIDCMockProvider` on a dynamically allocated loopback port (do not pass `port`; use `provider.issuer` from the returned object, matching bland). Inject `TESSERA_OIDC_ISSUER=<provider.issuer>`, `TESSERA_OIDC_CLIENT_ID=anvil-e2e`, `TESSERA_OIDC_CLIENT_SECRET=anvil-e2e-tessera-secret` into the dev-server env before `startDevServer`. Drop the bootstrap invite seed.
- `tests/e2e/fixtures/anvil-test.ts` -- drop the live mode addInitScript and Turnstile stub. Add an `oidcMock` fixture exposing `setNextIdentity({ sub, email, name? })`.
- Replace `01-bootstrap-and-login.spec.ts` with `01-oidc-sign-in.spec.ts`: navigates to `/`, clicks Sign in, mock provider returns baseline claims, lands on `/app/projects`. Asserts `__Host-anvil_session` cookie is `HttpOnly` and `Secure`.
- Replace `02-return-login.spec.ts` with `02-oidc-returning-user.spec.ts`: pre-seeded `tessera_identities` row, complete callback, no new user row created.
- Keep `03-project-crud.spec.ts`, `04-profile-and-signout.spec.ts`, `05-auth-guards.spec.ts` with auth helpers updated to use the OIDC flow once before exercising the page.

### Integration tests

- `tests/integration/queue-runner/harness.ts` -- replace the bootstrap-invite seed and invite-accept HTTP flow with an `oidcSignInOnce(ctx)` helper that drives the mock-provider authorization endpoint with PKCE/state/nonce and walks the resulting `__Host-anvil_session` cookie back. Reuse the cookie for the rest of the run-execution assertions.
- `tests/integration/queue-runner-happy-path.test.ts` and `workflows-runner-happy-path.test.ts` -- switch to `oidcSignInOnce`; do not duplicate OIDC matrix coverage here.

### Typecheck

`npx tsc -p tests/tsconfig.json --noEmit` and `npm run typecheck` both clean.

## 8. Rollout and rollback

### Rollout sequence

1. Land tessera, register anvil RP at tessera `/admin/clients`, capture client id + secret.
2. Set `TESSERA_OIDC_ISSUER` var and `TESSERA_OIDC_CLIENT_ID` / `TESSERA_OIDC_CLIENT_SECRET` secrets in Cloudflare. Deploy this PR. `password_credentials` and `invites` tables remain populated; their HTTP routes are removed.
3. Operators sign in via OIDC. First-time logins that match an existing email insert `tessera_identities` rows (Case E).
4. Monitor `oidc_callback_success` / `oidc_callback_failed` logs. Treat persistent `identity_conflict` rate as a Phase-1 blocker.
5. After a soak window (operator decides; typical 1-2 weeks), Phase 2 PR drops the tables, dormant contracts, and bootstrap script.

### Rollback (Phase 1 only)

Phase 1 is reversible by reverting the PR. The `password_credentials` and `invites` tables still exist with original data, and `tessera_identities` rows do not interfere with reverted code paths (they sit unused on the dropped schema). The bootstrap-invite seeder is still on disk. Caveat: any user that auto-provisioned (Case H) has no password row, so after rollback they must be granted access via a fresh invite + password.

### Production secret + var configuration

| Name | Type | Phase 1 | Phase 2 |
|---|---|---|---|
| `TESSERA_OIDC_ISSUER` | var | required | required |
| `TESSERA_OIDC_CLIENT_ID` | secret | required | required |
| `TESSERA_OIDC_CLIENT_SECRET` | secret | required | required |
| `TURNSTILE_SITE_KEY` | secret | delete | n/a |
| `TURNSTILE_SECRET_KEY` | secret | delete | n/a |
| `PASSWORD_PBKDF2_DIGEST` | var | keep (dormant) | delete |
| `PASSWORD_PBKDF2_ITERATIONS` | var | keep (dormant) | delete |
| `INVITE_TTL_SECONDS` | var | keep (dormant) | delete |
| `INVITE_TOKEN_BYTES` | var | keep (dormant) | delete |

## 9. Non-goals and explicit acceptances

- Anvil no longer gates registration; tessera is the gate. Auto-provision on first OIDC sign-in is intentional.
- No MFA, password recovery, or SAML in anvil. Tessera owns those.
- Mock auth mode in the SPA is removed entirely in Phase 1; local dev exercises the OIDC mock provider in e2e and real tessera elsewhere.
- D1 bookmark header remains a custom header (`x-anvil-d1-bookmark`); it is not auth and does not move to a cookie.
- `TESSERA_OIDC_CLIENT_ID` is held as a secret rather than a var so registered RP client IDs do not appear in committed `wrangler.jsonc`.

## 10. Open follow-ups (not Phase 1)

- Retention policy for `tessera_identities.last_seen_at` (e.g., inactive-account reporting).
- Whether to expose a "view linked identity" surface in the profile page.
- Whether to rotate `__Host-anvil_session` on privilege change once anvil grows role/permission concepts.
