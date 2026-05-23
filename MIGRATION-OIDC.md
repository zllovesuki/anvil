# OIDC Migration Guide

Operator runbook for upgrading an existing anvil deployment from legacy invite/password sign-in to tessera OIDC browser sign-in.

Status: proposed migration guide for the OIDC cutover represented by:

- `400d497` - `feat(auth): migrate sign-in to tessera OIDC`
- `65340ff` - `chore(auth): remove legacy invite and password auth`

This guide is for existing deployments. Fresh deployments can start from latest `main` after configuring tessera OIDC and applying D1 migrations.

The implementation and environment variable names say `TESSERA_*` because anvil uses tessera as its OIDC provider. Another OIDC provider can work if it satisfies the provider contract below, but access policy should be enforced at that provider because anvil auto-provisions users from accepted verified OIDC identities.

## What Changes

The post-migration auth model is:

- Browser sign-in starts at `/api/public/oidc/start` and returns through `/api/public/oidc/callback`.
- OIDC uses authorization code + PKCE, nonce, state, and a short-lived signed `__Host-anvil_oidc_tx` transaction cookie.
- anvil stores the browser session id in a Secure HttpOnly `__Host-anvil_session` cookie.
- Private unsafe-method routes require same-origin request headers because sessions are now cookie-bound.
- D1 stores OIDC bindings in `tessera_identities`.
- Legacy password credentials and invite tokens are removed after the closure phase.

Legacy routes removed by this migration:

- `POST /api/public/auth/login`
- `POST /api/public/auth/invite/accept`
- `POST /api/private/invites`

Existing bearer-token browser sessions do not carry forward. Users must sign in again through tessera after the phase 1 deploy.

## Upgrade Path By Starting Version

| Starting point        | Required path                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Before `400d497`      | Deploy `400d497` first, configure OIDC, apply D1 migration `0001`, validate sign-in and identity binding, then deploy `65340ff` or latest. |
| At `400d497`          | Validate OIDC for every active operator, then deploy `65340ff` or latest to drop legacy tables.                                            |
| At `65340ff` or newer | You are on the closed OIDC model. Confirm OIDC secrets, D1 migrations, and user bindings.                                                  |
| Fresh deployment      | Deploy latest directly. Configure tessera, apply migrations, then sign in to create the first user.                                        |

Do not skip the phase 1 validation gate on an existing deployment unless you have a tested D1 backup and every active user can authenticate through tessera with the expected verified email address. Latest `main` no longer contains the legacy invite/password rollback surface.

## Prerequisites

1. Back up D1 before touching production.

   ```bash
   npx wrangler d1 export anvil-db --remote --output ./anvil-db-before-oidc.sql
   ```

2. Register an anvil OIDC client in tessera.

   Production callback URL:

   ```text
   https://<anvil-hostname>/api/public/oidc/callback
   ```

   Local callback URL, if needed:

   ```text
   http://127.0.0.1:<port>/api/public/oidc/callback
   ```

3. Confirm the provider contract.

   The provider must expose standard OIDC discovery, support authorization code + PKCE S256, accept confidential-client token exchange with client secret post, return signed ID tokens, and emit a stable opaque `sub`, `email`, and `email_verified=true`.

   `preferred_username` and `name` are optional. They only affect display-name and slug generation for newly auto-provisioned users.

4. Restrict provider access to the people who should be able to create an anvil account.

   anvil does not maintain a separate invite gate after this migration. Any accepted OIDC identity with a verified email can sign in and create an anvil user unless the account is later disabled in D1.

5. Check existing anvil users and their email addresses.

   ```bash
   npx wrangler d1 execute anvil-db --remote --command 'select id, slug, email, disabled_at from users order by created_at;'
   ```

   First OIDC sign-in binds an existing unbound user by verified email. If tessera returns a different email, anvil may update the existing bound user's email only when the new email is not owned by another user. Collisions fail closed.

## Configure Cloudflare

Set the issuer as non-secret configuration:

```text
TESSERA_OIDC_ISSUER=https://<tessera-hostname>
```

Set the OIDC client credentials as Worker secrets:

```bash
npx wrangler secret put TESSERA_OIDC_CLIENT_ID
npx wrangler secret put TESSERA_OIDC_CLIENT_SECRET
```

Keep the existing production encryption secrets:

- `APP_ENCRYPTION_KEY_CURRENT_VERSION`
- `APP_ENCRYPTION_KEYS_JSON`

The OIDC migration does not rotate repository-token or webhook-secret encryption keys.

Turnstile configuration, invite TTL configuration, password PBKDF2 configuration, and legacy login/invite rate-limit bindings are not used after phase 1.

## Phase 1: Reversible OIDC Cutover (`400d497`)

Phase 1 adds OIDC sign-in and the `tessera_identities` table while keeping the old `password_credentials` and `invites` D1 tables intact. The old HTTP routes are removed from active code, but the D1 data remains available if you roll back by redeploying the previous password/invite build.

### Procedure

```bash
git checkout 400d497
npm ci --ignore-scripts
npx wrangler d1 export anvil-db --remote --output ./anvil-db-before-oidc-phase1.sql
npm run db:migrate:d1
npm run build
npx wrangler deploy
```

Open `/app/login`, click "Sign in with tessera", and complete the provider flow.

### Phase 1 Validation

