# Pi Runtime Parity — Implementation Plan

Status: FOR REVIEW
Spec: `.claude/specs/pi-parity/SPEC.md` (v3 + §12 user stories)
Date: 2026-07-12
Grounding: two deep code-mapping passes (agent-packages engine; attention/
routing/switch surfaces) — every task below names real files.

## Dependency graph

```
P1 secrets/env foundation
 ├──> P2 capability packs (needs named secrets + env injection + ~/.bakin/bin PATH)
 │     └──> P4 runtime hub Capabilities tab (needs P2 readiness API)
 │     └──> P2.7 bits pack (needs P2 engine)
 ├──> (nothing else blocks on P1)
P3 task-completion tail — independent of P1/P2 except none
 ├─ T3.1 approval attention   (independent)
 ├─ T3.2 subagent decision    (independent)
 ├─ T3.3 gh readiness         (independent)
 ├─ T3.4 cron adoption        (independent)
 └─ T3.5 pin/fixture tests    (independent)
P4 runtime hub — Overview/Switch tabs independent; Capabilities tab needs P2
P5 docs & battery — needs all
```

P3 can proceed in parallel with P1/P2 if desired; the plan orders it after P2
to keep one PR in flight at a time (single-operator box).

## Key code facts the plan builds on (from exploration)

- Manifest already has `secrets?: SecretDeclarationSchema[]`
  (`packages/core/src/agent-packages/manifest.ts:44-48`) — parsed, never
  enforced. P1/P2 wire it instead of inventing a new field.
- Manifest already has pinned external deps:
  `dependencies.skills[{source, ref}]` with single-level resolution
  (`dependency-resolver.ts`) — this IS the upstream pin for capability packs;
  no new `upstream` schema needed (provenance shown from the dependency).
- Skill projection already flows through `runtime.skills.write`
  (`projector.ts:337-406`) — runtime-neutral by construction.
- Binary installer model: `packages/adapter-antfly/src/installer.ts`
  (download → sha256 vs pin → verify-then-commit → atomic rename) + pin
  shape `packages/adapter-antfly/src/pin.ts`.
- Pi turns inherit the Bakin server's `process.env` (no env seam in
  `packages/adapter-pi/src/messaging.ts`) — so PATH + secret env injection
  happen once at server boot.
- Explore installs skill-packs via `POST /api/packages/install` already
  (`plugins/explore/components/install-dialog.tsx:44-46`).
- Nav-badge pattern: `nav-badge-providers` slot + `useNavBadge` +
  `usePluginEvent`; chat's `attention.ts` is the pure-logic model; workflows
  has `GET /gates/pending` + `workflow.gate_reached` SSE already.
- Cron snapshot must happen in the switch's `snapshot-roster` phase (source
  runtime is torn down before any later phase); per-job adoption precedent:
  `plugins/schedule/lib/routes/jobs.ts:188-274`; idempotent creation:
  `ensureBakinJob` (`job-service.ts:64`).

## Open questions for review (blocking only their own tasks)

- **OQ1 (T3.2) — subagent model on Pi.** Exploration finding: Bakin
  decomposition turns already route via origin policy
  (`src/core/model-routing.ts`) on BOTH runtimes; `subagentModel` only
  drives OpenClaw's native internal sub-agent spawning, which Pi doesn't
  have. Implementing D9 as written would store a dead field and flip
  `perAgentSubagentModel` dishonestly. **Recommendation:** re-scope D9 to
  round-trip preservation — store the carried value in the Pi registry
  (metadata), keep the support flag `false` (honest), and make
  `roster-reconcile` restore it when switching back to a runtime that
  honors it (today OpenClaw→Pi→OpenClaw silently drops it). Per-agent
  subagent-model *routing* stays an OpenClaw-native feature; Bakin-side
  per-agent granularity, if ever wanted, belongs in the models plugin's
  origin policy — not the adapter.
