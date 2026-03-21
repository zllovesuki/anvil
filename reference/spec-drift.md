# Spec Drift

This document records places where the current anvil implementation differs from
`reference/anvil-spec.md`. Each section describes the behavior that exists in
code today so future spec updates can converge on the implementation, or the
implementation can be brought back to the spec intentionally.

## Projects

### Current implementation

Project storage is split across D1 and `ProjectDO`.

- D1 stores a `project_index` row for each project. This is the owner-scoped
  lookup and authorization surface used by private project routes and public
  webhook routing.
- `ProjectDO` stores the mutable project record in `project_config`, the
  project-local coordination state in `project_state`, the accepted run ledger
  in `project_runs`, and webhook state in `project_webhooks` and
  `project_webhook_deliveries`.
- Encrypted repository tokens are stored in `ProjectDO.project_config`, not in
  D1.

The Worker currently handles project lifecycle this way:

- Create flow writes the D1 `project_index` row first, then immediately calls
  `ProjectDO.initializeProject(...)` to create the durable project config. If
  DO initialization fails, the Worker deletes the D1 row as compensation.
- Update flow sends the mutation to `ProjectDO.updateProjectConfig(...)` first.
  That updates `project_config`, marks
  `project_state.project_index_sync_status = "needs_update"`, and relies on the
  ProjectDO alarm reconciliation loop to copy the replicated fields back into
  D1 `project_index`.
- Project list reads come entirely from D1 `project_index`, with
  `lastRunStatus` derived from D1 `run_index`.
- Project detail reads are merged reads: D1 provides ownership and the indexed
  project row, `ProjectDO` provides current config and queue state, and `RunDO`
  provides active-run summary data when there is an active run.
- Public webhook ingress resolves `(ownerSlug, projectSlug)` through D1
  `project_index`, then loads webhook verification material and project webhook
  ingress state from `ProjectDO`.

This means the current implementation is intentionally eventually consistent for
project metadata:

- Project detail can show freshly updated `ProjectDO` config before D1
  reconciliation updates the project list view.
- Authorization and public slug routing still depend on D1, but mutable project
  config is owned by `ProjectDO`.

`ProjectDO` is authoritative by design. The implementation uses that boundary to
avoid a cross-store "distributed transaction" model between the Worker, D1, and
Durable Objects. The Worker authorizes and routes through D1, but the mutable
project decision and state transition happen in `ProjectDO`, with D1 updated
later through reconciliation.

### Drift from `reference/anvil-spec.md`

The current implementation differs from the spec in several important ways.

#### D1 schema and source of truth

The spec describes a D1 `projects` table that contains the canonical project
record, including mutable project metadata and encrypted repository token
fields.

The implementation instead uses:

- D1 `project_index` as an owner-scoped index and read model
- `ProjectDO.project_config` as the mutable project configuration record
- `ProjectDO.project_state` as the durable project coordination record

This shifts the source of truth for mutable project configuration from D1 to
`ProjectDO`.

That is not just an implementation convenience. It is the mechanism that avoids
trying to coordinate a "distributed transaction" across Worker request logic,
D1, and `ProjectDO`, which does not fit anvil's runtime model.

#### Repository token storage

The spec says encrypted repository tokens live in the D1 project row.

The implementation stores encrypted repository token fields in
`ProjectDO.project_config`, alongside the rest of the mutable project config.

#### Project creation lifecycle

The spec says project creation inserts the D1 project row and that `ProjectDO`
is created lazily on first use.

The implementation initializes `ProjectDO` during project creation and treats
that DO state as required. The Worker compensates by deleting the D1
`project_index` row if `initializeProject(...)` fails.

#### Project update and read model

The spec implies a more direct D1-backed project record for reads and writes.

The implementation uses a split read/write model:

- writes go to `ProjectDO` first
- D1 `project_index` is updated asynchronously by ProjectDO reconciliation
- detail reads merge D1, `ProjectDO`, and `RunDO`
- list reads remain D1-backed and may lag behind detail after updates

This is a meaningful behavioral difference because project metadata is not read
from a single durable store in real time.

#### Webhook routing boundary

The spec is directionally correct that public slug lookup remains in D1 and
webhook config remains project-local, but the current implementation depends on
that split more broadly than the spec currently describes:

- D1 is the stable public/project identity index
- `ProjectDO` is the live owner of webhook verification material and mutable
  project webhook ingress state
- repo URL, default branch, and config path used for webhook acceptance are
  read from `ProjectDO`, not from D1

### Relevant implementation surfaces

- `src/worker/db/d1/schema/projects.ts`
- `src/worker/db/d1/repositories/projects.ts`
- `src/worker/api/private/projects/write-handlers.ts`
- `src/worker/api/private/projects/read-handlers.ts`
- `src/worker/durable/project-do/project-config.ts`
- `src/worker/durable/project-do/reconciliation/d1-sync.ts`
- `src/worker/api/public/webhooks/handler.ts`
