# anvil engineering specification

## 1. Overview

**anvil** is a Cloudflare-native CI runner for personal projects and small teams.

The v1 architecture is intentionally split across Cloudflare products by access pattern:

- **D1** stores relational control-plane data shared across users and projects.
- **KV** stores short-lived session state with TTL-based expiry.
- **Durable Objects with SQLite** store hot coordination state and live run state.
- **Queues** decouple trigger ingestion from runner execution.
- **Sandbox** runs builds in isolated Linux environments.
- **React** provides the operator UI, served from the same Worker application.

anvil is designed around three hard requirements from the start:

1. A single public API prefix that can be protected by one WAF rate limit rule.
2. Multi-user ownership with single-owner projects in v1.
3. Repository-defined pipeline config instead of UI-defined commands.

## 2. Goals

### 2.1 v1 goals

- Multiple users.
- Multiple projects per user.
- Custom HTTPS Git repositories.
- Manual run trigger.
- Webhook-triggered runs.
- Repository-defined config from `.anvil.yml`.
- Invite-only access for v1.
- One active run per project.
- Per-project FIFO pending run queue.
- User-initiated cancellation of active or pending runs.
- Live log streaming.
- Strong coordination around run creation and run state.

### 2.2 Explicit v1 non-goals

- Deployments.
- Preview environments.
- SSH Git auth.
- Matrix builds.
- DAG or multi-stage orchestration.
- Warm reusable runners.
- User-specified runner images.
- Artifact browser.
- R2 log archiving.
- Human approval gates.
- Shared multi-user projects and project collaboration beyond future expansion.

## 3. Technology stack

### 3.1 Language and runtime