- **OQ2 (T1.1) — existing secrets.json.** Store shape changes from
  `{providers: {id: {apiKey}}}` to named secrets. No-shims rule, but this
  box has a live antfly password stored. Plan: the new zod schema ACCEPTS
  the old inner shape (it's a valid `Record<string,string>` already —
  `{apiKey: "..."}`), so no migration code at all; just widen the schema.
- **OQ3 (T2.3) — where capability readiness checks live.** Options: health
  plugin `system-checks/` (precedent for system-level checks) vs a new
  checks file registered by the explore plugin. Plan assumes health
  `system-checks/capabilities.ts` (capability readiness is system state,
  not storefront state).

---

## Phase P1 — Integration secrets & env foundation

Branch `feat/integration-secrets`. PR #1. Rollback: revert PR (no consumers
outside this PR yet).

### T1.1 Named secrets in the secret store
- **Files:** `packages/core/src/media/secret-store.ts` (schema:
  `providers: Record<providerId, Record<secretName, string>>` — old
  `{apiKey}` entries are already valid instances; keep
  `getStoredProviderKey/setStoredProviderKey` as thin `apiKey`-name wrappers
  so images/antfly callers compile unchanged), new
  `get/set/unset/listStoredSecrets(provider)`; name validation same slug
  rules as provider ids.
- **AC:** old-shape file loads unchanged; named get/set/unset round-trip;
  0600 + atomic write preserved; `listStoredSecrets` returns names only.
- **Verify:** `bun test tests/core/secret-store.test.ts --isolate` (extend
  existing suite); full suite green.
- **Commit:** `feat(secrets): named secrets per provider in the secret store`

### T1.2 Masked REST + Integrations & Keys UI
- **Files:** `packages/host/src/api/secrets.ts` (GET returns
  `{provider: [names]}`; POST `{provider, name, value}`; DELETE
  `?provider&name`; zod), `src/components/provider-keys-tab.tsx` →
  generalize to Integrations & Keys (per-integration rows: source =
  env / store / missing; add/replace/remove named secrets; values never
  rendered).
- **AC:** RTL: add key → masked row appears; env-configured shows
  read-only "env" source; delete works. API never returns values.
- **Commit:** `feat(secrets): named-secret REST surface + Integrations & Keys tab`

### T1.3 Boot env + PATH injection
- **Files:** new `src/core/secret-env.ts` — `injectIntegrationEnv()`:
  for each installed pack's declared `secrets[]` (lockfile → manifest read)
  plus a static map, `process.env[VAR] ??= storedValue` (unset-only, env
  always wins); `ensureBakinBinOnPath()` prepends `~/.bakin/bin` (new
  `getBakinPaths().bin`) to `process.env.PATH` if absent. Called from
  `server.ts` boot AFTER singleton lock, BEFORE dispatch/services start.
  NOT in `createAppServices()` (read-only CLI paths must not mutate env).
- **AC:** unit: unset-only precedence; PATH idempotent (no dup segments);
  server boot order test-pinned by unit on the helper (not a boot e2e).
- **Commit:** `feat(core): boot-time integration env + bakin bin PATH injection`

**Phase gate:** full suite green; on the live box, set a dummy named secret
via UI and confirm masked round-trip.

---

## Phase P2 — Capability packs

Branch `feat/capability-packs`. PR #2. Rollback: revert PR — agent-packages
returns to content-only installs; catalog entries disappear.

### T2.1 Manifest + catalog schema extensions (pure)
- **Files:** `packages/core/src/agent-packages/manifest.ts` —
  `SkillPackManifestSchema` gains `capability?: slug`,
  `runtimes?: string[]` (default `['*']`),
  `requires?: { bins?: BinRequirementSchema[] }` where a bin =
  `{ name, version, install: Record<platformKey, {url, sha256}>,
  verifyArgs?: string[] }`; extend `SecretDeclarationSchema` with
  `secretSlot?: 'provider.name'` + `help?: url`.
  `src/core/curated-catalog/schema.ts` — `CatalogEntrySchema` gains
  `capability?`, `runtimes?` (facet data only).
