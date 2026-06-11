# Spec: Layered Context Blocks & Agent Sync

## Status

Draft (2026-06-10). Interview complete; awaiting plan
(`.claude/specs/layered-context-and-agent-sync-plan.md`, to be written next).

Related issues:

- #401: Make Bakin Bits agent sync visible and one-click repairable

Related repos (content work lands there in follow-up PRs after the mechanism
ships in bakin):

- `markhayden/bakin-bits-official` — public agent kits
- `markhayden/bakin-bits-official-private` — private agent kits
- In-repo `agents/` — reference agent packages

## Problem

After a Bakin binary update or agent-package update, the user cannot tell
whether their agents are actually current. `bakin agents update` preserves
workspace templates by design, so SOUL.md / lesson blocks / managed AGENTS.md
rules silently go stale while the user believes they updated. Getting fully
current requires a scattered ritual (`agents update`, `--refresh-template`,
`agent-rules --apply-all`, `doctor --full`, `restart`, hand-removing
`.userEdited` sentinels) that nothing documents end-to-end.

The root cause is architectural: package-owned content and agent-owned content
share whole files with no boundary, so updates must choose between destructive
overwrite and silent staleness. Everything downstream (drift detection, repair,
reporting) is hard because that boundary doesn't exist.

## Decisions (from design interview, 2026-06-10)

1. **Upstream (network) checks are user-initiated only** — per-agent, from UI
   or CLI. Doctor never fetches over the network.
2. **Doctor runs all local checks proactively** every cycle, absorbing and
   extending the existing `team.agent-assets` check. No regression in coverage.
3. **All Bakin/package-managed workspace content lives inside one composed
   `bakin` marker block per file.** Agent free-form content lives outside the
   block and is never touched. The projector composes and injects blocks;
   package authors write plain markdown (no markers in package sources).
4. **Concepts stay visually separate inside the composed block** via labeled,
   non-semantic section separators. Only the outer block carries lifecycle
   semantics.
5. **Migration is a full overwrite** of every agent's workspace files with
   freshly composed content. No preservation of prior agent edits. Migration is
   an explicit, confirmed, one-time action (not silently run by doctor).
6. **`bakin agents sync [agentId]` replaces `bakin agents update`** (deleted,
   not aliased). `--refresh-template` and `bakin agent-rules --apply-all` are
   deleted. `--check` does detection + report only. The check/repair onboarding
   pair is renamed `bakin check agent-sync` / `bakin install agent-sync`.
7. **Layered context: global / role / team / individual.**
   - Global: `~/.bakin/team/context/global.md` — applies to every runtime agent.
   - Role (build amendment, C3): `~/.bakin/team/context/roles/{orchestrator,subagent}.md`
     — built-in role layer; orchestrator = main agent, subagent = everyone
     else. Added because Bakin ships TWO distinct rule sets (orchestrator
     rules vs the subagent managed-context sections), not one — global.md
     alone could not express that without changing main's context. Bakin's
     shipped defaults live in the role files' managed blocks; global.md is
     wholly user-owned.
   - Team: `~/.bakin/team/context/<teamId>.md` — applies to members of that
     `OrgTeam` (existing team plugin entity, `AgentDisplaySettings.teamId`;
     resolved via the existing `team.getAgentTeam` hook).
   - Individual: the agent package's workspace templates.
   - Context files support `{{agentId}}`/`{{agentName}}`/`{{mainAgentId}}`/
     `{{mainAgentName}}` tokens and are flattened on composition (block
     markers + HTML comments stripped).
8. **Context files use the same block pattern fractally.** `global.md` = user
   free-form content + a `bakin`-managed block holding Bakin's shipped default
   rules (successor of `ORCHESTRATOR_RULES_CONTENT`, which is deleted from
   `src/core/agent-rules/`). Binary updates refresh that inner block only; user
   content is never touched. Team files: same structure, Bakin ships no team
   block content initially.