- TypeScript
- Cloudflare Workers
- [Hono](https://hono.dev/)
- React
- Vite
- `@cloudflare/vite-plugin`

Use `hono` as the Worker HTTP framework and routing layer.

### 3.2 Validation and contracts

- `@cloudflare/util-en-garde`

All external and internal boundary payloads must be described with `util-en-garde` codecs and inferred TypeScript types.
If usage patterns are unclear, refer to `en-garde.README.md`.

### 3.3 Persistence

- **D1** for relational data across users/projects/runs.
- **Workers KV** for short-lived session state.
- **SQLite-backed Durable Objects** for project-local and run-local state.
- **Drizzle ORM** for D1 and Durable Object SQLite access.

All application-level database reads and writes must use `drizzle-orm` by default.
Use Drizzle's documented APIs for transactional and batched database work where appropriate; see [Drizzle transactions](https://orm.drizzle.team/docs/transactions) and [Drizzle batch API](https://orm.drizzle.team/docs/batch-api).
Raw SQL may be used only when `drizzle-orm` cannot express the required operation cleanly or when it is absolutely necessary for correctness or performance, and any such usage must be narrowly scoped.

### 3.4 Identifier conventions

All durable entity IDs use the format:

- `{prefix}_{base62(uuidv7)}`

Examples:

- `usr_000Ff2k9A6pQzL1cM8xYwR`
- `prj_000Ff2m4sC7vTb9Jk2nHdP`
- `run_000Ff2qQw8LmNc3Xy6rStU`

Rules:

- the base62 suffix is fixed-width at 22 characters
- the canonical base62 alphabet is `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`
- public IDs are opaque and stable
- this format applies to durable entity IDs such as `usr_`, `prj_`, `run_`, `inv_`, and `whk_`
- high-entropy security tokens such as session IDs, invite tokens, WebSocket tickets, and webhook secrets do not use this format

## 4. High-level architecture

### 4.1 Components

- **Worker frontdoor**

  - API routing
  - auth/session checks
  - D1 access
  - Durable Object RPC invocation
  - authenticated WebSocket upgrade routing
  - Queue producer
  - frontend asset serving

- **ProjectDO**

  - one object per project
  - project-level concurrency and trigger arbitration
  - accepted run state and D1 sync/dispatch reconciliation
  - webhook configuration and encrypted secret storage
  - active and pending run lock state

- **RunDO**

  - one object per run
  - live run metadata
  - rolling log storage
  - WebSocket fanout for log viewers
  - run completion and tail retention

- **Queue consumer**

  - sandbox creation
  - git checkout
  - repo config parsing
  - sequential command execution
  - log streaming into RunDO

- **Sandbox**

  - isolated build execution per run

### 4.2 Control-plane split

The control plane is deliberately divided:

- **Global relational control plane** in D1:

  - users
  - projects
  - invites
  - run index rows

- **Project-local coordination plane** in ProjectDO:

  - active run lock
  - pending run queue coordination
  - accepted run metadata and D1 sync/dispatch retry state
  - webhook definitions and encrypted secret material

- **Run-local live plane** in RunDO:

  - hot status
  - step state
  - rolling log tail
  - WebSocket attachments and tags

This is the core architectural boundary of anvil.

### 4.3 Durable Object routing model

Public identifiers are not Durable Object IDs.

- `ProjectDO` is addressed internally via `idFromName(projectId)`
- `RunDO` is addressed internally via `idFromName(runId)`
- Durable Object IDs remain internal implementation details and are never exposed as API identifiers

### 4.4 Durable Object invocation model

All non-WebSocket interactions with Durable Objects must use **Workers RPC**.

- the Worker frontdoor and queue consumer call typed RPC methods on `ProjectDO` and `RunDO` stubs
- Durable Objects are internal actors, not general-purpose HTTP handlers for private API routes
- the Worker owns HTTP parsing, request validation, authentication, authorization, and response shaping before invoking RPC
- Durable Object RPC methods receive trusted typed inputs and enforce project-local or run-local invariants
- the log-stream WebSocket upgrade is the only `fetch`-based Durable Object path in v1, and the Worker authenticates the upgrade before handing it to `RunDO`

## 5. API surface and routing

### 5.1 Route prefixes

All public, unauthenticated, or brute-forceable endpoints must live under one shared prefix:

- `/api/public/*`

All authenticated application endpoints must live under:

- `/api/private/*`

### 5.2 WAF strategy

A single WAF rate limit rule should protect:

- `starts_with(http.request.uri.path, "/api/public/")`

This one rule is the primary public attack-surface control for:

- login brute force
- session abuse
- webhook spray
- password reset abuse, if added later

### 5.3 Public routes

- `POST /api/public/auth/login`
- `POST /api/public/auth/logout`
- `POST /api/public/auth/invite/accept` (only route that can create a user in v1)
- `POST /api/public/hooks/:provider/:ownerSlug/:projectSlug`

Registration is invite-only in v1. There is no open self-signup route.

### 5.4 Private routes

- `GET /api/private/me`
- `GET /api/private/projects`
- `POST /api/private/projects`
- `PATCH /api/private/projects/:projectId`
- `GET /api/private/projects/:projectId`
- `GET /api/private/projects/:projectId/runs`
- `POST /api/private/projects/:projectId/runs`
- `GET /api/private/projects/:projectId/webhooks`
- `PUT /api/private/projects/:projectId/webhooks/:provider`
- `POST /api/private/projects/:projectId/webhooks/:provider/rotate-secret`
- `DELETE /api/private/projects/:projectId/webhooks/:provider`
- `POST /api/private/runs/:runId/cancel`
- `GET /api/private/runs/:runId`
- `POST /api/private/runs/:runId/log-ticket`
- `GET /api/private/runs/:runId/logs` (WebSocket upgrade)
- `POST /api/private/invites`

## 6. Authentication and sessions

### 6.1 Session storage choice

Session records are stored in **KV**, not D1.

The frontend stores the opaque session identifier in **browser `localStorage`**, not cookies.

Each session key is:

- random opaque identifier
- written with `expirationTtl`
- returned by login and stored in browser `localStorage`
- sent by the frontend on private requests, typically using an `Authorization: Bearer <sessionId>` header
- deleted on logout or allowed to expire naturally

### 6.2 Session payload

Recommended KV value:

```json
{
  "userId": "usr_...",
  "issuedAt": "2026-03-16T00:00:00.000Z",
  "expiresAt": "2026-03-16T06:00:00.000Z",
  "version": 1
}
```

Suggested key pattern:

- `sess:{sessionId}`

### 6.3 TTL guidance

Session TTL should be short and renewable.

Recommended v1 policy:

- default TTL: 6 hours
- refresh-on-use: refresh when less than 1 hour remains
- delete on logout

### 6.4 KV caveat

KV is eventually consistent across regions. This is acceptable for short-lived opaque sessions, but the design must tolerate:

- logout invalidation not becoming globally visible instantly
- recently-created sessions taking some time to appear in far regions

Mitigations:

- use random session IDs with high entropy
- keep session payload minimal
- do not use KV for authorization data beyond the user ID and expiry
- fetch authorization and project ownership from D1 on private requests
- treat logout as best-effort immediate and globally convergent shortly after

### 6.4.1 Browser storage caveat

Because the frontend uses `localStorage` rather than cookies:

- the application avoids ambient cookie attachment and the CSRF exposure tied to cookie-based session transport
- the application must treat XSS resistance as critical because `localStorage` is accessible to frontend JavaScript
- the frontend must never place the session identifier in URLs, WebSocket query strings, or any other browser-visible location beyond the dedicated auth storage key
- logout must clear in-memory auth state and remove the `localStorage` entry immediately
- the frontend must enforce a strict Content Security Policy and avoid inline script execution
- run logs and all other untrusted runner output must be rendered as text, not raw HTML
- any rich log formatting such as ANSI colorization must start from escaped text and apply only an allowlisted presentation transform

### 6.4.2 Disabled-user behavior

For v1:

- login must reject users whose `disabled_at` is set
- private requests must reject sessions whose user row is disabled in D1, even if the KV session has not yet expired
- disabled users cannot create new projects, runs, webhooks, or invites

### 6.5 Password data

Password credential rows remain in D1.

Recommended v1 password storage format:

- algorithm: `PBKDF2`
- per-user random salt stored alongside the password hash
- iteration count stored alongside the password hash so parameters can be raised later
- derived key length and digest algorithm recorded as metadata if the implementation wants explicit forward compatibility

Suggested columns:

- `user_id`
- `algorithm`
- `digest`
- `iterations`
- `salt`
- `password_hash`
- `updated_at`

The salt is required so identical passwords do not map to identical stored hashes and to make precomputed rainbow tables ineffective.

### 6.6 Future authentication methods

Not in v1, but the architecture should leave room for:

- OAuth login
- SAML login

Recommended future shape:

- keep local password auth as one provider
- add an `identity_providers` table in D1 later
- add `user_identities` rows mapping users to external providers and stable provider subject IDs
- keep `/api/public/auth/*` as the public auth ingress prefix so WAF protection remains unchanged

## 7. D1 usage model

### 7.1 What belongs in D1

D1 is the global relational source of truth for:

- users
- password credentials
- projects
- project ownership
- run index
- canonical prefixed entity identifiers and owner-scoped slugs
- encrypted user-provided project credentials
- invite tokens

### 7.2 What stays out of D1

The following should not be stored centrally in D1:

- live run logs
- active-run lock state
- webhook configuration
- encrypted webhook secret material
- live WebSocket connection state
- per-project accepted-run and pending-queue coordination state

Webhook configuration lives in **ProjectDO**.

## 8. D1 Sessions API and read-replication design

anvil should use the **D1 Sessions API whenever possible**, especially on read-heavy application routes.

### 8.1 Session helper policy

Create two D1 helpers:

- `openReadSession(request, env)`
- `openPrimarySession(request, env)`

#### `openReadSession`

Use when the route is logically read-only.

Behavior:

- read bookmark from request header if present
- call `env.DB.withSession(bookmark ?? "first-unconstrained")`
- execute all D1 reads through this session
- return the updated bookmark back to the client

#### `openPrimarySession`

Use when the route may write or must start from the latest primary state.

Behavior:

- call `env.DB.withSession("first-primary")`
- execute D1 read/write operations through this session
- return the updated bookmark back to the client

### 8.2 Bookmark transport

Use a lightweight browser-visible storage for the D1 bookmark.

Recommended initial approach:

- response header: `x-anvil-d1-bookmark`
- mirrored into browser `localStorage` by the frontend fetch wrapper

The bookmark is not auth material. It is only a consistency token.

### 8.3 Likely read-only routes

These routes should use `openReadSession`:

- `GET /api/private/me`
- `GET /api/private/projects`
- `GET /api/private/projects/:projectId`
- `GET /api/private/projects/:projectId/runs`
- `GET /api/private/projects/:projectId/webhooks`
- `GET /api/private/runs/:runId`
- `POST /api/private/runs/:runId/log-ticket` for ownership verification and ticket minting before WebSocket upgrade

Potentially read-only public routes, if later added:

- `GET /api/public/auth/session`
- `GET /api/public/projects/:ownerSlug/:projectSlug/info` if ever exposed

### 8.4 Write-capable routes

These routes should use `openPrimarySession`:

- `POST /api/public/auth/login`
- `POST /api/public/auth/invite/accept`
- `POST /api/private/invites`
- `POST /api/private/projects`
- `PATCH /api/private/projects/:projectId`
- `POST /api/private/projects/:projectId/runs`
- `PUT /api/private/projects/:projectId/webhooks/:provider`
- `POST /api/private/projects/:projectId/webhooks/:provider/rotate-secret`
- `DELETE /api/private/projects/:projectId/webhooks/:provider`
- `POST /api/private/runs/:runId/cancel`
- `POST /api/public/hooks/:provider/:ownerSlug/:projectSlug`

### 8.5 Read route principle

Any route that only:

- validates session via KV
- checks ownership in D1
- returns data without mutating D1

should use the D1 Sessions API read path.

## 9. Durable Objects

### 9.1 ProjectDO

One `ProjectDO` exists per project.

#### Responsibilities

- serialize run trigger requests
- allocate `runId` values for accepted runs
- enforce one-active-run-per-project
- own the per-project FIFO pending run queue in v1
- persist accepted run metadata before D1 sync and queue dispatch succeed
- snapshot the non-secret execution inputs required to execute an accepted run
- act as the single durable reconciler for queue dispatch and D1 run-summary sync
- store webhook definitions and encrypted secrets
- deduplicate webhook deliveries
- return webhook verification material to the Worker and accept verified control-plane actions via RPC
- coordinate run start, cancellation, and lock release

#### SQLite tables in ProjectDO

##### `project_state`

- `project_id TEXT PRIMARY KEY`
- `active_run_id TEXT NULL`
- `updated_at INTEGER NOT NULL`

##### `project_runs`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `run_id TEXT NOT NULL`
- `trigger_type TEXT NOT NULL`
- `triggered_by_user_id TEXT NULL`
- `branch TEXT NOT NULL`
- `commit_sha TEXT NULL`
- `provider TEXT NULL`
- `delivery_id TEXT NULL`
- `repo_url TEXT NOT NULL`
- `config_path TEXT NOT NULL`
- `position INTEGER NULL`
- `status TEXT NOT NULL`
- `d1_sync_status TEXT NOT NULL`
- `dispatch_status TEXT NOT NULL`
- `dispatch_attempts INTEGER NOT NULL`
- `last_error TEXT NULL`
- `created_at INTEGER NOT NULL`
- `cancel_requested_at INTEGER NULL`

`project_runs` is ProjectDO's durable reconciliation ledger for accepted runs.

- `status` tracks ProjectDO's accepted-run and queue-local state
- `d1_sync_status` tracks whether the D1 run summary is reconciled for both initial acceptance and terminal completion
- `dispatch_status` tracks whether the currently executable run has been queued for execution

At acceptance time, `ProjectDO` snapshots the non-secret execution inputs required for execution.

- the effective `branch`
- `repo_url`
- `config_path`

Repository credentials are not snapshotted. The queue consumer resolves the latest stored repository token from D1 at execution time.

##### `project_runs` enum guidance

`status` values in v1:

- `pending`
- `executable`
- `active`
- `cancel_requested`
- `passed`
- `failed`
- `canceled`

Allowed `status` transitions:

- `pending -> executable`
- `pending -> canceled`
- `executable -> active`
- `executable -> failed`
- `executable -> canceled`
- `active -> cancel_requested`
- `active -> passed`
- `active -> failed`
- `cancel_requested -> canceled`
- `cancel_requested -> failed`

`d1_sync_status` values in v1:

- `needs_create`
- `current`
- `needs_terminal_update`
- `done`

Allowed `d1_sync_status` transitions:

- `needs_create -> current`
- `needs_create -> needs_terminal_update`
- `current -> needs_terminal_update`
- `needs_terminal_update -> done`

`dispatch_status` values in v1:

- `blocked`
- `pending`
- `queued`
- `started`
- `terminal`

Allowed `dispatch_status` transitions:

- `blocked -> pending`
- `pending -> queued`
- `queued -> started`
- `blocked -> terminal`
- `pending -> terminal`
- `queued -> terminal`
- `started -> terminal`

##### `project_webhooks`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `provider TEXT NOT NULL`
- `secret_ciphertext BLOB NOT NULL`
- `secret_key_version INTEGER NOT NULL`
- `secret_nonce BLOB NOT NULL`
- `enabled INTEGER NOT NULL`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

##### `project_webhook_deliveries`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `provider TEXT NOT NULL`
- `delivery_id TEXT NOT NULL`
- `run_id TEXT NULL`
- `received_at INTEGER NOT NULL`

#### ProjectDO index plan

- `CREATE UNIQUE INDEX idx_project_webhooks_project_provider ON project_webhooks(project_id, provider);`
- `CREATE INDEX idx_project_webhooks_provider_enabled ON project_webhooks(provider, enabled);`
- `CREATE INDEX idx_project_webhooks_project_enabled ON project_webhooks(project_id, enabled);`
- `CREATE UNIQUE INDEX idx_project_webhook_deliveries_project_provider_delivery ON project_webhook_deliveries(project_id, provider, delivery_id);`
- `CREATE INDEX idx_project_webhook_deliveries_project_received_at ON project_webhook_deliveries(project_id, received_at);`
- `CREATE UNIQUE INDEX idx_project_runs_project_position ON project_runs(project_id, position);`
- `CREATE INDEX idx_project_runs_project_status_position ON project_runs(project_id, status, position);`
- `CREATE UNIQUE INDEX idx_project_runs_run_id ON project_runs(run_id);`

The state table is primary-key driven and does not need extra indexes in v1.

### 9.2 RunDO

One `RunDO` exists per run.

#### Responsibilities

- receive live log events from runner
- persist a rolling log tail
- own all log stream WebSockets
- broadcast to viewers
- keep authoritative hot run state during execution
- finalize run completion metadata
- return minimal trusted run metadata to the Worker when a newly accepted `runId` is not yet visible in D1
- expose run-state and log mutation operations via RPC

`RunDO` is authoritative for active run state and recent run detail. D1 `run_index` is the durable query/index layer and may lag while a run is active.
Its `fetch` handler is reserved for the Worker-authenticated WebSocket upgrade path.

#### SQLite tables in RunDO

##### `run_meta`

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `status TEXT NOT NULL`
- `trigger_type TEXT NOT NULL`
- `branch TEXT NOT NULL`
- `commit_sha TEXT NULL`
- `current_step INTEGER NULL`
- `started_at INTEGER NULL`
- `finished_at INTEGER NULL`
- `exit_code INTEGER NULL`
- `error_message TEXT NULL`

##### `run_steps`

- `id TEXT PRIMARY KEY`
- `run_id TEXT NOT NULL`
- `position INTEGER NOT NULL`
- `name TEXT NOT NULL`
- `command TEXT NOT NULL`
- `status TEXT NOT NULL`
- `started_at INTEGER NULL`
- `finished_at INTEGER NULL`
- `exit_code INTEGER NULL`

##### `run_logs`

- `id TEXT PRIMARY KEY`
- `run_id TEXT NOT NULL`
- `seq INTEGER NOT NULL`
- `stream TEXT NOT NULL`
- `chunk TEXT NOT NULL`
- `created_at INTEGER NOT NULL`

#### RunDO index plan

- `CREATE UNIQUE INDEX idx_run_logs_run_seq ON run_logs(run_id, seq);`
- `CREATE INDEX idx_run_logs_run_created_at ON run_logs(run_id, created_at);`
- `CREATE UNIQUE INDEX idx_run_steps_run_position ON run_steps(run_id, position);`
- `CREATE INDEX idx_run_meta_project_started_at ON run_meta(project_id, started_at);`

The most common queries in RunDO are:

- fetch latest log tail for one run
- append ordered log chunks
- fetch ordered steps for one run

These indexes are designed specifically for those patterns.

## 10. WebSocket Hibernation design

This is a first-class design decision, not an implementation detail.

Run log streaming must use the **Durable Object WebSocket Hibernation API**.

### 10.1 Why Hibernation is mandatory

CI logs are bursty:

- large bursts while commands are active
- idle gaps during install, network wait, or subprocess silence
- viewers can remain attached for long periods

Hibernation is the right fit because:

- clients stay connected while the object is evicted from memory
- the object wakes automatically on the next event
- duration charges do not accrue while the object is sleeping
- anvil does not need to pin a RunDO in memory just because a browser tab is open

### 10.2 Required Hibernation APIs

RunDO must use:

- `ctx.acceptWebSocket(ws)`
- `ctx.getWebSockets()`
- `ws.serializeAttachment(...)`
- `ws.deserializeAttachment()`
- `ctx.setWebSocketAutoResponse(...)`

### 10.3 Attachment contents

Each WebSocket attachment should store:

- `runId`
- `userId`
- `connectedAt`
- `lastAckedSeq` if incremental replay is later added

### 10.4 Wake-up behavior

When RunDO wakes after hibernation:

- constructor runs again
- in-memory state is rebuilt from SQLite and socket attachments
- attached sockets are recovered via `ctx.getWebSockets()`
- replay state must not depend on old memory

### 10.5 Log replay model

For v1:

- keep a bounded rolling log tail in RunDO SQLite
- cap retained hot log storage at **2 MiB per run**
- on new WebSocket connection, replay the recent tail
- then stream live events

Full log archival is deferred to future R2 integration.

### 10.6 Cost-sensitive behavior

Use auto-response for ping/pong-style keepalive traffic so idle viewers do not wake the object unnecessarily.

### 10.7 WebSocket auth

Browser WebSocket clients cannot attach an `Authorization` header during the upgrade flow. For v1, anvil uses a short-lived log-stream ticket stored in KV.

- authenticated client calls `POST /api/private/runs/:runId/log-ticket`
- Worker validates session identity and run ownership before minting the ticket
- the ticket is stored in KV with `runId`, `userId`, and expiry metadata
- the ticket is best-effort single-use and should expire after **60 seconds**
- the browser connects using `GET /api/private/runs/:runId/logs?ticket=...`
- the Worker validates and consumes the ticket before forwarding the upgrade to `RunDO`
- strict global single-use is not required in v1 because KV is eventually consistent; the security boundary is short TTL plus binding the ticket to `runId` and `userId`
- the Worker forwards trusted authenticated upgrade metadata to `RunDO`; `RunDO` must not treat the browser query string as auth material
- session identifiers must never appear in WebSocket query strings

## 11. Queue and runner execution

### 11.1 Queue role

Queues provide durable handoff between trigger ingestion and execution.

Each queue message contains:

```json
{
  "projectId": "prj_...",
  "runId": "run_..."
}
```

A queue message is a delivery hint, not the source of truth for scheduling.

Cloudflare Queues do not provide strict FIFO delivery guarantees, so v1 must not rely on queue delivery order to preserve per-project execution order.

**ProjectDO is authoritative** for:

- whether a run is still pending
- whether a run is currently active
- whether a run has been canceled
- which pending run is next in FIFO order

The queue consumer must re-check `ProjectDO` before starting work and must no-op stale, duplicate, canceled, or superseded queue messages.

#### 11.1.1 Run acceptance boundary

A run is considered accepted once `ProjectDO` durably writes the accepted run record to its local SQLite state.

- `ProjectDO` allocates the canonical `runId`
- the accepted run record snapshots the non-secret execution inputs required for execution
- the accepted run record is written before D1 sync and queue enqueue are required to succeed
- the API returns `202 Accepted` with `runId` after the `ProjectDO` commit succeeds
- D1 `run_index` creation is a post-acceptance reconciliation step
- queue enqueue is a post-acceptance reconciliation step only when the accepted run is currently executable

#### 11.1.2 Queue and reconciliation policy

For v1:

- maximum pending accepted runs per project: **20**
- `ProjectDO` is the single durable reconciler for queue dispatch and D1 run-summary sync
- `ProjectDO` is also the durable watchdog owner for an active accepted run until terminalization is confirmed
- only the currently executable run should have a queue message enqueued
- accepted runs behind an active run remain only in the ProjectDO FIFO queue until promoted
- when `ProjectDO` promotes the next pending run to executable, exactly one queue message should be enqueued for that run
- queue enqueue failures before execution begins should be retried from `ProjectDO` with bounded exponential backoff
- D1 sync failures for both initial acceptance and terminal completion should be retried from `ProjectDO` using an alarm or equivalent retry mechanism
- if dispatch retries are exhausted before sandbox execution begins, the run is marked `failed` with a system reason such as `dispatch_failed`
- while a run is active, the queue consumer must periodically heartbeat execution progress to `ProjectDO`
- if the heartbeat becomes stale before a terminal update is recorded, `ProjectDO` marks the run `failed` with a system reason such as `runner_lost`, reconciles D1, releases the active lock, and advances the queue
- once a sandbox has started, anvil does not automatically rerun the build on worker-side failure; it only finalizes the accepted run

#### 11.1.3 Platform execution limits

For v1:

- queue consumer invocations have a **15 minute** wall-clock limit on Cloudflare
- the queue consumer Worker should run on a paid plan with `limits.cpu_ms` set to **300000**
- whole-run timeout must stay below the queue consumer wall-clock limit so checkout, reconciliation, and cleanup have headroom
- the queue consumer should use Sandbox SDK WebSocket transport to avoid per-operation subrequest pressure
- active CI sandboxes should use `keepAlive: true` and must always be explicitly destroyed

### 11.2 Queue consumer responsibilities

- load project summary from D1, including the latest encrypted repository credential metadata if present
- call ProjectDO RPC to confirm run ownership and queue state and retrieve the accepted-run execution snapshot
- no-op the message if ProjectDO reports the run is stale, duplicate, canceled, already completed, or not the current executable run
- treat a message for a non-executable run as an unexpected but tolerated stale delivery and emit a structured log or metric before acknowledging it
- create Sandbox with `keepAlive: true`
- use the Sandbox SDK to check out the repository inside the Sandbox
- load the repository config from the snapshotted `config_path`
- validate config with `util-en-garde`
- transition the run through `starting` and `running` in RunDO via RPC
- create step rows in RunDO via RPC
- start heartbeat updates to `ProjectDO` while the run is active
- run named steps sequentially
- stream output to RunDO via RPC using batched/coalesced log appends rather than one-row-per-small-fragment writes
- finalize run in RunDO via RPC and report the terminal summary back to ProjectDO
- let ProjectDO perform or retry the D1 run-summary sync
- release the project lock in ProjectDO via RPC
- advance the ProjectDO FIFO queue via RPC if another pending run exists and enqueue exactly one queue message for the newly promoted executable run
- destroy sandbox in `finally`

### 11.3 Failure boundaries

The queue consumer is responsible for best-effort cleanup on:

- sandbox startup failure
- checkout failure
- config parse failure
- command non-zero exit
- worker-side exception

RunDO should still receive a terminal state update for all of those paths.
If a command timeout or cancellation occurs, the queue consumer must explicitly terminate the underlying Sandbox process or session and must not assume the SDK timeout alone has stopped execution.

### 11.4 Runner model and cancellation semantics

The runner model must make cancellation explicit.

Each executing build step must run in a way that exposes a controllable Sandbox process or session handle.

Required semantics:

- soft cancel attempts to stop execution at the running process boundary or via a graceful process signal
- hard cancel escalates by explicitly killing the Sandbox process group, session, or sandbox when graceful shutdown does not complete within **30 seconds**
- command timeout alone is not sufficient as a cancellation mechanism; the implementation must actively terminate the underlying process or session because Sandbox SDK command timeouts only end the caller-side wait
- the next FIFO run must not be promoted until the active run is confirmed stopped

### 11.5 Platform runner image

v1 uses one platform-owned runner image. Repositories cannot choose or override the runner image in `.anvil.yml`.

Recommended image source:

- `docker/runner.Dockerfile`

Recommended Dockerfile:

```dockerfile
ARG SANDBOX_VERSION=0.7.0
FROM docker.io/cloudflare/sandbox:${SANDBOX_VERSION}-python

ENV DEBIAN_FRONTEND=noninteractive \
    CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    PNPM_HOME=/opt/pnpm \
    PATH=/opt/pnpm:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    file \
    git \
    git-lfs \
    jq \
    pkg-config \
    procps \
    rsync \
    unzip \
    wget \
    xz-utils \
    zip \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
    && corepack prepare pnpm@9.15.0 --activate \
    && corepack prepare yarn@4.6.1 --activate

WORKDIR /workspace
```

Runner contract for v1:

- Ubuntu 22.04-based Cloudflare Sandbox image
- Node.js 20 LTS with npm
- Bun from the Cloudflare base image
- Python 3.11 with `pip` and `venv`
- `pnpm` and `yarn` via `corepack`
- common CI utilities including `git`, `git-lfs`, `curl`, `wget`, `jq`, `zip`, `unzip`, `file`, `procps`, `rsync`, `build-essential`, and `pkg-config`

The Docker base image version must stay in lockstep with the `@cloudflare/sandbox` npm package version used by the application.

### 11.6 Repository checkout and credentials

Repository checkout in v1 should use a deliberately narrow policy.

Allowed repository URL policy:

- repository URLs must use `https://`
- the host must be a normal DNS hostname
- embedded credentials in the URL are rejected
- query strings and fragments are rejected
- explicit non-default ports are rejected
- `localhost`, loopback hosts, and IP-literal hosts are rejected
- standard TLS validation is required; self-signed or private CA repositories are unsupported in v1

Private repository credential handling in v1:

- each project may store one encrypted repository token in D1
- the token is decrypted only for clone or fetch operations
- the queue consumer may construct an in-memory credentialed HTTPS URL in the provider's supported PAT format and pass it directly to `sandbox.gitCheckout(...)`
- the credentialed URL is an ephemeral runtime value only and must never be stored in D1, ProjectDO, RunDO, `.git/config`, or any persisted repository config files
- the clean repository URL stored in D1 must remain uncredentialed
- checkout failures and runner logs must redact credentialed URLs and tokens before they are emitted or returned
- the token must never appear in structured logs, user-visible error messages, or persisted configuration

The v1 checkout model is intentionally limited to keep repository access predictable and avoid leaking credentials through common git transport surfaces.

## 12. Repository configuration

Pipeline configuration is repository-defined.

### 12.1 Default path

- `.anvil.yml`

### 12.2 Optional override

Projects may store a custom path in D1, for example:

- `.config/anvil.yml`
- `ci/anvil.yml`

For v1, `config_path` must be repo-relative. Absolute paths and path traversal such as `..` are rejected.

### 12.3 v1 config schema

```yaml
version: 1
checkout:
  depth: 1
run:
  workingDirectory: .
  timeoutSeconds: 720
  steps:
    - name: install
      run: npm ci
    - name: test
      run: npm test
    - name: build
      run: npm run build
```

v1 step shape is intentionally minimal:

- `name`
- `run`

`run.timeoutSeconds` is a whole-run timeout, not a per-step timeout.

### 12.3.1 v1 config limits

For v1:

- maximum config file size: **64 KiB**
- maximum step count: **20**
- maximum step name length: **64**
- maximum step command length: **4096 bytes**
- maximum `run.timeoutSeconds`: **720**
- `workingDirectory` must be repo-relative
- absolute paths are rejected
- path traversal such as `..` is rejected

### 12.4 Validation behavior

The config file is validated after checkout.

If validation fails:

- the run is marked failed
- a structured `warn` or `error` log line is emitted
- no build commands are executed
- unknown top-level fields must be rejected
- unknown step-level fields must be rejected
- config values exceeding the v1 limits above must be rejected

### 12.5 Reserved future expansion fields

v1 keeps repository config intentionally small, but the schema should leave room for future expansion such as:

- environment variables
- cache hints
- artifact declarations
- image selection
- conditional steps

These are not implemented in v1. The v1 runner image is platform-owned and cannot be selected from `.anvil.yml`.

## 13. D1 schema

All D1 `id` columns use the canonical prefixed identifier format defined in section 3.4.

### 13.1 users

- `id TEXT PRIMARY KEY`
- `slug TEXT NOT NULL UNIQUE`
- `email TEXT NOT NULL UNIQUE`
- `display_name TEXT NOT NULL`
- `created_at INTEGER NOT NULL`
- `disabled_at INTEGER NULL`

`users.slug` is the canonical owner slug.

Indexes:

- `CREATE UNIQUE INDEX idx_users_slug ON users(slug);`
- `CREATE UNIQUE INDEX idx_users_email ON users(email);`

### 13.2 password\_credentials

- `user_id TEXT PRIMARY KEY`
- `algorithm TEXT NOT NULL`
- `digest TEXT NOT NULL`
- `iterations INTEGER NOT NULL`
- `salt BLOB NOT NULL`
- `password_hash BLOB NOT NULL`
- `updated_at INTEGER NOT NULL`

### 13.3 projects

- `id TEXT PRIMARY KEY`
- `owner_user_id TEXT NOT NULL`
- `owner_slug TEXT NOT NULL`
- `project_slug TEXT NOT NULL`
- `name TEXT NOT NULL`
- `repo_url TEXT NOT NULL`
- `default_branch TEXT NOT NULL`
- `config_path TEXT NOT NULL DEFAULT '.anvil.yml'`
- `repo_token_ciphertext BLOB NULL`
- `repo_token_key_version INTEGER NULL`
- `repo_token_nonce BLOB NULL`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

`projects.owner_slug` is a denormalized copy of `users.slug` kept for owner-scoped lookup efficiency.

Indexes:

- `CREATE UNIQUE INDEX idx_projects_owner_project_slug ON projects(owner_slug, project_slug);`
- `CREATE INDEX idx_projects_owner_user_updated_at ON projects(owner_user_id, updated_at DESC);`
- `CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);`

### 13.4 invites

- `id TEXT PRIMARY KEY`
- `created_by_user_id TEXT NOT NULL`
- `token_hash BLOB NOT NULL`
- `expires_at INTEGER NOT NULL`
- `accepted_by_user_id TEXT NULL`
- `accepted_at INTEGER NULL`
- `created_at INTEGER NOT NULL`

Indexes:

- `CREATE UNIQUE INDEX idx_invites_token_hash ON invites(token_hash);`
- `CREATE INDEX idx_invites_created_by_created_at ON invites(created_by_user_id, created_at DESC);`
- `CREATE INDEX idx_invites_expires_at ON invites(expires_at);`

### 13.5 run\_index

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `triggered_by_user_id TEXT NULL`
- `trigger_type TEXT NOT NULL`
- `branch TEXT NOT NULL`
- `commit_sha TEXT NULL`
- `status TEXT NOT NULL`
- `queued_at INTEGER NOT NULL`
- `started_at INTEGER NULL`
- `finished_at INTEGER NULL`
- `exit_code INTEGER NULL`

`run_index` is the last-synced durable summary in D1. While a run is active, `RunDO` remains authoritative and D1 status may lag. Immediately after acceptance, the D1 row may be temporarily absent until ProjectDO reconciliation succeeds.

Indexes:

- `CREATE INDEX idx_run_index_project_queued_at ON run_index(project_id, queued_at DESC);`
- `CREATE INDEX idx_run_index_project_started_at ON run_index(project_id, started_at DESC);`
- `CREATE INDEX idx_run_index_user_queued_at ON run_index(triggered_by_user_id, queued_at DESC);`
- `CREATE INDEX idx_run_index_status_queued_at ON run_index(status, queued_at DESC);`

### 13.6 Query patterns these indexes support

- list projects for current user
- fetch one project by owner-scoped slug or id
- resolve owner-scoped public webhook routes efficiently
- list recent runs for one project using keyset pagination, not offset pagination
- list recent runs initiated by one user using keyset pagination, not offset pagination
- fetch one run summary by id
- create and redeem invite tokens efficiently

## 14. Private API auth and authorization flow

For every private route:

1. Read the session identifier from the request, typically from the `Authorization` header.
2. Resolve session in KV.
3. Reject if missing or expired.
4. Open D1 session.
5. Read project ownership or resource ownership from D1.
6. Validate request payload and derive the target Durable Object public ID if applicable.
7. If Durable Object state is needed, invoke the target object via RPC using trusted typed inputs.
8. Shape the HTTP response in the Worker.

The session in KV identifies the user. The authoritative authorization checks still happen in D1.
Durable Objects must not read browser session headers or perform primary authentication for private routes.

### 14.1 Run-scoped route resolution during D1 lag

`runId` may exist before its D1 `run_index` row is visible because `ProjectDO` accepts the run before reconciliation completes.

For private run-scoped routes such as:

- `GET /api/private/runs/:runId`
- `POST /api/private/runs/:runId/cancel`
- `POST /api/private/runs/:runId/log-ticket`

the Worker should:

1. validate the session via KV
2. attempt to resolve the run from D1 `run_index`
3. if the D1 row is missing, call `RunDO` using `runId` to fetch minimal trusted metadata such as `projectId` and current run status
4. authorize the caller by checking project ownership in D1 using that `projectId`
5. continue with the route-specific logic

This preserves D1 as the source of authorization while allowing newly accepted runs to be queried or canceled immediately.

### 14.2 WebSocket log stream auth flow

`GET /api/private/runs/:runId/logs` is authenticated by short-lived log-stream ticket rather than by `Authorization` header.

1. Client calls `POST /api/private/runs/:runId/log-ticket`.
2. Worker validates the session via KV.
3. Worker checks run ownership via D1 or, if needed during reconciliation lag, via the `RunDO`-assisted ownership flow above.
4. Worker stores a short-lived best-effort single-use ticket in KV.
5. Client opens `GET /api/private/runs/:runId/logs?ticket=...`.
6. Worker validates and consumes the ticket.
7. Worker forwards the authenticated WebSocket upgrade to `RunDO`.
8. `RunDO` attaches the socket using trusted Worker-provided auth context.

## 15. Public webhook flow

Webhook configuration is owned by ProjectDO, not D1.

### 15.1 Public webhook ingress steps

1. Request arrives at `/api/public/hooks/:provider/:ownerSlug/:projectSlug`.
2. Worker frontdoor resolves `(ownerSlug, projectSlug) -> projectId` from D1.
3. Worker frontdoor derives `ProjectDO` from `idFromName(projectId)`.
4. Worker calls `ProjectDO` RPC to load the minimal webhook verification material and project-local webhook settings for that provider.
5. Worker authenticates the incoming webhook request using the provider signature scheme.
6. Worker normalizes the verified event and applies event-type and branch policy checks.
7. Worker calls `ProjectDO` RPC to deduplicate the delivery and accept the verified trigger.
8. If accepted, `ProjectDO` allocates `runId` and durably records the accepted run.
9. Worker attempts to write the D1 summary row and, if the run is currently executable, enqueue it.
10. If D1 sync or enqueue fails, `ProjectDO` retains reconciliation state and retries later.

### 15.2 v1 provider and event scope

Supported providers in v1:

- GitHub
- GitLab
- Gitea

Webhook management scope in v1:

- users configure provider webhooks manually in the upstream provider UI
- anvil stores provider verification material and enablement state
- anvil does not create, update, or delete provider webhooks through provider APIs in v1

Webhook trigger policy in v1:

- only `push` events create runs
- only pushes to `projects.default_branch` create runs
- provider ping/test events return success but do not create runs
- duplicate webhook deliveries must be deduplicated by `(project_id, provider, delivery_id)` for **72 hours**
- manual triggers are not deduplicated

### 15.3 Why slug lookup still uses D1

The webhook config itself is not in D1. Only the stable mapping from public owner-scoped slug to project identity is in D1.

Slug policy for v1:

- allowed characters: alphanumeric, hyphen (`-`), underscore (`_`)
- user slug is chosen once at signup
- rename flow is deferred
- project slug is unique within an owner scope

This keeps webhook secrets localized to the project actor while preserving simple public routing and a Worker-owned authentication boundary.

## 16. Project and run lifecycle

### 16.1 Project creation

1. Authenticated user calls `POST /api/private/projects`.
2. Worker uses D1 primary session.
3. Worker inserts `projects` row with owner identity.
4. Worker returns project summary.
5. ProjectDO is created lazily on first use.

### 16.2 Manual run trigger

1. Authenticated user calls `POST /api/private/projects/:projectId/runs`.
2. Worker validates session via KV.
3. Worker checks project ownership via D1.
4. Request may include an optional branch override; if omitted, anvil uses `projects.default_branch`.
5. Worker calls `ProjectDO` RPC to accept the run.
6. `ProjectDO` allocates `runId`, snapshots the non-secret execution inputs for the run, records the accepted run, and initializes `RunDO`.
7. Worker returns `202 Accepted` with `runId`.
8. Worker attempts to insert the `run_index` row in D1.
9. Worker enqueues the run only if `ProjectDO` reports that it is currently executable.
10. If D1 sync or enqueue fails, `ProjectDO` retries reconciliation asynchronously.

### 16.2.1 Run cancellation

Users may cancel:

- the active run for a project
- any pending run in that project's FIFO queue

Cancellation is requested through:

- `POST /api/private/runs/:runId/cancel`

Behavior:

- if the run is pending, Worker authorizes the caller and then invokes ProjectDO RPC to remove it from the FIFO queue and mark it canceled
- if the run is active, repeated cancel requests are idempotent and do not create a second cancellation workflow
- if the run is active, Worker authorizes the caller and then invokes ProjectDO and RunDO via RPC; anvil first attempts a soft cancel at the running process boundary
- if soft cancel does not complete in time and the runtime allows it, anvil escalates to a hard kill of the sandbox process or session
- RunDO transitions the run toward canceled and ProjectDO advances the next queued run
- ProjectDO reconciles D1 `run_index` to terminal status `canceled`

### 16.3 Webhook run trigger

1. Public webhook request hits WAF-protected prefix.
2. Worker resolves project identity in D1 using owner-scoped slug.
3. Worker calls `ProjectDO` RPC to load verification material for the provider.
4. Worker authenticates the webhook request and validates provider event type, default-branch policy, and delivery idempotency preconditions.
5. If the delivery should create a run, Worker calls `ProjectDO` RPC to accept it and append it to the per-project FIFO queue.
6. `ProjectDO` allocates `runId`, snapshots the non-secret execution inputs for the run, and initializes `RunDO`.
7. Worker attempts to insert the `run_index` row in D1.
8. Worker enqueues the run only if `ProjectDO` reports that it is currently executable.
9. If D1 sync or enqueue fails, `ProjectDO` retries reconciliation asynchronously.

### 16.4 Run execution

1. Queue consumer receives `{projectId, runId}`.
2. Queue consumer confirms with `ProjectDO` that the run is still the current executable run for the project and retrieves the accepted-run execution snapshot.
3. If `ProjectDO` reports the message is stale, duplicate, canceled, or not executable, the consumer acknowledges it without creating a Sandbox.
4. Queue consumer creates Sandbox with `keepAlive: true`.
5. Queue consumer uses the accepted-run snapshot and the latest repository token to check out the repository inside the Sandbox.
6. Sandbox loads the snapshotted config path.
7. Queue consumer calls `RunDO` RPC to transition the run from `queued` to `starting`.
8. Validated commands are written to RunDO step rows through RPC.
9. Queue consumer starts heartbeat updates to `ProjectDO` and then calls `RunDO` RPC to transition the run to `running`.
10. Commands execute sequentially.
11. Output chunks stream to `RunDO` through RPC.
12. RunDO broadcasts to viewers.
13. Terminal state is written to `RunDO` through RPC and reported back to `ProjectDO`.
14. `ProjectDO` updates or retries the D1 `run_index` terminal sync.
15. Queue consumer calls `ProjectDO` RPC to release the lock.
16. Queue consumer calls `ProjectDO` RPC to advance the next FIFO pending run, if any, and enqueue exactly one queue message for the newly promoted executable run.
17. Sandbox is destroyed in `finally`.

## 17. Frontend

### 17.1 App structure

Frontend lives under `src/web` and is served by the Worker.

Recommended stack:

- React Router
- TanStack Query
- typed API wrapper consuming `util-en-garde` contracts
- frontend auth wrapper storing the session identifier in browser `localStorage`
- frontend D1 bookmark wrapper storing the latest read-replication bookmark in browser `localStorage`
- log stream wrapper that mints short-lived tickets before opening the WebSocket

### 17.2 Pages

- `/app/projects`
- `/app/projects/new`
- `/app/projects/:projectId`
- `/app/runs/:runId`
- `/app/login`

### 17.3 Core UI responsibilities

#### Projects list

- show projects owned by current user
- show last known run status

#### Project detail

- repo URL
- default branch
- config path
- recent runs
- trigger run button
- webhook summary
- pending queue summary

#### Run detail

- run status
- step list
- live log panel
- reconnecting log stream client

## 18. Contracts

Shared contracts live under `src/contracts`.

Recommended files:

- `auth.ts`
- `project.ts`
- `run.ts`
- `webhook.ts`
- `repo-config.ts`
- `log.ts`
- `common.ts`

### Required contract types

- `LoginRequest`
- `LoginResponse`
- `CreateProjectRequest`
- `ProjectSummary`
- `ProjectDetail`
- `TriggerRunRequest`
- `RunSummary`
- `RunDetail`
- `LogStreamTicketResponse`
- `WebhookSummary`
- `UpsertWebhookRequest`
- `WebhookTriggerPayload`
- `RepoConfig`
- `LogEvent`

## 19. Repo layout

```text
anvil/
  src/
    contracts/
      auth.ts
      project.ts
      run.ts
      webhook.ts
      repo-config.ts
      log.ts
      common.ts

    worker/
      index.ts
      env.ts

      api/
        public/
          auth.ts
          webhooks.ts
        private/
          me.ts
          projects.ts
          runs.ts
          webhooks.ts

      auth/
        headers.ts
        sessions.ts
        passwords.ts
        tickets.ts

      durable/
        project-do.ts
        run-do.ts

      queue/
        consumer.ts
        messages.ts

      sandbox/
        runner.ts
        git.ts
        repo-config.ts
        commands.ts

      db/
        d1/
          schema/
          repositories/
        durable/
          schema/
          repositories/
        migrate.ts

      services/
        project-service.ts
        run-service.ts
        webhook-service.ts
        id-service.ts

    client/
      main.tsx
      app.tsx
      router.tsx
      pages/
      components/
      lib/

  drizzle/
    d1/
    durable/

  docker/
    runner.Dockerfile

  public/
  wrangler.jsonc
  package.json
  tsconfig.json
```

## 20. Future extension points

### 20.1 Cloudflare Workflows

Workflows are not part of v1 execution, but the specification should leave room for them.

#### Likely fit for Workflows later

- multi-stage pipelines
- retries across long-running steps
- durable approval gates
- scheduled retries or backoff across external systems
- artifact publication or promotion flows
- long waits for external events

#### Probable future shape

v1 uses:

- Worker frontdoor
- Queue
- ProjectDO
- RunDO
- Sandbox

A future v2 may add Workflows as an orchestration layer above the queue consumer:

- trigger accepted
- workflow started
- workflow step starts sandbox
- workflow step waits for completion event
- workflow step publishes artifacts or notifies external systems

If Workflows are added later, every step must be designed idempotently.

### 20.2 R2 for full logs and artifacts

R2 is not in v1, but the specification should reserve a clear role for it.

#### Future use of R2

- full run log archival
- uploaded artifacts
- test reports
- compressed logs for completed runs
- build outputs too large for Durable Object SQLite retention

#### Future log storage split

- **RunDO SQLite** retains only a bounded hot tail for live UI and recent history.
- **R2** stores immutable completed-run log archives.

#### Future artifact shape

Suggested key patterns:

- `logs/{projectId}/{runId}.txt`
- `logs/{projectId}/{runId}.jsonl`
- `artifacts/{projectId}/{runId}/{artifactName}`

#### Suggested metadata rows later

If R2 is added later, add D1 tables such as:

- `run_archives`
- `run_artifacts`

v1 does not implement these.

## 21. Concurrency rules

### 21.1 v1 rule

- one active run per project
- FIFO pending queue per project

### 21.2 Queue behavior and cancellation

v1 supports:

- one active run per project
- FIFO pending queue for additional accepted runs
- user-initiated cancellation of active runs
- user-initiated cancellation of pending runs

ProjectDO is responsible for queue mutation, cancellation, and advancement.

### 21.3 Ownership of concurrency

ProjectDO is the sole owner of project-level concurrency state.

No other component should attempt to coordinate active-run state or pending-queue state outside ProjectDO.

## 22. Error handling and cleanup

### 22.1 Terminal state guarantee

Every accepted run must end in exactly one terminal state:

- `passed`
- `failed`
- `canceled`

### 22.1.1 Canonical run statuses

The canonical run status enum for v1 is:

- `queued`
- `starting`
- `running`
- `cancel_requested`
- `canceling`
- `passed`
- `failed`
- `canceled`

`RunDO` should expose the freshest status. D1 `run_index.status` uses the same enum but may lag for active runs.

`pending` is an internal ProjectDO queue concept in v1, not a public run status. Public APIs and persisted run summaries should use only the canonical status enum above.

### 22.1.2 Allowed status transitions

v1 should allow only these transitions:

- `queued -> starting`
- `queued -> canceled`
- `starting -> running`
- `starting -> failed`
- `starting -> cancel_requested`
- `running -> passed`
- `running -> failed`
- `running -> cancel_requested`
- `cancel_requested -> canceling`
- `cancel_requested -> canceled`
- `canceling -> canceled`
- `canceling -> failed` if forced termination or cleanup fails after cancellation has begun

Terminal states do not transition further.

### 22.2 Cleanup responsibilities

- queue consumer destroys sandbox
- RunDO finalizes run status
- ProjectDO reconciles and retries D1 `run_index` updates
- ProjectDO releases active lock

### 22.2.1 Retention and pruning

For v1:

- `project_webhook_deliveries` rows should be retained for **72 hours**
- terminal `project_runs` rows that are fully reconciled to D1 should be pruned after **7 days**
- `RunDO` detail state (`run_meta`, `run_steps`, and the retained hot log tail) should be retained for **7 days** after terminal completion

After `RunDO` detail retention expires:

- D1 `run_index` remains the durable summary source
- `GET /api/private/runs/:runId` should still return the D1 summary if it exists
- the response should indicate that detailed run state is no longer available

### 22.3 Timeouts

For v1, enforce:

- `run.timeoutSeconds` from repo config as the user-visible whole-run timeout
- `run.timeoutSeconds` must not exceed **720**
- the configured run timeout must leave headroom within the queue consumer's **15 minute** wall-clock limit for checkout, reconciliation, cancellation, and cleanup
- the queue consumer Worker should run with `limits.cpu_ms` set to **300000**
- internal platform safety timeouts may exist, but they are implementation details rather than user-configurable step timeouts

`ProjectDO` must use an alarm or equivalent watchdog mechanism to detect stale active-run heartbeats and recover orphaned runs in v1.

### 22.4 Structured logging and observability

Structured level logging is required in v1.

All runtime components should emit structured JSON logs:

- Worker frontdoor
- `ProjectDO`
- `RunDO`
- queue consumer

Required log levels:

- `debug`
- `info`
- `warn`
- `error`

Minimum required fields on every log event:

- `ts`
- `level`
- `event`
- `component`

Include these contextual fields whenever available:

- `requestId`
- `projectId`
- `runId`
- `userId`
- `queueMessageId`
- `provider`
- `deliveryId`
- `attempt`
- `status`
- `errorCode`

Required structured log events include at least:

- run acceptance
- queue dispatch retry
- D1 sync retry
- stale queue delivery
- sandbox startup failure
- checkout failure
- config validation failure
- run cancellation request
- cancel escalation to hard kill
- watchdog recovery of an orphaned run

Structured logs must never contain:

- repository tokens or PATs
- session identifiers
- webhook secrets
- log-stream tickets
- raw `Authorization` headers
- credentialed repository URLs

## 23. Security model

### 23.1 Secrets and encryption

- webhook secrets live in ProjectDO SQLite as encrypted blobs
- user-provided repository tokens are encrypted before being stored in D1
- stored repository tokens are used for Git access only in v1
- plaintext repository tokens and webhook secrets are never persisted in D1, KV, or Durable Object SQLite
- short-lived WebSocket log-stream tickets live in KV
- password hashes are derived with PBKDF2 using a per-user random salt

### 23.1.1 Versioned master-key encryption for stored project tokens

anvil should support storing one user-provided repository token per project in D1 using application-level encryption.

Recommended v1 design:

- one global app master key in the Worker environment
- the master key has a monotonically increasing integer version
- when a user saves a token, anvil encrypts it before writing to D1
- the D1 project row stores ciphertext plus the key version and nonce/IV
- reads decrypt using the master key matching the stored version
- future key rotation is performed by introducing a new version and re-encrypting rows over time

Suggested storage fields per encrypted token:

- `repo_token_ciphertext`
- `repo_token_key_version`
- `repo_token_nonce`

The exact cipher can be implementation-defined, but it should be an authenticated encryption mode. The important invariant for the specification is that token plaintext never lands in the database.

### 23.1.2 Versioned master-key encryption for stored webhook secrets

anvil should support storing one webhook secret per provider per project in ProjectDO SQLite using the same application-level encryption model.

Recommended v1 design:

- use the same master-key versioning strategy as encrypted repository tokens
- encrypt the webhook secret before writing it to `project_webhooks`
- store ciphertext plus the key version and nonce/IV alongside the webhook row
- decrypt only in the Worker-owned webhook verification path before invoking `ProjectDO` acceptance RPC

Suggested storage fields per encrypted webhook secret:

- `secret_ciphertext`
- `secret_key_version`
- `secret_nonce`

### 23.2 Public edge protection

- all public routes under `/api/public/*`
- single WAF rate limit rule on that prefix
- login and webhook ingress share the same outer rate limit boundary

### 23.3 Authorization

- KV authenticates session identity
- D1 authorizes project ownership in v1
- the Worker authenticates and authorizes both private API requests and public webhook requests before invoking Durable Objects
- ProjectDO and RunDO enforce only trusted RPC invariants and object-local state transitions
- private API requests carry the opaque session identifier explicitly rather than relying on browser cookies
- WebSocket log streaming is authorized by short-lived best-effort single-use KV ticket after D1 ownership verification

### 23.4 Invite-only onboarding

v1 is invite-only.

Recommended D1 table:

- `invites`
  - hashed invite token
  - inviter user id
  - expiry
  - accepted by user id
  - accepted at

v1 invite semantics:

- any registered user may generate an invite link
- invite links carry a simple opaque token
- the stored database value should be a hash of that token, not the raw token itself
- only a valid invite token allows a new user record to be created in v1
- v1 does not impose per-user invite caps or invite-specific application rate limits beyond normal authenticated route protections

## 24. Recommended implementation order

Implementation should be split into separate backend and frontend tracks.
Each phase should deliver a coherent product slice and minimize dependencies on unfinished work in other phases.

### 24.1 Backend

#### Backend Phase 1: foundation and access control

- repo skeleton
- shared contracts under `src/contracts`
- `.anvil.yml` schema
- D1 schema + Drizzle setup
- canonical ID generator and prefix conventions
- structured logger foundation
- KV session helper
- login route
- private auth middleware
- invite generation and invite acceptance flow

#### Backend Phase 2: project management API

- `GET /api/private/me`
- `GET /api/private/projects`
- `POST /api/private/projects`
- `PATCH /api/private/projects/:projectId`
- D1 read and primary session helpers
- project ownership checks in D1
- repository URL validation
- `config_path` validation
- encrypted repository token storage in D1

#### Backend Phase 3: manual run execution MVP

- `ProjectDO` schema and project-local coordination state
- accepted-run ledger and FIFO queue logic
- minimal `RunDO` schema for run metadata, steps, and rolling logs
- `GET /api/private/projects/:projectId`
- `GET /api/private/projects/:projectId/runs`
- `GET /api/private/runs/:runId`
- `POST /api/private/projects/:projectId/runs`
- queue message contract and queue consumer
- platform runner image and `docker/runner.Dockerfile`
- Sandbox runner
- repository checkout flow
- repository config parsing and validation
- D1 `run_index` creation and terminal update reconciliation

#### Backend Phase 4: live run control and recovery

- `POST /api/private/runs/:runId/cancel`
- `POST /api/private/runs/:runId/log-ticket`
- authenticated WebSocket upgrade flow for `GET /api/private/runs/:runId/logs`
- `RunDO` WebSocket Hibernation implementation
- rolling tail replay for newly attached viewers
- active-run heartbeat updates from the queue consumer
- `ProjectDO` watchdog recovery for stale active runs
- queue dispatch retry and stale delivery handling
- D1 sync retry for accepted and terminal runs
- cancel flow for pending and active runs

#### Backend Phase 5: webhook automation

- `GET /api/private/projects/:projectId/webhooks`
- `PUT /api/private/projects/:projectId/webhooks/:provider`
- `POST /api/private/projects/:projectId/webhooks/:provider/rotate-secret`
- `DELETE /api/private/projects/:projectId/webhooks/:provider`
- `ProjectDO` webhook configuration and encrypted secret storage
- public webhook ingress route
- provider-specific verification adapters for GitHub, GitLab, and Gitea
- webhook delivery dedupe
- default-branch push trigger policy

### 24.2 Frontend

Frontend work should begin as soon as the corresponding backend slice exposes stable contracts and routes.
The frontend track does not need to wait for the entire backend track to be complete.

#### Frontend Phase 1: app shell and project management

- app shell and route structure
- frontend auth wrapper using `localStorage`
- typed API wrapper consuming shared contracts
- frontend D1 bookmark wrapper using `localStorage`
- login page
- projects list page
- create project page

#### Frontend Phase 2: project operations

- project detail page
- recent runs list
- manual trigger run action
- polling-based run status refresh
- project metadata display for repository URL, default branch, and config path
- queue and active-run summary display

#### Frontend Phase 3: live run UX

- run detail page
- live log panel
- reconnecting log stream client
- cancel run action
- run state presentation for active, canceling, canceled, failed, and passed runs

#### Frontend Phase 4: webhook settings

- webhook settings UI
- webhook provider summary display
- secret rotation and provider enablement flows

## 25. Open questions intentionally deferred

- session rotation policy on privileged operations
- whether logout should blacklist old sessions beyond KV delete
- exact R2 retention policy when archives are added
- whether Workflows should replace the queue consumer or sit above it
- whether local password auth will remain mandatory once OAuth/SAML arrive

## 26. Summary

anvil v1 should be built around a simple but strong architecture:

- **KV** for short-lived session state
- **D1** for relational control-plane data
- **ProjectDO** for project-local coordination, accepted-run reconciliation, FIFO run queue, and webhook config
- **RunDO** for hot run state and log fanout
- **WebSocket Hibernation** as the default log-stream transport
- **Queue + Sandbox** for execution on a platform-owned runner image
- **repo-defined config** from `.anvil.yml`

This design keeps each Cloudflare product aligned with the kind of state it handles best, while leaving clean extension points for Workflows, R2 log archiving, and artifacts later.

