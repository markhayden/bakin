# Runtime Switch Carry-Over — PLAN

Spec: `./SPEC.md`. Seven tasks, each a vertical slice ending in a green-suite commit
(checkpoint). Branch: `feat/runtime-switch-carry` (worktree — main checkout stays put).

## Dependency graph

```
T1 (pi seed → provision)  ──────────────┐
T2 (openclaw recursive list) ──► T4     ├──► T6 (dry-run: needs write-free init + full report)
T3 (subagentModel carry) ───────────────┤
T4 (workspace carry) ──► T5 (can't-carry + credentials) ──► T6 ──► T7 (docs) ──► T8 (ship)
```

T1/T2/T3 are mutually independent; T4 needs T2 (recursive enumeration or `memory/*.md`
never enters the snapshot); T5 builds on T4's snapshot plumbing; T6 needs everything
(the preview renders the complete report against a write-free target).

## Tasks

### T1 — `refactor(adapter-pi): seed main agent at provision time, not initialize`

Move the `seedMainAgentIfEmpty(opts.logger)` call from `PiRuntimeAdapter.initialize`
(`packages/adapter-pi/src/runtime.ts:48`) into `provisionToolAccess` (`runtime.ts:104`,
currently `async () => {}`). No change to `seedMainAgentIfEmpty` itself.

Why safe: every supported path provisions — server boot (`server.ts:111`), switch
provision/restore/post-carry (`runtime-switch.ts:258/:202/:279`), onboarding install
(`onboarding/openclaw-integration.ts:79`). This also fixes an existing violation of the
stated invariant at `app-services.ts:75-80` ("a read-only CLI path creating app services
must never mutate the runtime").

Known test ripple (enumerated; each gets `await adapter.provisionToolAccess()` after
`initialize`, or its assertion retargeted):
- `tests/adapter-pi/agents.test.ts:47,:57` — the seed assertions themselves (retarget to provision; add "initialize does not seed").
- `tests/integration/runtime-conformance/pi.conformance.test.ts:90` (beforeAll)
- `tests/integration/pi/{turn,chat-on-pi,usage-scan,extensions,images-shim,unsupported-health,config-models-skills,ping-serveability}.test.ts`

New conformance check `initializeIsWriteFree` in
`tests/integration/runtime-conformance/conformance.ts` + teeth branch: construct a fresh
adapter against a pristine temp home, `initialize`, assert the home's file tree is
unchanged (optional `RuntimeConformanceTarget` hook for fresh-construct + home snapshot;
exact hook shape decided at build time). Runs for mock, Pi, OpenClaw targets.

**Accept:** fresh Pi home + `initialize` ⇒ zero files created; `provisionToolAccess`
⇒ `main` seeded exactly once (idempotent). **Verify:** `bun test tests/adapter-pi
tests/integration/runtime-conformance tests/integration/pi --isolate`, then full suite.

### T2 — `fix(adapter-openclaw): enumerate workspace files recursively`

`listWorkspaceFiles` (`packages/adapter-openclaw/src/runtime.ts:426-436`) walks the tree
like Pi's `walkFiles` (`packages/adapter-pi/src/agents.ts:69-76`): relative forward-slash
paths, skip leading-dot entries (Pi's rule; `.installedBy` sidecars are suffix-named, not
dot-led, so they still enumerate — D11 wants them carried verbatim).

New conformance check `workspaceFileEnumerationIsRecursive` + teeth branch: write
`memory/x.md` via `writeWorkspaceFile`, assert `listWorkspaceFiles` surfaces it.

Consumers checked: only `plugins/team/lib/routes/agents.ts:447` (team plugin workspace
view — now complete rather than top-level-only; behavior improvement, eyeball in UI).

**Accept:** OpenClaw agent with `memory/note.md` + `skills/foo/SKILL.md` lists both.
**Verify:** conformance suite all targets + full suite.

### T3 — `feat(core): carry subagentModel through roster reconcile`

In `src/core/roster-reconcile.ts`:
- `RosterCarryReport.unmappedModels` entries gain `field: 'model' | 'subagentModel'`.
- Post-`create`, when the source agent has `subagentModel`: feature-detect
  `target.models.routingSupport().perAgentSubagentModel`; unsupported ⇒ report unmapped
  (`field: 'subagentModel'`, reason in detail); supported ⇒ `mapModelToCatalog`; mapped ⇒
  `agents.update(id, { subagentModel })`; unmapped ⇒ report. Never fabricated.

Unit tests in `tests/core/roster-reconcile.test.ts` (fake adapter grows
`agents.update` + `models.routingSupport`): mapped, unmapped, unsupported-runtime,
update-failure ⇒ `failed[]` honesty.

**Accept:** carried agent on a supporting target gets its mapped subagent model;
everything else is a report line, never a throw. **Verify:** unit file + full suite.

### T4 — `feat(core): workspace content carry phase in runtime switch`

`src/core/runtime-switch.ts`:
- Snapshot phase grows workspace content capture (pre-teardown, alongside roster),
  **kind-aware** (D2):
  - workspace files via `listWorkspaceFiles` + `readWorkspaceFile`, EXCLUDING the
    source's skill-storage subtree (classify via `workspaceFileStats` kinds when the
    adapter provides them — both real adapters do; fall back to carrying all listed
    files when stats are absent);
  - skills via `skills.list(agentId)`, keeping only skills WITHOUT a package
    `installedBy` marker (package-managed ones are the sync phase's job — it re-projects
    them at adapter-appropriate locations, collision-safe);
  - per-agent read failure tolerated (partial snapshot, noted) — a dead source still
    carries nothing gracefully (D10).
