# Anvil Spec Resolutions

Date: 2026-03-18

This file records binding resolutions for ambiguities in [anvil-spec.md](./anvil-spec.md) without editing the base spec in place yet. Until the main spec is reconciled, this file is authoritative for the topics below.

## 1. Authority Boundary For Queueing, D1 Sync, Lock Release, And Queue Advancement

`ProjectDO` is the sole authoritative owner of project-level concurrency, queue mutation, queue dispatch state, D1 reconciliation state, lock release, and queue advancement.

The Worker and queue consumer may only:

- call `ProjectDO` RPCs to accept work, claim work, report terminal results, request cancellation, record heartbeats, or kick reconciliation
- act as delivery hints or execution agents around `ProjectDO`

They must not independently mutate durable queue state or D1 run-summary state as an authoritative source of truth.

## 2. Public Status Mapping For Accepted Runs

`pending` and `executable` are internal `ProjectDO` queue states only.

Public APIs, `RunDO`, and D1 `run_index` use only the canonical public run status enum:

- `queued`
- `starting`
- `running`
- `cancel_requested`
- `canceling`
- `passed`
- `failed`
- `canceled`

Both internal `pending` and internal `executable` map to public `queued`.
Queue-local ordering is exposed separately through project queue summaries rather than through a separate public run status.

## 3. Source Revision A Run Executes

### Webhook-triggered runs

Webhook-triggered runs execute the exact commit SHA from the verified provider event.

- the canonical accepted snapshot for webhook runs includes `commit_sha`
- queue delay must not change the revision that executes

### Manual runs

Manual runs execute the branch head as resolved when the queue consumer starts execution.

- manual acceptance does not pin a commit SHA up front
- `commit_sha` may be `null` at acceptance time
- after checkout resolves `HEAD`, the queue consumer backfills the actual checked-out `commit_sha` immediately
- this backfilled SHA must be propagated to `ProjectDO`, `RunDO`, and D1 `run_index`
- this backfilled SHA is metadata describing what ran; it is not an acceptance-time execution pin

## 4. `position` Semantics In The Per-Project FIFO Queue

`project_runs.position` is a queued-only stable ordering token.

- it is assigned when a run is accepted into the per-project queue
- it is monotonically increasing within a project while rows remain queued
- it is not renumbered after cancellation, promotion, or terminalization
- gaps are allowed
- it is `NULL` once a run is no longer in queued state
- FIFO promotion uses ascending non-null `position`

This means `position` is not a mutable "live index" that is continuously compacted.

## 5. Proof Required Before Promoting The Next Run

`ProjectDO` may promote the next queued run only after one of these conditions is true:

1. the queue consumer has completed teardown for the active run and reported terminalization back to `ProjectDO`
2. `ProjectDO` has declared the runner lost during stale-heartbeat recovery and has taken over terminalization itself

Operationally:

- the normal path is queue-consumer cleanup, sandbox/session teardown, terminalization, then promotion
- the recovery path is watchdog takeover after stale heartbeat, terminalization as `runner_lost` or the recovered terminal state, then promotion

The system does not require a positive sandbox acknowledgment in the watchdog recovery path before advancing the queue.

## 6. Idempotent D1 Reconciliation Algorithm

D1 reconciliation is `upsert current truth by run_id`.

### `d1_sync_status` values in v1

- `needs_create`
- `current`
- `needs_update`
- `needs_terminal_update`
- `done`

### Allowed `d1_sync_status` transitions

- `needs_create -> current`
- `needs_create -> needs_update`
- `needs_create -> needs_terminal_update`
- `current -> needs_update`
- `current -> needs_terminal_update`
- `needs_update -> current`
- `needs_update -> needs_terminal_update`
- `needs_terminal_update -> done`

`done` is a terminal D1 sync state. No transition out of `done` is permitted.

### Create sync

When `d1_sync_status = needs_create`, `ProjectDO` upserts a queued row into D1 using the best current run truth.

### Metadata sync

When `d1_sync_status = needs_update`, `ProjectDO` upserts the current non-terminal run truth into D1.

This status exists because a run's metadata may change after initial D1 creation but before terminal completion. The primary case is commit SHA backfill for manual runs (see Resolution 3): the queue consumer resolves the checked-out `HEAD` and records it back to `ProjectDO`, which must propagate the updated `commit_sha` to D1.

### Terminal sync

When `d1_sync_status = needs_terminal_update`, `ProjectDO` upserts the terminal row into D1 using the latest terminal truth from `ProjectDO` and `RunDO`.

### Required properties

- retries replay the same upsert behavior and are safe
- `needs_create -> needs_terminal_update` is valid and means a run became terminal before the initial D1 row was confirmed
- `needs_create -> needs_update` is valid and means metadata changed before the initial D1 row was confirmed; the metadata sync path uses the same upsert and will create the row
- a terminal run may therefore be reconciled by an initial queued upsert followed by a terminal upsert
- unique-key conflicts on `run_id` are resolved by the upsert, not by ad hoc insert-then-update branching
- a non-terminal D1 upsert must not regress a row that is already terminal in D1; the upsert must guard `status`, `started_at`, `finished_at`, and `exit_code` with a conditional that preserves existing terminal values
- `commit_sha` must use `COALESCE` semantics: a non-null value already in D1 is never overwritten with null

## 7. Queue Capacity Limit And Overflow Behavior

The per-project cap remains 20 accepted queued runs.

### Manual triggers

- if the project already has 20 accepted queued runs, the private API returns `409 project_queue_full`

### Verified webhook triggers