- **AC:** zod round-trips; invalid platform keys / non-sha256 rejected;
  old manifests still parse (all new fields optional).
- **Commit:** `feat(packages): capability-pack manifest + catalog schema (requires/capability/runtimes)`

### T2.2 Pinned binary installer
- **Files:** new `src/core/agent-packages/bin-installer.ts` (modeled on
  `packages/adapter-antfly/src/installer.ts`: fetch with timeout → sha256
  verify against manifest pin → verify-then-commit via `verifyArgs` run →
  atomic rename into `getBakinPaths().bin`); wire into
  `src/core/agent-packages/installer.ts` after projection (step 8.5);
  lockfile records `ProjectionKind 'bin'` +
  `PROJECTION_KIND_POLICY.bin` (`packages/core/src/agent-packages/lockfile.ts`)
  — not seedOnce, removed on uninstall when no other package references the
  same bin name; `unprojectPackage` removes it.
- **AC:** integration test (temp `BAKIN_HOME`, local `Bun.serve` fixture
  serving a fake binary): install → bin present + 0755 + verified;
  checksum mismatch → install fails WITH full rollback (no partial bin,
  lockfile restored); uninstall removes bin; two packs sharing a bin →
  survives first uninstall.
- **Commit:** `feat(packages): pinned sha256-verified binary installs to ~/.bakin/bin`

### T2.3 Capability readiness engine + doctor + CLI check
- **Files:** new `src/core/agent-packages/capability-readiness.ts` —
  `listCapabilities(): {slug, packId, content: ok|drifted|missing,
  bins: per-bin ok|missing, secrets: per-secret env|store|missing,
  ready: boolean}` (content via lockfile projections + `runtime.skills.get`;
  bins via `existsSync` in bakin bin + PATH; secrets via env-or-store);
  REST `GET /api/packages/capabilities`
  (`packages/host/src/api/packages/`); doctor check
  `plugins/health/lib/system-checks/capabilities.ts` (OQ3) with
  per-capability findings + remediation strings; CLI
  `bakin check capabilities` (`src/cli/commands/onboarding.ts` map).
- **AC:** readiness transitions test: none → content-only → +bin → +key ⇒
  ready; each intermediate state names exactly what's missing; doctor warn
  carries remediation.
- **Commit:** `feat(packages): capability readiness engine + doctor check + bakin check capabilities`

### T2.4 CLI install UX (story 3)
- **Files:** `src/cli/commands/packages.ts` — catalog-name resolution
  (`bakin packages install web-search-brave` → curated catalog lookup via
  `staticCuratedCatalog()`/`loadUnifiedCatalog()` → `sourceWithRef`),
  consent prompt (source, pinned ref, bins, secrets), per-step ✓/⚠ output,
  inline secret prompt (TTY) with skip; non-TTY → skip with notice.
- **AC:** e2e on temp home (spawned CLI against a test server): name
  resolves, github: sources still work, consent declined = no writes,
  key skipped ⇒ readiness reports missing key.
- **Commit:** `feat(cli): catalog-name capability installs with consent + guided key prompt`

### T2.5 Explore Capabilities shelf + install-dialog key step (story 2)
- **Files:** `plugins/explore/components/explore-page.tsx` (Capabilities
  tab/shelf, runtime-compat badge from `runtimes` vs active adapter —
  active adapter from `GET /api/runtime/capabilities`),
  `catalog-card.tsx`/`detail-drawer.tsx` (capability metadata: upstream
  dependency source + pin, requires list), `install-dialog.tsx` (post-
  install needs[] step: secret input → `POST /api/secrets`, bin progress);
  install REST response extended with `needs` (missing secrets/bins)
  in `packages/host/src/api/packages/install.ts`.
- **AC:** RTL: shelf renders from catalog fixture; incompatible runtime
  badge disables install with reason; install flow reaches Ready; key-skip
  leaves honest "needs key" state. Explore stays the ONLY UI install path.