9. **Global/team layers inject into AGENTS.md only.** SOUL/IDENTITY/TOOLS are
   individual-only. Extend the composer later if a real case appears.
10. **Global/team blocks apply to ALL runtime agents including unmanaged ones**
    (this preserves today's orchestrator-rules injection into `main`).
    Unmanaged agents get a composed AGENTS.md block with global + team sections
    only; the individual section requires a package. No opt-out policy.
11. **The `adopted` state collapses into `managed`.** Agent states become
    `absent | unmanaged | managed`. `--adopt` survives only as the install-time
    flag "bind package to existing runtime agent instead of creating one".
12. **`.userEdited` sentinels stay, for skills/assets only** (workspace files
    no longer use them — blocks make them moot there). Sync skips sentineled
    files loudly (exact path + reason in receipt). A confirmed reclaim path
    (`bakin agents sync <id> --reclaim [path|--all]`, plus a UI confirm) clears
    sentinels and re-projects.
13. **Sync receipts: last-receipt-only persistence** (one JSON per agent),
    `audit.jsonl` is the historical record. No history UI.
14. **Health UI gets its first repair affordance, built generic**: any check
    whose handler offers repairs shows Repair → plan modal (title, reason,
    safety, changes) → confirm → apply → results, wired to the existing
    two-phase `/doctor/repair/plan` → `/doctor/repair/apply` API. Destructive/
    manual items require explicit confirmation.
15. **Teams become first-class in the team plugin**: team detail page (context
    editor, member sync state, "Sync team" action), Global rendered as a
    pseudo-team at the top of the list, react-flow graph indicators for teams
    with context and stale members.
16. **Standalone packs get minimal symmetry**: `bakin packages update` →
    `bakin packages sync` with the same receipt format and `--check`; covered
    by the same doctor check; no pack-specific UI.
17. **Content diet (scope c)** across bakin-bits-official, -private, and
    in-repo `agents/`: strip global/team-appropriate rules out of individual
    kits, dedupe across workspace files, trim rules to imperative bullets,
    keep big reference content in opt-in lessons. Relevance scoping is achieved
    via the team layer, NOT via new manifest fields.
18. **No backwards compatibility, no shims.** Single-user machine. Old
    mechanisms are deleted, not deprecated.

## Design

### Composed block model

Each workspace file contains at most one Bakin-managed block, using the
existing marker primitive (`packages/core/src/agent-packages/managed-blocks.ts`):

```markdown
<agent free-form content — never touched>

<!-- bakin:managed:start -->
<!-- Managed by Bakin. Do not edit inside this block: it is rewritten on
     sync. Write above/below the block instead. -->

<!-- bakin-section: global -->
...effective content of ~/.bakin/team/context/global.md...

<!-- bakin-section: team:<teamId> -->
...effective content of ~/.bakin/team/context/<teamId>.md...

<!-- bakin-section: package -->
...package workspace template for this file...

<!-- bakin-section: lessons -->
...lesson catalog + enabled lesson bodies (SOUL.md only)...
<!-- bakin:managed:end -->
```

- Outer markers are semantic (lifecycle, drift detection). `bakin-section`
  separators are readability-only; the composer regenerates them.
- Per-file composition recipe:
  - **AGENTS.md**: global + team (if member) + package template. Unmanaged
    agents: global + team only.
  - **SOUL.md**: package template + lesson catalog + enabled lesson bodies.
  - **IDENTITY.md / TOOLS.md**: package template only.
- The block opens with a one-line provenance comment telling agents/humans not
  to write inside it.
- Existing block kinds retired in workspace files: bare seeded templates,
  per-lesson blocks (`bakin:lesson:*`), lesson-catalog block,
  `managed-context` block + its per-section markers. One block kind remains.

### Composition engine

A single pure composer: `composeManagedBlock(file, inputs) -> string`, where
inputs are the resolved layer contents. Deterministic: stable section order,
stable formatting, so `sha256(composed)` is comparable.

- Expected-state derivation: for any agent + file, the composer can produce the
  expected block content from (installed package source, lockfile
  `lessonsEnabled`, global.md, team file, team membership). Drift = expected
  sha vs actual block content sha.
- Lockfile `ProjectionEntry` for workspace files records the composed block
  sha and the input shas (package template, global, team, lessons) so receipts
  can explain *why* something is stale.
- Lesson toggling recomposes the SOUL.md block (no more per-lesson block
  injection); `lessonsEnabled` in the lockfile remains the source of truth.

### Layered context files

- `~/.bakin/team/context/global.md` — seeded at migration with: empty user
  area + a managed block containing the current default orchestrator rules
  content (relocated from `ORCHESTRATOR_RULES_CONTENT`; the constant moves to
  a versioned default-rules module that only writes inside global.md's managed
  block, then `src/core/agent-rules/` is deleted).
- `~/.bakin/team/context/<teamId>.md` — created on demand (when the user first
  adds team context via UI or disk). Absent file = empty team section = omitted
  from composition.
- Editing any layer file makes dependent agents' blocks stale → doctor flags →
  sync recomposes. Binary updates that change default rules make global.md's
  inner block stale → doctor flags/repairs global.md → cascades to agents.

### Sync engine, CLI, receipts

`bakin agents sync [agentId] [--check] [--reclaim <path>|--reclaim-all]`

Sequence (per agent; no agentId = all managed agents + unmanaged agents'
global/team blocks):

1. If managed: fetch upstream for the agent's package (network; the only
   network step). `--check` fetches but applies nothing.
