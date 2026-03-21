# Operating anvil

Detailed setup, deployment, and operational reference. For the quick start, see [README.md](README.md).

## Prerequisites

- Node.js 20+
- npm
- A Cloudflare account with a [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/) for container-backed run execution
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) — available via `npx wrangler` after `npm install`

D1, Queues, KV, and SQLite-backed Durable Objects are available on Workers Free or Paid with different limits. Container execution requires Workers Paid.

## Environment variables

Copy `.dev.vars.example` to `.dev.vars` for local development:

```bash
cp .dev.vars.example .dev.vars
```

| Variable                             | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `APP_ENCRYPTION_KEY_CURRENT_VERSION` | Active key version for credential encryption |
| `APP_ENCRYPTION_KEYS_JSON`           | JSON map of version → base64 AES-GCM key     |

For production, generate a fresh encryption key. The example key is for local development only.

## Database setup

anvil uses three SQLite stores managed by Drizzle ORM:

| Store           | Backing               | Contents                                         |
| --------------- | --------------------- | ------------------------------------------------ |
| D1 (`anvil-db`) | Cloudflare D1         | Users, projects, run index, invites, credentials |
| ProjectDO       | Durable Object SQLite | Active run lock, pending queue, webhook config   |
| RunDO           | Durable Object SQLite | Run metadata, steps, rolling logs                |

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

### Bootstrap invite

Create the first user invite to access the app:

```bash
# Local
npm run db:seed-initial-user -- --local

# Remote
npm run db:seed-initial-user -- --remote
```

## Development

```bash
npm run dev
```

Open the local URL printed in the terminal. Accept the bootstrap invite to create your account.

### Mock mode (frontend-only)

On localhost, the frontend defaults to **mock mode** — a localStorage-backed API client that simulates the full backend without requiring Workers, D1, or migrations. Toggle between mock and live mode from the login page.

Mock mode is particularly useful for:

- Frontend development without the full backend stack
- Agentic workflows where an AI agent browses the local dev server to verify UI changes
- Quick iteration on components and pages without queue/container dependencies

Live mode requires the full `npm run dev` stack (Wrangler + Vite) with D1 migrations applied.

## All scripts

| Command                          | What it does                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`                    | Start local dev server (Vite + Wrangler)                                      |
| `npm run build`                  | Production build                                                              |
| `npm test`                       | Fast Vitest suite (worker-focused, excludes Playwright and queue integration) |
| `npm run test:e2e`               | Playwright browser tests                                                      |
| `npm run test:integration:queue` | Queue/runner integration test (starts local app, runs a full pipeline)        |
| `npm run typecheck`              | Full TypeScript type check                                                    |
| `npm run db:migrate:d1:local`    | Apply D1 migrations locally                                                   |
| `npm run db:migrate:d1`          | Apply D1 migrations to remote `anvil-db`                                      |
| `npm run db:generate`            | Regenerate Drizzle migrations from schema                                     |
| `npm run db:seed-initial-user`   | Seed a bootstrap invite (`-- --local` or `-- --remote`)                       |
| `npm run format`                 | Format code with Prettier                                                     |

## Deploying to Cloudflare

```bash
# Authenticate
npx wrangler login

# Apply remote D1 migrations
npm run db:migrate:d1

# Build and deploy
npm run build
npx wrangler deploy
```

See `wrangler.jsonc` for binding configuration: D1 database, KV namespaces, Durable Objects, Queues, and Containers.

## Cloudflare bindings

| Binding       | Type           | Purpose                                |
| ------------- | -------------- | -------------------------------------- |
| `DB`          | D1             | Primary relational store (`anvil-db`)  |
| `SESSIONS`    | KV             | Session storage with TTL-based expiry  |
| `LOG_TICKETS` | KV             | Short-lived log streaming auth tickets |
| `PROJECT_DO`  | Durable Object | Per-project run coordination           |
| `RUN_DO`      | Durable Object | Per-run state, logs, WebSocket fanout  |
| `Sandbox`     | Container      | Isolated run execution environment     |
| `RUN_QUEUE`   | Queue          | FIFO run dispatch (max batch size: 1)  |

## Testing strategy

| Suite                            | Scope                                                               | Speed                      |
| -------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| `npm test`                       | Worker routes, D1/DO invariants, queue edge cases, shared utilities | Fast (seconds)             |
| `npm run test:e2e`               | Browser auth, route guards, profile, project CRUD                   | Medium (starts Playwright) |
| `npm run test:integration:queue` | Full pipeline: invite → login → project → trigger → run → logs      | Slow (starts local app)    |

- Worker tests run with containers disabled; container-related workerd noise may appear without failing
- Queue integration is the exclusive automated run-execution check — don't duplicate this coverage in Playwright
- If both suites need to run locally, run them **sequentially**, not in parallel

## Security

- **Credential encryption**: Repository tokens and webhook secrets encrypted at rest (AES-GCM with key versioning)
- **Secret redaction**: Git credentials automatically redacted from all run logs
- **XSS hardening**: Strict CSP (no inline scripts), escaped log rendering
- **Sessions**: KV-backed with opaque IDs, Bearer header auth (not cookies)
- **Password hashing**: PBKDF2 SHA-256, 100k iterations, per-user salt
- **Rate limiting**: See [waf.md](waf.md) for WAF and Workers Rate Limiting recommendations

## Architecture reference

See [reference/anvil-spec.md](reference/anvil-spec.md) for the full product specification and design decisions.