- **Commit:** `feat(explore): capabilities shelf + guided key step in install flow`

### T2.6 Onboarding recommendation (story 1)
- **Files:** new `src/core/onboarding/recommended-capabilities.ts`
  (mirrors `recommended-agents.ts`: filter catalog `capability` entries,
  trust official; install via `installPackage`), register in
  `src/core/onboarding/index.ts` + CLI map; skippable; key entry deferred
  to Settings with printed pointer (escape hatch per story 1).
- **AC:** onboarding component check/install unit tests (temp home);
  `--yes` path installs without prompt and reports "needs key".
- **Commit:** `feat(onboarding): recommended capability packs component`

### T2.7 The web-search-brave pack (bits repo) + live cutover
- **Where:** `bakin-bits-official` repo — `packs/web-search-brave/`
  (`bakin-package.json`: kind skill-pack, capability web-search,
  `dependencies.skills: [{source: github:badlogic/pi-skills#brave-search…}]`
  — DECISION: pin the bx-CLI-based skill CONTENT we authored for the spike
  (adapted SKILL.md, honest-failure rules) as the pack's own skill, with
  `requires.bins.bx` (brave-search-cli release URLs + sha256 per platform)
  + `secrets: [{name: BRAVE_SEARCH_API_KEY, secretSlot: brave.apiKey}]`;
  the pi-skills node-script variant needs npm install at runtime — the bx
  binary route has zero runtime deps and matches OpenClaw's bx-search),
  catalog entry in `packages/host/src/data/curated-catalog.json`.
- **Live cutover on this box:** remove the hand-dropped spike skill
  (`~/.pi/agent/skills/bx-search/`), install the pack through the real
  flow, re-run the spike task, update memory.
- **AC = spec acceptance 1-4** on the dev rig with a CLEAN home (no bx, no
  key): full story-1/2/3 flow → dispatched research task completes.
- **Commit(s):** bits repo commit + `feat(catalog): web-search-brave capability pack entry`

**Phase gate:** rig-clean-home validation recorded; full suite green.

---

## Phase P3 — Task-completion tail

Branch `feat/pi-task-parity`. PR #3. Tasks independently revertable commits.

### T3.1 Pending-approval attention (story 6)
- **Files:** `plugins/workflows/components/approvals-badge-provider.tsx`
  (new; pattern: `plugins/chat/components/chat-badge-provider.tsx` +
  `plugins/tasks/hooks/use-task-summary.ts`): fetch `GET /gates/pending`,
  subscribe `workflow.gate_reached` / `workflow.gate_approved` /
  `workflow.gate_rejected` via `usePluginEvent`, `useNavBadge('workflows',
  <navItemId>, {count, tone: 'attention'})`, toast + `sendBrowserNotification`
  deep-linking the gate; pure logic in
  `plugins/workflows/components/attention.ts` (suppress while viewing the
  gate; mirrors chat `attention.ts`); register slot in
  `plugins/workflows/client.tsx` + `contributes.slots` in
  `plugins/workflows/bakin-plugin.json`.
- **AC:** pure-logic unit tests (badge math, suppression); RTL: gate_reached
  ⇒ badge+toast; resolve ⇒ badge clears. Works with zero channel layer.
- **Commit:** `feat(workflows): pending-approval attention via nav badge + notifications`

### T3.2 Subagent model — per OQ1 decision (default: preservation scope)
- **Files (preservation scope):** `packages/adapter-pi/src/registry.ts`
  (optional `subagentModel` field, storage-only),
  `agents.ts` update accepts + stores it WITHOUT flipping
  `routingSupport().perAgentSubagentModel` (stays false — Pi never honors
  it; contract doc comment states storage-for-carry semantics),
  `src/core/roster-reconcile.ts` — carry stores the value on Pi targets and
  restores it to honoring targets on the way back; report line changes from
  "unmapped/dropped" to "preserved (not active on pi)".
- **AC:** switch round-trip test OpenClaw→Pi→OpenClaw retains
  subagentModel; dry-run reports "preserved"; conformance capability-honesty
  unaffected.
- **Commit:** `feat(adapter-pi): preserve subagent-model assignments across runtime switches`

### T3.3 gh readiness + context guidance
- **Files:** `plugins/health/lib/system-checks/github-readiness.ts` (gh on
  PATH + `gh auth status` exit code, warn-only, remediation text);
  guidance line in the Bakin-shipped role context defaults
  (`team-context-defaults.ts` — locate: `src/core/team-context.ts` imports)
  teaching worktree tools + gh + ask-before-push/merge.
- **AC:** check unit test (mock execFile); context byte-fixture updated
  deliberately (the fixture test will flag the byte change — commit updates
  it in the same change).
- **Commit:** `feat(health): github readiness check + agent context guidance`

### T3.4 Switch-time OpenClaw cron adoption (story 7)
- **Files:** `src/core/switch-report.ts` — snapshot captures full
  `source.cron.list()` jobs (not just count) during `snapshot-roster`;
  `src/core/runtime-switch.ts` — new `adopt-cron` phase after
  `reconcile-roster` (real + dry-run preview), gated by
  `SwitchRuntimeOptions.adoptCron?: boolean` +
  `RuntimeSwitchRequestSchema.adoptCron?`; creation via schedule plugin's
  `ensureBakinJob` semantics with `source: 'adopted'` +
  `originalRuntimeCron.snapshot` (invoke through the existing
  `schedule.*` hook surface — core must not import plugin code; add a
  `schedule.adoptCronJobs` hook in `plugins/schedule/index.ts` mirroring
  the REST adopt handler at `lib/routes/jobs.ts:188`);
  `RuntimeSwitchResult.cron = { adopted, skipped, failed }`; cantCarry cron
  line reflects adoption; CLI flag `bakin runtime use <t> --adopt-cron`;
  dry-run prints the would-adopt list.
- **AC:** switch e2e extension: source with 2 cron jobs → dry-run lists
  them; real switch with `adoptCron` creates 2 Bakin schedules (source
  'adopted', originals snapshotted) exactly-once (re-run idempotent via
  logicalJobId); without the flag behavior unchanged.
- **Commit:** `feat(runtime): opt-in cron adoption into Bakin schedules during switch`

### T3.5 Pin & fixture tests
- **Files:** `tests/adapter-pi/session-settings.test.ts` (assert the
  settings manager the adapter builds reports compaction enabled — pins the
  SDK default against silent flips); dispatch-prompt fixture assertion that
  schedule exec tools are present in the rendered tool catalog
  (`tests/fixtures/dispatch-prompts/` harness).
- **AC:** both tests fail if the guarantee regresses (teeth verified by
  temporary inversion during development).
- **Commit:** `test(pi): pin compaction default + schedule-tools dispatch context`

**Phase gate:** full suite green; live: trigger a real gate on the box and
observe badge + toast + OS notification.

---

## Phase P4 — Runtime hub UX

Branch `feat/runtime-hub`. PR #4. Rollback: revert PR (P2/P3 APIs remain).
Load `frontend-design` guidance before building; polish bar = explore/
health/chat.

### T4.1 Hub shell + Overview tab
- **Files:** `packages/host/src/routes/runtime.tsx` rebuilt: `PluginHeader`
  + `UnderlineTabs` (Overview/Capabilities/Switch, URL-backed via
  `useQueryState('tab')`), per-section independent fetch/fault (health-page
  pattern), `Skeleton` loading, `ErrorBanner`. Overview: adapter identity
  `Card` (name, version, credential tiles from `credentialStatus`),
  capability cards with mode `Badge` + plain-language legend, tool-access
  status; delivery-unavailable copy per story 7. Keep/extend `data-testid`
  (`runtime-summary`, `onboarding-status`).
- **AC:** RTL: renders from fixture report; legend present; error + loading
  states; existing runtime-page tests migrated.
- **Commit:** `feat(host): runtime hub shell + overview tab on the SDK kit`

### T4.2 Capabilities tab
- **Files:** same route + a `capabilities-tab.tsx` component: rows from
  `GET /api/packages/capabilities` (readiness chips per content/bin/key,
  remediation links → Settings Integrations & Keys / reinstall), EmptyState
  with "browse capabilities" → Explore. No install UI here (story 2
  decision).
- **AC:** RTL: ready/needs-key/missing-bin fixtures render distinct states
  with working links.
- **Commit:** `feat(host): runtime hub capabilities tab with readiness chips`

### T4.3 Switch tab
- **Files:** `switch-tab.tsx`: target pickers, dry-run-by-default preview
  (roster mapping, workspaces, stays-behind, credentials, would-adopt cron
  list + adopt checkbox), `ConfirmDialog` for the real switch, live
  `runtime:switch` SSE progress steps (reuse `reduceSwitchProgress`),
  result as grouped Cards (carried / warnings / failed) — no glyph prose;
  restart-required banner.
- **AC:** RTL over `reduceSwitchProgress` fixtures + result grouping;
  `switch-progress`/`switch-result` testids preserved; e2e switch test
  still green.
- **Commit:** `feat(host): guided switch tab with dry-run preview + grouped results`

**Phase gate:** visual review on the live box (screenshots in PR); full
suite green.

---

## Phase P5 — Docs, battery, close-out

Branch `chore/pi-parity-docs`. PR #5.

### T5.1 Knowledge + docs
- New `.claude/knowledge/capability-packs.md`; update `agent-packages.md`
  (manifest extensions, taxonomy §4.1 rules), `pi-adapter.md`,
  `runtime-capabilities.md`, `adapter-architecture.md`,
  `bakin-owned-scheduler.md`, `doctor-and-health-checks.md`,
  `explore-plugin.md`; extending docs decision table (plugin vs capability
  pack vs agent + coupling/composition rules); `CLAUDE.md` deltas; README /
  Astro CLI docs if command surfaces changed.
- **AC:** docs-check tooling green (`bakin docs` checks if applicable);
  knowledge docs match shipped behavior (spot-verified against tests).

### T5.2 Task-parity battery (spec acceptance 8)
- Dispatch on this box: research (web search via the productized pack),
  image generate+edit, agent-self-scheduled recurring task, gated workflow
  approved via in-app attention, subagent fan-out. Record results (asset +
  PR body). Any failure ⇒ fix-forward task before merge.

### T5.3 Close-out
- Memory updates (`pi-parity-initiative`, live-box state); spec status →
  SHIPPED with deltas noted; file follow-up issues for reserved lanes
  (Discord bridge, extension trust) + fast-follow packs (browser-tools,
  transcribe, youtube-transcript).

---

## Commit strategy summary

- One branch/PR per phase (P1→P5), merged in order; main shippable after
  each merge; rollback = `git revert -m1 <merge>` of that phase's PR.
- Within a phase: one commit per task (listed above), each green on
  `bun run test` before the next task starts; conventional-commit messages
  as specified per task.
- Worktrees for branch work (standing memory: main checkout flips branches
  under you); verify HEAD before every commit.
- Bits-repo changes (T2.7) are separate commits in `bakin-bits-official`
  with a plugin/pack version bump per bits conventions, cross-referenced in
  the P2 PR body.
- Live-box validation results recorded in each PR body (P2 rig validation,
  P3 gate attention, P5 battery).

## Verification matrix (phase gates)

| Gate | Proof |
|---|---|
| P1 | suite green; masked named-secret round-trip on live box |
| P2 | suite green; CLEAN-home rig install → dispatched research task completes (stories 1–4); readiness transitions test |
| P3 | suite green; live gate ⇒ badge/toast/OS notification; switch e2e with cron adoption |
| P4 | suite green; RTL for all three tabs; visual review screenshots |
| P5 | battery 5/5 recorded; docs merged; follow-ups filed |