2. Update installed source if commit changed (existing updater flow).
3. Recompose + rewrite all managed blocks unconditionally.
4. Re-project skills/assets; skip `.userEdited` (unless reclaimed).
5. Run the local verification (expected vs actual for every projection).
6. Write receipt + audit events; print receipt.

Receipt (JSON, one per agent, latest only, under
`~/.bakin/packages/receipts/<agentId>.json`):

```jsonc
{
  "agentId": "pixel",
  "syncedAt": "...",
  "package": { "id": "pixel", "versionBefore": "1.2.0", "versionAfter": "1.3.0",
                "commitBefore": "...", "commitAfter": "...", "fetched": true },
  "blocks": [ { "file": "SOUL.md", "action": "recomposed|unchanged",
                 "sections": ["package", "lessons"], "bytes": 1234 } ],
  "skills":  [ { "name": "...", "action": "written|unchanged|skipped",
                 "reason": "userEdited?" } ],
  "assets":  [ ... ],
  "skipped": [ { "path": "...", "reason": "userEdited",
                 "hint": "bakin agents sync pixel --reclaim <path>" } ],
  "verification": { "status": "ok|drift", "findings": [ ... ] }
}
```

CLI deletions: `bakin agents update`, `--refresh-template`,
`bakin agent-rules` (whole command), `bakin packages update` (renamed `sync`).
Onboarding component renamed: `bakin check agent-sync` /
`bakin install agent-sync`.

Sync must take effect without a server restart: any registry holding projected
content (workflows plugin agent-package skill registry, lesson retrieval) must
be refreshed in-process after sync. (Verified during build; if some surface
truly requires restart, the receipt must say so explicitly.)

### Drift detection & doctor

One doctor check `team.agent-sync` (replaces `team.agent-assets`,
`health.orchestrator-rules`, `health.managed-blocks`), local-only, per cycle:

- Per agent + file: managed block missing, or actual block sha ≠ expected
  composed sha (with per-input attribution: package/global/team/lessons).
- Skills/assets: missing, drifted (disk sha ≠ lockfile sha), `.userEdited`
  (reported, never auto-repaired), broken `.installedBy` markers.
- global.md inner managed block ≠ current shipped default rules.
- Lockfile entries with missing installed source dirs.
- Agents predating block-based files → "migration needed" (warn; repair =
  the confirmed migration).

