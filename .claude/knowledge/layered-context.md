# Layered Context & Agent Sync

Deep dive on the composed-block model that owns every agent's Bakin-managed
workspace content. Spec: `.claude/specs/layered-context-and-agent-sync.md`
(+ companion plan). Supersedes the deleted `src/core/agent-rules/` system,
template seeding, lesson-marker projections, and the `adopted` state.

## The model in one paragraph

Every workspace file (`SOUL.md`, `AGENTS.md`, `IDENTITY.md`, `TOOLS.md`)
carries at most ONE Bakin-managed block (`<!-- bakin:managed:start/end -->`).
Inside the block, Bakin is authoritative and rewrites freely on sync; outside
it, the file belongs to the agent and is never touched. The block's body is
COMPOSED from layers: global context + role context (orchestrator/subagent) +
team context (AGENTS.md only) + the package's workspace template + lessons
(SOUL.md only). Drift detection is a sha comparison between the expected
composition and what's actually in the block, attributed per input.

## Layers

| Layer | Source | Applies to | Files |
|---|---|---|---|
| global | `~/.bakin/team/context/global.md` | every runtime agent | AGENTS.md |
| role | `~/.bakin/team/context/roles/{orchestrator,subagent}.md` | main / everyone else | AGENTS.md |
| tool-access | rendered LIVE from the active runtime (`describeToolAccess()` → `renderToolAccessInstructions`, `src/core/tool-access.ts`) | every runtime agent | AGENTS.md |
| team | `~/.bakin/team/context/<teamId>.md` | `OrgTeam` members (via `team.getAgentTeam` hook) | AGENTS.md |
| package | installed source `workspace/*` templates | managed agents | all four |
| lessons | installed source `lessons/*.md` + lockfile `lessonsEnabled` | managed agents | SOUL.md |

- The tool-access layer is NOT a file: it renders per-runtime (in-process /
  native-MCP / cli-shim wording) at compose time, and the lockfile records a
  `toolAccessSha` so a runtime switch surfaces as `tool-access`-attributed
  drift (`bakin agents sync` repairs it). Role defaults + shipped content are
  transport-neutral by architecture test — they name `bakin_exec_*` tools but
  never the invocation mechanism.
- Context files are plain markdown, user-owned, with `{{agentId}}`,
  `{{agentName}}`, `{{mainAgentId}}`, `{{mainAgentName}}` tokens substituted
  per-agent at composition time.
- Role files use the SAME block pattern fractally: Bakin's shipped default
  rules (`src/core/team-context-defaults.ts` — relocated from the old
  agent-rules constants) live inside a managed block that binary updates
  refresh; user additions outside it are preserved. global/team files are
  wholly user-owned.
- Composition flattens context files: block markers + HTML comments are
  stripped (`effectiveContextContent`), so nesting never corrupts the agent
  file's outer block, and authoring guidance comments never reach agents.
- "Unmanaged" means no *package* — unmanaged agents (including `main`) still
  get the global/role/team block in AGENTS.md.

## Key modules

- `packages/core/src/agent-packages/composer.ts` — pure, deterministic
  composition (`composeManagedBlock`, `composeFileContent`); one section
  label per layer (`<!-- bakin-section: ... -->`, readability-only).
- `src/core/team-context.ts` — layer file paths, seeding, role-block
  refresh, token substitution, membership via HookRegistry.
- `src/core/agent-packages/sync-scanner.ts` — read-only expected-state
  derivation + drift findings with per-input attribution (`block-stale`
  carries `staleInputs: ['global'|'role'|'team'|'package'|'lessons'|
  'in-place-edit']`).
- `src/core/agent-packages/sync.ts` — the engine behind every surface:
  optional upstream fetch → reclaim → local re-projection → verify →
  receipt. `--check` is structurally write-free. `syncPack` covers
  standalone packs.
- `src/core/agent-packages/receipts.ts` — latest receipt per agent at
  `~/.bakin/packages/receipts/<agentId>.json`; audit.jsonl is history.
- `src/core/agent-packages/migration.ts` — one-time, confirmed, idempotent
  full-overwrite migration (tarball backup to `~/.bakin/.backups/` first).
- `src/core/agent-packages/post-sync-reload.ts` — restart-free effect:
  re-runs `loadAgentPackageSources()`, clears the workflows skill cache,
  broadcasts `agent_pkg:changed` SSE.

## Surfaces

- CLI: `bakin agents sync [id] [--check] [--reclaim <t>|--reclaim-all]
  [--yes]`, `bakin packages sync <id> [--check]`, `bakin check/install
  agent-sync`. Legacy `agents update`, `--refresh-template`, and
  `bakin agent-rules` are deleted.
- REST: `POST /api/agent-packages/:agentId/sync` (409 + `migrationRequired`
  on legacy lockfiles), `GET /:agentId/receipt`, `POST
  /api/agent-packages/migrate`, `POST /api/packages/:packageId/sync`; team
  plugin: `GET/PUT /api/plugins/team/context[/:scope?id=]`, `POST
  /api/plugins/team/teams/:teamId/sync`.
- Doctor: `team.agent-sync` (local-only, every cycle) with a repair handler
  — safe local-sync item + destructive confirm-required migration item.
  Replaced `team.agent-assets`, `health.orchestrator-rules`,
  `health.managed-blocks`.

## Invariants

- Doctor/scanner never touch the network; upstream checks are user-initiated.
- Sync rewrites blocks unconditionally (package-owned); `.userEdited`
  sentinels apply to skills/assets only, skipped loudly with a reclaim hint,
  cleared only via the confirmed `--reclaim` path.
- Pre-migration lockfile shapes (`templateOnly` / `lesson-marker` /
  workspace entries without `composedSha`) refuse to sync
  (`MigrationRequiredError`) — composing into un-migrated files would
  duplicate template content.
- Composition must stay deterministic: same inputs → identical bytes.
  Lockfile workspace projections record `composedSha` + per-input shas.
- Package authors write PLAIN markdown templates — markers are projection
  machinery, never authoring syntax.

## Live drift surfacing (#385)

Beyond the cron'd `team.agent-sync` doctor check, drift is surfaced live:

- `GET /api/agent-packages/{agentId}/scan` — read-only single-agent scan
  (full `scanAgentSync()` filtered by `agentId`/owning `packageId`, the
  `verifyAgent` pattern). Zero writes, no upstream fetch.
- The Team agent-detail **Diagnostics tab** renders those findings (per-file,
  per-input `staleInputs` attribution, `.userEdited` locks with reclaim hints)
  with a Sync-now button over the existing sync POST + receipt display.
- The previously dead `'drifted'` package badge state is now assigned from
  canonical Health incidents whose structured resources include the agent ID
  (the agent-sync check attaches per-bucket agent resources). Fresh where
  you're looking (tab scan), cheap where you're not (canonical report cache).

Deep dive: `.claude/knowledge/agent-health-diagnostics.md`.