- [ ] `/app/login` renders the tessera sign-in button.
- [ ] OIDC start redirects to the tessera authorization endpoint.
- [ ] OIDC callback returns to `/app/projects?oidc=1` or the sanitized `return_to` path.
- [ ] The browser has a Secure HttpOnly `__Host-anvil_session` cookie.
- [ ] `/api/private/me` succeeds after sign-in.
- [ ] A `tessera_identities` row exists for each active operator who signed in.
- [ ] Existing projects are still visible to the same users.
- [ ] Creating, updating, and deleting projects still works from the UI.
- [ ] Triggering a run still works for the dispatch mode you use in production.
- [ ] Worker logs show `oidc_callback_success` and no persistent `identity_conflict`, `tessera_email_conflict`, or `user_disabled` failures.

Useful D1 checks:

```bash
npx wrangler d1 execute anvil-db --remote --command 'select sub, user_id, created_at, last_seen_at from tessera_identities order by created_at;'
npx wrangler d1 execute anvil-db --remote --command 'select id, slug, email, disabled_at from users order by created_at;'
```

### Phase 1 Recovery

If OIDC discovery fails, confirm `TESSERA_OIDC_ISSUER` has no query, fragment, or credentials and that non-loopback issuers use `https`.

If callback fails with `oidc_unverified_email`, the provider did not return `email_verified=true` with an email address.

If callback fails with `identity_conflict` or `tessera_email_conflict`, inspect the `users` and `tessera_identities` rows before retrying. Do not manually reassign a `sub` without confirming the provider identity.

Phase 1 rollback is a normal redeploy rollback to the previous password/invite build. The added `tessera_identities` table is ignored by old code. If you removed old Turnstile secrets or bindings from the deployment environment, restore them before rolling back to the pre-OIDC build.

## Phase 2: Legacy Auth Closure (`65340ff`)

Phase 2 removes the remaining legacy auth surface:

- Drops D1 tables `invites` and `password_credentials` with migration `0002_tearful_toro.sql`.
- Deletes the bootstrap invite seeder and `db:seed-initial-user` script.
- Removes dormant password/invite contract exports.
- Removes obsolete password, invite, Turnstile, and WAF references from operator docs.

Only proceed after phase 1 validation passes for every active operator.

### Procedure

```bash
git checkout 65340ff
npm ci --ignore-scripts
npx wrangler d1 export anvil-db --remote --output ./anvil-db-before-oidc-closure.sql
npm run db:migrate:d1
npm run build
npx wrangler deploy
```

After validating `65340ff`, you can return to the target branch and deploy normally:

```bash
git checkout main
npm ci --ignore-scripts
npm run db:migrate:d1
npm run build
npx wrangler deploy
```

### Phase 2 Validation

- [ ] `invites` and `password_credentials` are absent from D1.
- [ ] `/api/public/auth/login` returns 404.
- [ ] `/api/public/auth/invite/accept` returns 404.
- [ ] `/api/private/invites` returns 404 for an authenticated user.
- [ ] OIDC sign-in still works for an existing bound user.
- [ ] OIDC sign-in creates a new user only when intended.
- [ ] Sign-out clears the `__Host-anvil_session` cookie.
- [ ] Private unsafe-method requests without same-origin headers fail with `403 cross_origin_blocked`.
- [ ] Worker logs show no unexpected OIDC callback failures.

Example table check:

```bash
npx wrangler d1 execute anvil-db --remote --command "select name from sqlite_master where type = 'table' and name in ('invites', 'password_credentials', 'tessera_identities') order by name;"
```

Expected result after phase 2: only `tessera_identities`.

## Identity Binding Rules

anvil accepts only OIDC claims with:

- non-empty `sub`
- non-empty `email`
- `email_verified=true`

Callback binding behavior:

| Case                                                           | Result                                         |
| -------------------------------------------------------------- | ---------------------------------------------- |
| Existing `sub`, same email, active user                        | Session created; `last_seen_at` updated.       |
| Existing `sub`, changed email, email is free                   | User email updated; session created.           |
| Existing `sub`, changed email, email belongs to another user   | Fails with `tessera_email_conflict`.           |
| Existing `sub`, disabled user                                  | Fails with `user_disabled`.                    |
| New `sub`, email matches an unbound active user                | Inserts `tessera_identities`; session created. |
| New `sub`, email matches a user already bound to another `sub` | Fails with `identity_conflict`.                |
| New `sub`, email matches a disabled user                       | Fails with `user_disabled`.                    |
| New `sub`, no matching user                                    | Creates a user and identity binding.           |

For new users, slug candidates are tried in this order:

1. `preferred_username`
2. email local part
3. `name`
4. `usr-<user-id-suffix>` fallback

The slug is lowercased, normalized to the `OwnerSlug` character set, and retried with a `-<user-id-suffix>` suffix on slug collision.

## Rollback Posture

Before phase 2, rollback to the pre-OIDC password/invite build is available because the legacy D1 tables still exist.

After phase 2, rollback to legacy password/invite auth requires restoring D1 from a backup that still contains `invites` and `password_credentials`. Treat post-closure auth failures as forward-fix unless you have a deliberate database restore plan.

Users auto-provisioned by OIDC have no legacy password row. If you roll back to the pre-OIDC auth model, those users cannot sign in until you create a legacy invite/password path for them or restore a database state that contains one.

## Useful Validation Commands

Run the fast worker suite:

```bash
npm test
```

Run OIDC-focused worker tests:

```bash
npx vitest run tests/worker/auth/oidc.test.ts tests/worker/routes/oidc.test.ts
```

Run browser auth coverage when validating the local app:

```bash
npm run test:e2e -- tests/e2e/specs/01-oidc-sign-in.spec.ts tests/e2e/specs/02-oidc-returning-user.spec.ts
```

Run the expensive live execution checks sequentially when the migration also needs run-path confidence:

```bash
npm run test:integration:queue
npm run test:integration:workflows
```
