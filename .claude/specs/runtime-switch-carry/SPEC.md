# Runtime Switch Carry-Over — SPEC

**Ticket:** #625 (`bakin runtime migrate`) — **reframed.** The standalone migrate verb is dead:
`switchRuntime` (P3.1, PR #630) already does snapshot → flip → `reconcileRoster` → drift-gated
sync, and `roster-reconcile.ts` names #625 as the seam its follow-ups slot into. This spec is
the slimmed scope: make `bakin runtime use` carry everything a user actually expects, preview
it honestly before committing, and never pretend something carried that didn't.

## Objective

A user who has run Bakin on OpenClaw for months switches to Pi with one command and:

1. **keeps their agents' memory** — workspace content (SOUL self-edits, `memory/*.md`, notes
   outside managed blocks) carries onto the target; today it is silently lost;
2. **can preview the whole switch first** — `--dry-run` reports what will carry, what won't,
   and whether the target is even usable (credentials) — with **zero writes anywhere**;
3. **is told the truth about what stays behind** — channels, runtime crons, runtime session
   context, provider-private config — as explicit report lines, not discovered breakage.

No new orchestrator, no parallel verb, no shims. One engine (`switchRuntime`) grows three
capabilities; everything else is reuse.

## Decisions

| # | Decision |
|---|----------|
| D1 | **No `runtime migrate` verb.** Extend `runtime use` / `switchRuntime`. #625 closes via this work with a reframing comment. |
| D2 | **Workspace carry is default-on, carried-only, and KIND-AWARE.** For agents the switch itself creates (`carried`): canonical root files (SOUL/IDENTITY/AGENTS/TOOLS) and memory files copy verbatim via the workspace-file surface; **skills carry via the adapter-neutral `runtime.skills` surface** (`skills.list` on source → `skills.write` on target) so they land where the target runtime actually reads skills (OpenClaw `skills/<name>/` vs Pi `.pi/skills/`) — never as dead workspace files at the source's paths. Package-managed skills (with an `installedBy` marker) are skipped: the sync phase re-projects them adapter-appropriately and collision-safely. `existing` target agents are never touched (reported as skipped). `--no-copy-workspaces` opts out of the whole content carry. |
| D3 | **Dry-run is strictly zero-write on Bakin's part.** `POST /api/runtime/switch { target, dryRun: true }` / `bakin runtime use <t> --dry-run`. No settings flip, no backup file, no deprovision, no config/roster/workspace writes anywhere. One scoped exception, empirically pinned: probing an OpenClaw target shells its CLI, which lazily materializes its own INTERNAL state (`.openclaw/state/`, `.openclaw/identity/`) on any first read — the same lazy init a `bakin check` triggers. |
| D4 | **Pi seeding moves out of `initialize()`.** `seedMainAgentIfEmpty` relocates to Pi's `provisionToolAccess()` (currently a no-op). Boot / install / switch all call provision, so seeding still happens on every supported path; a bare `initialize` becomes write-free for BOTH adapters (conformance-pinned). |
| D5 | **OpenClaw `listWorkspaceFiles` becomes recursive** (parity with Pi, which walks the tree). Non-recursive enumeration would silently drop `memory/*.md` — the single most important thing to carry. Conformance-pinned. |
| D6 | **`subagentModel` carries.** Same catalog-mapping rule as `model` (exact id → unique bare match → reported, never guessed); applied via `agents.update()` post-create since `CreateRuntimeAgentInput` doesn't accept it. |
| D7 | **Can't-carry report = capability diff + counts.** Line items derived from `capabilities()` comparison (`channels`, `cron` presence) with best-effort counts from optional source surfaces; ONE honest line for adapter-private config; runtime session context gets a "chats keep transcripts, agent context resets" line. Never deep-enumerates provider config. |
| D8 | **Credential preflight.** Dry-run AND real-switch reports include the target's `credentialStatus()` — carrying a whole roster onto a runtime with no provider auth is the #1 "seemingly lost everything" trap. |
| D9 | **Copy failures degrade, never roll back.** Workspace carry runs post-flip; a failed file copy is a reported warning on a completed switch (consistent with "a dead source doesn't block leaving"). |
| D10 | **Workspace content snapshots pre-teardown**, alongside the roster snapshot (source adapter is shut down after that phase). Unreadable source ⇒ carry nothing, report honestly. |
| D11 | **`.userEdited` / projections: no new machinery.** Raw copy is verbatim (sidecars included); the existing sync phase recomposes managed blocks (tool-access re-renders for the target) and surfaces sentinel conflicts per existing semantics — never silently reclaimed. |
| D12 | **Doctor hint dropped.** Every supported switch path carries automatically; hand-editing `settings.runtime.adapter` is unsupported (documented in the knowledge doc). |

## Shape

### Pipeline (real switch)

```
validate → backup → snapshot-roster (+ snapshot workspace content)
→ deprovision → flip → initialize → provision
→ reconcile-roster (model + subagentModel mapping)
→ carry-workspaces   ← NEW phase: write snapshot files for `carried` agents only
→ sync-agents (drift-gated; recomposes managed blocks incl. tool-access)
→ validate-capabilities (+ credentialStatus + can't-carry lines)
```

### Pipeline (dry-run)

```
validate → construct secondary target adapter (write-free initialize; never setAppServices,
never provision) → compute preview (roster diff, model/subagentModel mapping, workspace
file counts+bytes, capability-diff can't-carry, target credentialStatus) → shutdown the
secondary instance → return report
```