Severities: structural breakage (missing block/file/source) = error; staleness
= warn; `.userEdited` skips = warn with reclaim hint. Repair handler
recomposes blocks + re-projects non-sentineled files (safety: `safe`), and
plans migration/reclaim items as `requiresConfirmation`.

Upstream version drift is NOT a doctor finding; it's reported only by
user-initiated check/sync (`?check=1` REST enrichment stays).

### REST API

- `POST /api/agent-packages/{agentId}/sync` (body: `{ check?, reclaim? }`) —
  replaces `/update`. Returns the receipt.
- `GET /api/agent-packages/{agentId}/receipt` — last receipt.
- Team context CRUD on the team plugin: `GET/PUT
  /api/plugins/team/context/{global|<teamId>}` (user area editable; managed
  block read-only from the UI).
- `POST /api/plugins/team/teams/{teamId}/sync` — sync all members; combined
  receipt.
- Existing `/doctor/repair/plan|apply` unchanged (now exercised by the UI).

### UI

- **Agent detail (team plugin):** sync status badge (from doctor cache +
  on-demand), "Check for updates" (network), "Sync" actions, receipt view
  ("Last synced 2h ago — view receipt").
- **Team detail page (new route):** header (name, color, reports-to, members);
  shared-context editor with visible two-zone ownership (user area editable,
  managed block read-only with provenance); members with sync badges; "Sync
  team" with combined receipt. **Global** appears as a pseudo-team above the
  list (same component; members = all agents).
- **React-flow graph:** indicator on team group nodes that carry context;
  stale-member state (e.g., amber dot); agent nodes get a subtle stale-sync
  dot. Click-through to team/agent detail.
- **Health page:** generic repair flow for any repairable check — Repair →
  plan modal → confirm (destructive items individually confirmed) → apply →
  results.

### Migration (one-time, confirmed)

Triggered explicitly (CLI prompt on first `sync`, or the doctor repair item).
For every runtime agent:

1. Seed `~/.bakin/team/context/global.md` (user area empty + managed rules
   block). Create `context/` dir.
2. Full-overwrite workspace files with freshly composed content (managed
   agents: all four files; unmanaged agents: inject/replace the AGENTS.md
   block only, leaving the rest of their AGENTS.md and other files alone).
3. Rewrite lockfile: collapse `adopted` → `managed`; new projection shape for
   workspace files; drop lesson-marker projection entries.
4. Remove stale `.userEdited` sentinels for workspace files (concept retired
   there).
5. Append audit events; write a migration receipt per agent.

Note (decision 5 nuance): managed agents get the full four-file overwrite.
For unmanaged agents migration only replaces/injects the managed AGENTS.md
block — their files are otherwise not Bakin's to overwrite.

### Deletions (tech debt out)

- `src/core/agent-rules/` (managed-context sections machinery, apply-all CLI,
  `ORCHESTRATOR_RULES_CONTENT` constant — content relocates to the global.md
  seed/default-rules module).
- `cmdAgentPackagesUpdate` + `--refresh-template` paths in updater/projector.
- Per-lesson block injection in projector + `lesson-toggle.ts` block surgery
  (replaced by recomposition).
- `adopted` state handling in `agent-state.ts`, lockfile schema, UI badges.
- `.userEdited` handling for workspace files (kept for skills/assets).
- `health.orchestrator-rules`, `health.managed-blocks`, `team.agent-assets`
  checks (superseded by `team.agent-sync`).
- Template-seeding "fresh vs adopt vs update" workspace-file carve-outs in the
  projector (one composition path remains).

### Content diet (follow-up PRs in content repos)