- New `SwitchPhase` `'carry-workspaces'` between `reconcile-roster` and `sync-agents`:
  for `roster.carried` agents only (D2): `writeWorkspaceFile` each snapshot file
  verbatim (sidecars included, D11) and `skills.write(skill, agentId)` each carried
  skill — landing where the TARGET runtime reads skills (`.pi/skills/` vs
  `skills/<name>/`), not at the source's dead paths. Adapter path-guard rejections and
  write failures land in `workspaces.failed[]` and never fail the switch (D9).
- `SwitchRuntimeOptions.copyWorkspaces?: boolean` (default true);
  `RuntimeSwitchResult.workspaces: { carried: [{agentId, files, bytes}],
  skills: [{agentId, carried, skippedPackageManaged}], skippedExisting: string[],
  failed: [{agentId, path, error}] } | null`.
- Managed-block correctness is free: the existing `sync-agents` phase recomposes
  tool-access for the target and surfaces `.userEdited` conflicts (D11) — assert, don't build.

Integration tests (`tests/integration/runtime-switch.test.ts` pattern: real adapters,
temp homes, env-before-import): seed OpenClaw `main` with `SOUL.md` (content outside a
managed block) + `memory/note.md` + one agent-authored skill + one package-marked skill;
switch → SOUL/memory exist in Pi's workspace byte-identical, the agent-authored skill
exists via Pi's `skills.get` (at Pi's location), the package-marked skill was skipped
(sync re-projects it), no stray `skills/` files in Pi's workspace; `existing` target
agents untouched; `copyWorkspaces: false` skips with `workspaces: null` (or empty —
decide at build, report shape honest either way); injected write failure degrades to
`failed[]` with `ok: true`.

**Accept:** SPEC acceptance #1 headline — agent memory AND agent-authored skills
survive the switch; the agent's summary page (canonical/skill/memory stats) shows the
same identity files on Pi it showed on OpenClaw.
**Verify:** integration file + full suite.

### T5 — `feat(core): can't-carry capability diff + credential preflight`

- Pure builder (in `src/core/roster-reconcile.ts` or sibling `switch-report.ts` — one
  module, no new orchestrator): inputs = source capability presence snapshot (captured
  pre-teardown: `capabilities()`, `channels?.` presence + best-effort count,
  `cron?.` presence + best-effort job count) and target `capabilities()`. Output =
  `cantCarry: [{concern: 'channels'|'cron'|'sessions'|'provider-config', detail, count?}]`
  per SPEC D7 (sessions + provider-config lines always emitted on a switch).
- `validate-capabilities` phase also captures `result.credentials =
  await newRuntime.credentialStatus()` (D8); failure degrades to `null` + log, never
  fails the switch.

Unit tests for the builder (channels-on-source/absent-on-target, cron counts, count
fetch failure ⇒ line without count); integration asserts populated `cantCarry` +
`credentials` on the OpenClaw→Pi switch.

**Accept:** switching OpenClaw→Pi reports channels + cron stay behind, session-context
reset, provider-config line, and Pi's credential status. **Verify:** unit + integration + full suite.

### T6 — `feat(runtime): --dry-run preview through switchRuntime, REST, CLI, UI`

- `reconcileRoster` gains a `dryRun` mode (same function, no parallel logic): classifies
  would-carry/existing/unmapped (incl. subagentModel) without `create`/`update` calls.
