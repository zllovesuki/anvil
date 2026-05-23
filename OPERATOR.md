# Operating anvil

Detailed setup, deployment, and operational reference. For the quick start, see [README.md](README.md).

## Prerequisites

- Node.js 20+
- npm
- A Cloudflare account with a [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/) for container-backed run execution
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) — available via `npx wrangler` after `npm install`

D1, Queues, Workflows, KV, and SQLite-backed Durable Objects are available on Workers Free or Paid with different limits. Container execution requires Workers Paid.

## Environment variables

Copy `.dev.vars.example` to `.dev.vars` for local development:

```bash
cp .dev.vars.example .dev.vars
```

| Variable                             | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `APP_ENCRYPTION_KEY_CURRENT_VERSION` | Active key version for credential encryption |
| `APP_ENCRYPTION_KEYS_JSON`           | JSON map of version → base64 AES-GCM key     |
| `TESSERA_OIDC_ISSUER`                | tessera OIDC issuer URL                      |
| `TESSERA_OIDC_CLIENT_ID`             | anvil OIDC relying-party client ID           |
| `TESSERA_OIDC_CLIENT_SECRET`         | anvil OIDC relying-party client secret       |

For production, generate a fresh encryption key. The example key is for local development only and must never be reused in a remote Cloudflare environment.

Store production encryption and tessera client credentials as Worker secrets, not plaintext `vars` in `wrangler.jsonc`. `TESSERA_OIDC_ISSUER` is non-secret configuration and can remain a Wrangler var.

### Production encryption setup

Generate a fresh 32-byte base64 key:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

For a brand-new deployment, start with key version `1`:

```text
APP_ENCRYPTION_KEY_CURRENT_VERSION=1
APP_ENCRYPTION_KEYS_JSON={"1":"<generated-base64-key>"}
```

Set both values with Wrangler:

```bash
npx wrangler secret put APP_ENCRYPTION_KEY_CURRENT_VERSION
npx wrangler secret put APP_ENCRYPTION_KEYS_JSON
```

When prompted, enter these values:

```text
1
{"1":"<generated-base64-key>"}
```

If you later deploy a named Wrangler environment, repeat those secret commands with `--env <name>`. Worker secrets are environment-specific and do not inherit between environments.

### Production tessera setup

Register an anvil OIDC client in tessera, then configure the Worker with the issuer URL plus client credentials. The callback URL must be:

```text
https://<anvil-hostname>/api/public/oidc/callback
```

Set the production issuer in `wrangler.jsonc` or through the Cloudflare dashboard:

```text
TESSERA_OIDC_ISSUER=https://<tessera-hostname>
```

Set the client credentials with Wrangler:

```bash
npx wrangler secret put TESSERA_OIDC_CLIENT_ID
npx wrangler secret put TESSERA_OIDC_CLIENT_SECRET
```

When prompted, enter the client ID and secret from tessera. If you later deploy a named Wrangler environment, repeat those secret commands with `--env <name>`.

anvil accepts only OIDC identities with a `sub`, an email address, and `email_verified=true`. First sign-in creates a user or binds an existing unbound user by verified email. Email collisions and disabled users fail closed.

Existing deployments upgrading from legacy invite/password auth should follow [MIGRATION-OIDC.md](MIGRATION-OIDC.md) before deploying latest.

### Key rotation

anvil supports versioned encryption keys. Rotation is additive:

1. Generate a new 32-byte base64 key.
2. Add it to `APP_ENCRYPTION_KEYS_JSON` under the next integer version, while keeping the existing versions. Example: `{"1":"<old-key>","2":"<new-key>"}`.
3. Set `APP_ENCRYPTION_KEY_CURRENT_VERSION` to the new version.
4. Update both Worker secrets with Wrangler, then deploy again.
5. Re-save each project repository token. Repository tokens are only re-encrypted when the token is saved again.
6. Rotate or recreate each webhook secret and update the upstream provider with the new plaintext secret. Webhook secrets only move to the new key version when they are rotated or recreated.
7. Remove older key versions from `APP_ENCRYPTION_KEYS_JSON` only after you are certain every stored repository token and webhook secret that used them has been rewritten.

Keep previous key versions in your secure secrets vault while any stored data may still depend on them. Rotation still requires the old keys to decrypt existing repository tokens and webhook secrets until every stored credential has been rewritten under the newer version.

v1 does not include a bulk re-encryption job or an audit view that shows which stored credentials still depend on an older key version.

## Database setup

anvil uses three SQLite stores managed by Drizzle ORM:

| Store           | Backing               | Contents                                                        |
| --------------- | --------------------- | --------------------------------------------------------------- |
| D1 (`anvil-db`) | Cloudflare D1         | Users, tessera identities, projects, run index                  |
| ProjectDO       | Durable Object SQLite | Active run lock, pending queue, dispatch config, webhook config |
| RunDO           | Durable Object SQLite | Run metadata, steps, rolling logs                               |

### Migrations

```bash
# Local development
npm run db:migrate:d1:local

# Remote (production)
npm run db:migrate:d1
```

### Schema changes

Modify schema files in `src/worker/db/`, then regenerate:

```bash
npm run db:generate
```

Do **not** edit files in `drizzle/` directly — they are generated output.

## Development

```bash
npm run dev
```

Open the local URL printed in the terminal and sign in with tessera. Local development requires the full `npm run dev` stack with D1 migrations applied and `.dev.vars` pointing at a reachable tessera-compatible OIDC issuer.

## All scripts

| Command                              | What it does                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `npm run dev`                        | Start local dev server (Vite + Wrangler)                                         |
| `npm run build`                      | Production build                                                                 |
| `npm test`                           | Fast Vitest suite (worker-focused, excludes Playwright and queue integration)    |
| `npm run test:e2e`                   | Playwright browser tests                                                         |
| `npm run test:integration:queue`     | Queue/runner integration test (starts local app, runs a full pipeline)           |
| `npm run test:integration:workflows` | Workflow-backed runner integration test (starts local app, runs a full pipeline) |
| `npm run typecheck`                  | Full TypeScript type check                                                       |
| `npm run deploy`                     | Apply remote D1 migrations, build, then deploy                                   |
| `npm run db:migrate:d1:local`        | Apply D1 migrations locally                                                      |
| `npm run db:migrate:d1`              | Apply D1 migrations to remote `anvil-db`                                         |
| `npm run db:generate`                | Regenerate Drizzle migrations from schema                                        |
| `npm run format`                     | Format code with Prettier                                                        |

## Deploying to Cloudflare

```bash
# Authenticate
npx wrangler login

# Apply remote D1 migrations, build, and deploy
npm run deploy
```

If the first `npm run deploy` fails because queue `anvil-runs` does not exist yet, create it manually and rerun the deploy:

```bash
npx wrangler queues create anvil-runs
```

See `wrangler.jsonc` for binding configuration: D1 database, KV namespaces, Durable Objects, Queues, Workflows, and Containers. tessera client credentials are Worker secrets, not bindings.

## Cloudflare bindings

| Binding         | Type           | Purpose                                |
| --------------- | -------------- | -------------------------------------- |
| `DB`            | D1             | Primary relational store (`anvil-db`)  |
| `SESSIONS`      | KV             | Session storage with TTL-based expiry  |
| `LOG_TICKETS`   | KV             | Short-lived log streaming auth tickets |
| `PROJECT_DO`    | Durable Object | Per-project run coordination           |
| `RUN_DO`        | Durable Object | Per-run state, logs, WebSocket fanout  |
| `Sandbox`       | Container      | Isolated run execution environment     |
| `RUN_QUEUE`     | Queue          | FIFO run dispatch (max batch size: 1)  |
| `RUN_WORKFLOWS` | Workflow       | Durable Workflow-backed run dispatch   |

## Testing strategy

| Suite                                | Scope                                                                  | Speed                      |
| ------------------------------------ | ---------------------------------------------------------------------- | -------------------------- |
| `npm test`                           | Worker routes, D1/DO invariants, dispatch edge cases, shared utilities | Fast (seconds)             |
| `npm run test:e2e`                   | Browser auth, route guards, profile, project CRUD                      | Medium (starts Playwright) |
| `npm run test:integration:queue`     | Full pipeline: OIDC sign-in → project → trigger → run → logs           | Slow (starts local app)    |
| `npm run test:integration:workflows` | Full pipeline: OIDC sign-in → workflow project → trigger → run → logs  | Slow (starts local app)    |

- Worker tests run with containers disabled; container-related workerd noise may appear without failing
- Integration suites are the automated live run-execution checks for queue-backed and Workflow-backed dispatch — don't duplicate this coverage in Playwright
- If both suites need to run locally, run them **sequentially**, not in parallel

## Security

- **Credential encryption**: Repository tokens and webhook secrets encrypted at rest (AES-GCM with key versioning)
- **Secret redaction**: Git credentials automatically redacted from all run logs
- **XSS hardening**: Strict CSP with no inline scripts and no `eval`
- **Identity**: tessera OIDC with verified-email binding and fail-closed collision handling
- **Sessions**: KV-backed with opaque IDs in a Secure HttpOnly `__Host-anvil_session` cookie
- **CSRF hardening**: Same-origin guard on cookie-bound unsafe methods

## Architecture reference

See [reference/anvil-spec.md](reference/anvil-spec.md) for the full product specification and design decisions.