Principles: one home per concept (identity→IDENTITY, voice→SOUL, operational
rules→AGENTS layers, tool specifics→TOOLS); universal rules move to global.md
defaults; team-ish rules (media delegation, asset rules) move to team context
files; kits keep only agent-specific content; rules as imperative bullets, no
essays; big reference content stays in opt-in lessons; composed-block sizes
reported in receipts/status so bloat stays visible. Applies to
bakin-bits-official, bakin-bits-official-private, and in-repo `agents/`.

## Out of scope

- Proactive upstream version polling of any kind.
- Receipt history UI (audit.jsonl covers history).
- Global/team injection into files other than AGENTS.md.
- Per-section semantic markers inside the composed block.
- New manifest fields for rule scoping.
- Multi-user concerns, backwards compatibility, migration rollback tooling.

## Acceptance criteria (mapped from #401)

1. Doctor reports stale agent/package sync (blocks, skills, assets, context
   layers) as actionable warn/error with per-input attribution — local-only,
   every cycle.
2. Health UI shows the same findings with enough detail for a non-CLI user and
   offers the generic repair flow; destructive/confirm-required items are
   explicit.
3. One sync action per agent (and per team, and fleet-wide) from the UI, with
   a persisted receipt proving exactly what changed.
4. `bakin agents sync` is the single CLI verb; the old ritual commands are
   gone.
5. Skipped `.userEdited` files are listed with exact paths, reasons, and the
   reclaim hint; reclaim requires explicit confirmation.
6. No destructive overwrite without confirmation: steady-state sync only
   rewrites Bakin-owned blocks and package-owned files; the only full-file
   overwrites are the one-time confirmed migration and confirmed reclaims.
7. After sync, changes are live without a server restart (or the receipt says
   otherwise explicitly).
8. Editing global/team context flows to member agents via the same
   stale→sync→receipt loop.

## Testing strategy

- Unit: composer determinism (same inputs → identical bytes/sha); per-file
  recipes; unmanaged-agent recipe; lesson toggle recomposition; receipt
  shapes; expected-vs-actual drift attribution.
- Unit: migration on fixture workspaces (managed, unmanaged-with-rules-block,
  adopted) — full-overwrite results, lockfile rewrite, state collapse.
- Integration (temp-dir, all content-dir + OpenClaw-home mocks per CLAUDE.md
  testing rules): install → edit global.md → doctor flags → sync → doctor
  clean; binary-rules bump → global.md block stale → repair cascade;
  `.userEdited` skip + reclaim; `--check` mutates nothing.
- Plugin tests via `tests/plugins/test-helpers.ts` for new routes + health
  check + repair handler.
- Architecture tests: no imports of deleted modules; `bun:sqlite` and adapter
  boundaries unchanged.

## Documentation impact (required, per kickoff)

- `.claude/knowledge/agent-packages.md` — rewrite projection/update/states
  sections for the block model and sync.
- `.claude/knowledge/doctor-and-health-checks.md` — new check, generic UI
  repair flow.
- `.claude/knowledge/` — new `layered-context.md` (or fold into
  agent-packages.md) covering global/team/individual composition.
- `docs/agent-packages-authoring.md` — authors write plain markdown; what the
  projector does; what moved to global/team layers.
- `CLAUDE.md` — Agent Packages section (states, CLI verbs), Key Patterns
  (agent-rules entry replaced), CLI list (`agent-rules` removed, `sync` verbs).
- `README.md` — only if it mentions update/agent-rules verbs (verify).
- bakin-bits repos: CONTRIBUTING/authoring notes about the slimmed kit shape.

## Boundaries

- **Always:** mock content-dir + OpenClaw home in every test; keep adapter
  boundary (runtime file writes go through the runtime adapter); audit every
  mutation; fail loudly, never silently skip.
- **Ask first:** running the live migration against `~/.bakin` /
  `~/.openclaw`; any push/PR to the bakin-bits repos.
- **Never:** network calls from doctor; editing `~/.openclaw` content by hand
  (agent content lives in bakin-bits-official); writing markers into package
  source templates; new stat-tracking or parallel mechanisms for things that
  exist.