- Secondary target construction in `runtime-switch.ts`: `createRuntimeAdapter(target)` +
  `initialize` with opts mirroring `app-services.ts:60-88` (`contentDir`, logger, audit →
  `appendAudit`, `settings.runtime.settings` — same blob a real flip would hand it,
  `execTools`, `bakinMcpBaseUrl`); NEVER `setAppServices`, NEVER `provisionToolAccess`;
  `shutdown()` in finally.
- `switchRuntime(target, { dryRun: true })` short-circuits: validate (same-target still
  rejected) → snapshot source (roster + workspace file counts/bytes + capability
  presence) → construct secondary target → dry reconcile + workspace preview + cantCarry
  + `credentialStatus` → teardown → `{ ok, dryRun: true, ... }` with zero writes (no
  backup, no flip, no deprovision, `restartRequired: false`).
- REST (`request-handler.ts:242`): parse `dryRun`/`copyWorkspaces` booleans, thread.
- CLI (`src/cli/commands/runtime.ts`): `bakin runtime use <t> [--dry-run]
  [--no-copy-workspaces]` via `args.includes(...)` (repo convention); render workspaces /
  cantCarry / credentials / subagent-unmapped sections + a "dry run — nothing was
  changed" banner. Net-new CLI test file for flag parsing + rendering.
- UI (`packages/host/src/routes/runtime.tsx:27-49,283-319`): extend the inline result
  type + render the three new blocks after the roster block. Render-only (SPEC).

**Zero-write teeth test** (integration, temp homes): capture full recursive
`BAKIN_HOME` + `PI_HOME` + `OPENCLAW_HOME` tree+bytes → dry-run OpenClaw→Pi → assert
trees byte-identical, no `.backups/` entry, settings unchanged, report populated
(roster preview + workspaces preview + cantCarry + credentials).

**Accept:** SPEC acceptance #1 (dry-run) verbatim. **Verify:** teeth test + CLI test + full suite.

### T7 — `docs: runtime switch carry-over`

- `.claude/knowledge/runtime-capabilities.md` — switch section: end-user carry matrix
  (from SPEC), dry-run, workspace carry, "always `bakin runtime use`, never hand-edit
  `settings.runtime.adapter`" (D12 rationale).
- `.claude/knowledge/pi-adapter.md` — seeding happens at provision, not initialize.
- `CLAUDE.md` — Runtime Capabilities & Switch bullet: dry-run + workspace carry, one line.
- `src/core/cli/registry.ts:58-65` — `runtime` entry usage/examples gain the flags
  (regenerates `docs/reference/generated/cli.mdx`; run the docs generator if scripted).
- `README.md` — checked at spec time: no runtime-switch specifics; untouched.

**Verify:** knowledge docs match shipped behavior (re-read diff against code); docs build if applicable.

### T8 — ship

PR `feat(runtime): switch carry-over — workspace content, dry-run, honest can't-carry
(#625)`; body maps commits → SPEC decisions; `Closes #625` + a reframing comment on the
issue (migrate verb dropped — switchRuntime is the one engine; what shipped instead).
Delete worktree after merge.

## Commit strategy (checkpoints)

One commit per task T1–T7, conventional scope as titled above. Each commit: compiles,
`bun run test` green, self-contained (revertable without stranding a half-feature).
T1/T2 are deliberately first — they're the standalone adapter fixes with the widest test
ripple; if anything forces a rollback later, the fixes stand on their own. No fixup
squashing across task boundaries.

## Risks & mitigations

1. **T1 test ripple** (~10 files rely on seed-at-initialize) — enumerated above; mechanical
   `provisionToolAccess()` insertions; conformance suite proves the new contract.
2. **reconcileRoster dry-run mode** — single function with a mode flag, unit-pinned both
   modes; the danger to avoid is a parallel preview implementation drifting from the real one.
3. **Cross-adapter path guards** (Pi traversal check, OpenClaw `isSafeWorkspaceFile`) may
   reject carried paths — by design they land in `workspaces.failed[]` (D9), tested explicitly.
4. **Secondary adapter settings blob**: dry-run hands the target `settings.runtime.settings`
   exactly as a real flip would (the flip doesn't rewrite it either) — consistent, noted in code.
5. **Conformance hook shape** for write-free-initialize needs a fresh-construct hook; decided
   at build time inside the existing target-recipe pattern, teeth branch mandatory.