- if the project already has 20 accepted queued runs, the public webhook route returns `429`
- the verified delivery is recorded with outcome `queue_full`
- later duplicate deliveries with the same `(project_id, provider, delivery_id)` within the 72-hour dedupe window do not re-evaluate capacity, do not create a run, and return `2xx`
- the stored delivery outcome remains `queue_full` for audit and UI purposes

#### Addendum: provider conflict resolution for `queue_full` webhook deliveries (2026-03-22)

This addendum supersedes the four bullets above and the generic duplicate-replay rule below for the specific case where a verified delivery reaches project queue capacity.

- `queue_full` is treated as a temporary receiver failure, not a terminal governance result.
- the public webhook route returns `503 Service Unavailable`
- the response includes `Retry-After: 60`
- `429` is reserved for edge or rate-limit style throttling, not per-project queue exhaustion after webhook verification succeeds
- the verified delivery is still recorded durably with stored outcome `queue_full`
- a later delivery with the same `(project_id, provider, delivery_id)` may be re-evaluated while the stored outcome is `queue_full`
- if a later retry is accepted, anvil updates the stored row to `accepted` and attaches the resulting `runId`
- all other stored outcomes remain terminal within the 72-hour dedupe window and must replay without reprocessing

Rationale:

- GitLab documents that webhook receivers should use `4xx` only for misconfigured webhooks and `5xx` for temporary receiver failures; GitLab may permanently disable `4xx` receivers but only temporarily back off `5xx` failures
- GitHub documents that failed webhook deliveries are not redelivered automatically, but failures can be redelivered manually or through the API; using `503` still expresses temporary capacity exhaustion more accurately than a permanent-looking `4xx`
- for v1, anvil prefers one consistent cross-provider contract for temporary queue exhaustion: return `503`, keep the delivery id stable, and allow a later resend to settle the durable result

References:

- GitLab webhook receiver requirements and delivery headers: https://docs.gitlab.com/user/project/integrations/webhooks/
- GitHub failed delivery handling and webhook best practices: https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries and https://docs.github.com/webhooks/using-webhooks/best-practices-for-using-webhooks

## 8. Canonical Webhook Normalization Contract

Backend Phase 5 must use one canonical normalized payload before invoking `ProjectDO` acceptance logic.

The canonical payload must include at least:

- `provider`
- `deliveryId`
- normalized event kind
- raw provider event name
- `repositoryUrl`
- raw `ref`
- normalized `branch`
- `commitSha`
- `beforeSha` when the provider supplies it

This payload is the cross-provider contract for GitHub, GitLab, and Gitea.

## 9. Webhook Dedupe Semantics

Only verified webhook deliveries are written to the dedupe ledger.

All verified deliveries must be recorded in `project_webhook_deliveries`, not only deliveries that create runs.

The dedupe ledger must support explicit reason-specific stored outcomes, with a small normalized enum such as:

- `accepted`
- `ignored_ping`
- `ignored_event`
- `ignored_branch`
- `queue_full`

The implementation may additionally classify an inbound request as a duplicate at handling time, but it must preserve the originally recorded stored outcome for that delivery ID rather than overwriting it with `duplicate`.

Required behavior:

- dedupe is keyed by `(project_id, provider, delivery_id)`
- retention remains 72 hours
- ping/test events, filtered non-default-branch pushes, duplicates, and queue-full no-ops are recorded
- if a delivery was already recorded, duplicate handling replays the previously decided durable result rather than reprocessing the event

## 10. Webhook CRUD And Rotation Contract

The webhook configuration API uses a simple secure upsert model.

### `PUT /api/private/projects/:projectId/webhooks/:provider`

- create the provider row when it does not exist, or update `enabled` / provider `config` when it already exists
- on create:
  - request body provides `enabled`
  - request body may provide a plaintext secret
  - if no secret is provided, Worker generates one and returns it exactly once in the create response
- on update:
  - request body may change `enabled`
  - request body may change provider `config` when applicable
  - request body must not include `secret`
  - inline secret replacement is rejected; secret changes use `rotate-secret`

### Disabled rows

- disabling a webhook does not delete its stored encrypted secret
- disabled rows retain secret material until rotated or deleted

### `DELETE /api/private/projects/:projectId/webhooks/:provider`

- hard-delete the webhook row and encrypted secret material

### `POST /api/private/projects/:projectId/webhooks/:provider/rotate-secret`

- generate and persist a new secret
- return the new plaintext secret exactly once in the response
- there is no overlap window where both old and new secrets verify

## 11. Webhook Secret Custody And Verification Boundary

`ProjectDO` owns durable custody of webhook verification material.

This includes:

- encrypted-at-rest storage
- enablement state
- rotation state
- dedupe and post-verification governance decisions

The Worker owns ephemeral cryptographic use of webhook secrets at public ingress.

Required behavior:

- `ProjectDO` stores webhook secrets only in encrypted form
- Worker loads the minimal encrypted verification material from `ProjectDO`
- Worker decrypts the secret in memory
- Worker verifies the raw provider request using the provider signature scheme
- Worker does not persist plaintext webhook secret material
- after verification succeeds, Worker calls `ProjectDO` with only verified normalized payload

Rationale:

- this keeps durable secret custody with the project-local actor
- it keeps raw-request authentication at the Worker edge boundary where headers, body, WAF protection, and provider-specific ingress handling already live
- it avoids serializing decrypt-and-verify work inside `ProjectDO` for every webhook delivery

## Default Implementation Notes

Until the main spec is updated:

- treat this file as authoritative for queue, run, and webhook contract decisions covered above
- prefer the current `ProjectDO`/`RunDO` implementation model where it already matches these resolutions