The secondary-construction helper is the issue's "read-only secondary instantiation path":
`createRuntimeAdapter(name)` is already a pure non-singleton factory; the helper assembles
`AdapterInitOpts` the same way `createAppServices` does, without registering the instance.

### Report shape (extends `RuntimeSwitchResult`)

```ts
dryRun?: boolean
workspaces: {
  carried: Array<{ agentId: string; files: number; bytes: number }>
  skills: Array<{ agentId: string; carried: number; skippedPackageManaged: number }>
  skippedExisting: string[]                          // agents present on target — untouched
  failed: Array<{ agentId: string; path: string; error: string }>
} | null
cantCarry: Array<{ concern: 'channels' | 'cron' | 'sessions' | 'provider-config';
                   detail: string; count?: number }> | null
credentials: RuntimeCredentialStatus | null           // target's, both modes
```

`RosterCarryReport.unmappedModels` entries gain `field: 'model' | 'subagentModel'`.

### Surfaces

- **REST:** `POST /api/runtime/switch` body grows `{ dryRun?: boolean, copyWorkspaces?: boolean }`.
- **CLI:** `bakin runtime use <adapter> [--dry-run] [--no-copy-workspaces]`; report rendering
  in `src/cli/commands/runtime.ts` (carried/existing/unmapped, workspace counts, can't-carry
  lines, credential warning).
- **UI (`/runtime` page):** displays the extended report fields as returned; no new
  interactions in scope beyond rendering what the endpoint returns.

## End-user carry matrix (documented output of this work)

| Concern | Fate on switch | Mechanism |
|---|---|---|
| Tasks/projects/workflows/schedules/assets/brands/chat transcripts/audit/usage history/avatars/heartbeats | Carries automatically | Bakin-owned, `~/.bakin` untouched; agent ids preserved |
| Agent roster (id/name/role/metadata) | Carries | `reconcileRoster` |
| Models + subagent models | Carries when mappable; reported when not | catalog mapping, never fabricated |
| Agent workspace content (memory, soul edits, notes) | **Carries (this spec)** for switch-created agents | `carry-workspaces` phase |
| Agent-authored skills (no package marker) | **Carries (this spec)** to the target's real skill location | `runtime.skills` surface |
| Package-managed skills / managed blocks / tool-access wording | Recomposed for target | existing drift-gated sync |
| Channels config (e.g. Discord on OpenClaw) | Stays behind — reported | capability diff line |
| Runtime cron jobs | Stay behind — reported with count | capability diff line |
| Runtime session context | Resets — reported (chat transcripts persist) | report line |
| Provider-private config / adapter-private metadata keys | Never crosses — one honest line | `PRIVATE_METADATA_KEYS` + report line |

## Testing strategy

- **Unit:** `mapModelToCatalog` for subagent field; can't-carry diff builder; workspace-carry
  logic against mock adapters (carried-only, skip-existing, failure degradation).
- **Integration (runtime-switch):** extend existing switch tests — carry + copy + report;
  dry-run **zero-write teeth test** (temp `BAKIN_HOME`/`PI_HOME`/`OPENCLAW_HOME`; assert
  settings unchanged, no backup created, target home byte-identical after dry-run).
- **Conformance suite** (acceptance gate for all adapters): `initialize()` performs no
  filesystem writes; `listWorkspaceFiles` enumerates recursively (`memory/x.md` visible).
- **CLI:** flag parsing + report rendering snapshots.
- All tests follow CLAUDE.md isolation rules (both content-dir mocks, env-before-import for
  adapter homes, `--isolate`).

## Docs impact (checked, per kickoff)

- `.claude/knowledge/runtime-capabilities.md` — switch section: carry matrix, dry-run,
  workspace carry, "use `runtime use`, never hand-edit settings.json".
- `.claude/knowledge/pi-adapter.md` — seeding now happens at provision, not initialize.
- `CLAUDE.md` — Runtime Capabilities & Switch bullet gains dry-run + workspace-carry.
- `docs/src/content/docs/` — reference/CLI page for `runtime use` flags (confirm exact page
  at plan time).
- `README.md` — no runtime-switch specifics today; expected untouched (verify at plan time).

## Boundaries

**Always:** go through the adapter contract (`agents.*`, `models.*`, `capabilities()`,
`credentialStatus()`) — never provider files directly; never fabricate model ids; report
every non-carry honestly.

**Never:** flip settings or write anything during dry-run; call `provisionToolAccess` on a
dry-run secondary instance; touch `existing` target agents' workspaces; roll back a completed
flip because content copy failed; silently reclaim `.userEdited` files.

**Out of scope:** standalone `migrate` verb; post-hoc re-carry verb (recovery = switch back
and forth; dry-run prevents the blind case); doctor freshly-seeded heuristic; migrating
channels/cron config; deep provider-config enumeration; backwards-compat shims (single-user
machine).

## Commit strategy (checkpoints, refined at plan time)

1. `refactor(adapter-pi): seed main agent at provision time, not initialize` — + conformance test (write-free initialize). Independently green.
2. `fix(adapter-openclaw): enumerate workspace files recursively` — + conformance parity test. Independently green.
3. `feat(core): carry subagentModel through roster reconcile` — unit-tested.
4. `feat(core): workspace content carry phase in runtime switch` — the headline; integration-tested.
5. `feat(core): can't-carry capability diff + credential preflight in switch report`.
6. `feat(runtime): --dry-run preview through switchRuntime, REST, and CLI` — zero-write teeth test.
7. `docs: runtime switch carry-over` — knowledge docs + CLAUDE.md + docs site.

Each commit compiles and passes the full suite — natural rollback points.
