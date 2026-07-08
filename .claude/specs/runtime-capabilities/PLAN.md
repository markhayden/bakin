# Implementation Plan: Runtime Capability Foundation

Companion to [SPEC.md](./SPEC.md) + [SPIKE-RESULT.md](./SPIKE-RESULT.md) (Phase 0 PASS).
Branch: `feat/tool-access-neutral` off `feat/adapter-pi`. One commit per task, each leaves the tree green (`bun run test` + typecheck). Checkpoints α–ε are the rollback lines.

## Overview

Give the adapter contract a uniform capability + provisioning model (native/shimmed/unavailable), move all runtime-specific provisioning into adapters, delete mcporter, make runtime-switching a first-class reversible operation, and retrofit images as the second conformant capability. Foundation for N runtimes (OpenClaw 1, Pi 2, Hermes 3, +).

## Dependency graph

```
Phase 0 spike (DONE) ─ gates mcporter deletion
   │
Phase 1 Foundation ── CapabilitySet + RuntimeToolAccess (P1.1)
   │  ├─ renderer (P1.2) ──────────────┐
   │  ├─ provisioning lifecycle (P1.3) │
   │  ├─ delete mcporter (P1.4) ◄───── needs P1.3 (provisioning relocated first)
   │  ├─ neutral role defaults + inject + unify authors (P1.5) ◄── needs P1.2
   │  ├─ lockfile runtime + doctor (P1.6) ◄── needs P1.5
   │  └─ content guard (P1.7) ◄── needs P1.5 (leaks fixed first)
   │        ══ Checkpoint α ══
Phase 2 Contract cleanup ── channels/cron optional (P2.1) ; credentialStatus (P2.2)
   │  ├─ models rewire (P2.3) ┐
   │  ├─ team rewire (P2.4)   ├─ all before → delete config member (P2.5)
   │  └─ main literal (P2.6)  │
   │        ══ Checkpoint β ══
Phase 3 Runtime switch ── orchestrator (P3.1) → CLI+REST (P3.2) → UI page (P3.3) → integ (P3.4)
   │        ══ Checkpoint γ ══
Phase 4 Images retrofit (P4.1)        ══ Checkpoint δ ══
Phase 5 Docs + bits + live validation (P5.1-3)   ══ Checkpoint ε (merge gate) ══
```

Bottom-up: contract types first, then the pieces that consume them. Riskiest early inside each phase (provisioning relocation P1.3, config deletion P2.5).

---

## Phase 1 — Foundation

### P1.0 — Decouple the app-services composition root (ratchet out the #624 allowlist)
**Description:** Split the globalThis-backed accessors (`getAppServices`/`maybeGetAppServices`/`setAppServices`) out of `src/core/app-services.ts` into a leaf `app-services-store.ts` (type-only `AppServices` import). Repoint every consumer that only READS services to the leaf so nothing imports the composition root just for a services read. Remove the 7 exec-tool-provider-seam cycles allowlisted in `scripts/check-cycles.ts` (#624). Tests that `mock.module('.../app-services')` for `getAppServices` move the stub to the store.
**Acceptance:** `check:cycles` shows those 7 entries gone (ratcheted down, not re-allowlisted); full suite green.
**Verify:** `bun run check:cycles` (no stale-allowlist error) + full suite.
**Files:** `app-services.ts`, new `app-services-store.ts`, ~6 core modules (registry/task-service/dispatch-cycle/dispatch-turns/dispatch-single/search-registry-core) + ~15 test files' mocks. **Size:** M. **Note:** proven approach during the #624 CI fix — this is the "proper fix" that allowlist comment points to.

### P1.1 — Contract: CapabilitySet + RuntimeToolAccess
**Description:** Add `CapabilitySet` (every runtime-provided capability, mode `native|shimmed|unavailable`) + `RuntimeToolAccess` (`style: 'in-process'|'mcp'|'cli-shim'` + `mcpServerTemplate?`/`shimCommand?`/`example?`) to `concepts.ts`. **`describeToolAccess()` STAYS a lightweight SYNC method** (declared wiring, no I/O) for the sync dispatch-prompt render path; the ASYNC `capabilities()` report *includes* the same `RuntimeToolAccess` facts for the UI/switch. Two surfaces, one truth — never await inside prompt assembly. Mock + both adapters return valid sets (Pi `in-process`, OpenClaw `mcp` w/ `mcpServerTemplate: 'bakin-<agent>'`).
**Acceptance:** contract compiles; `capabilities()` returns a full `CapabilitySet`; sync `describeToolAccess()` and `capabilities().toolCalling.access` agree; conformance test asserts every member present.
**Verify:** `bun test tests/**/adapter*contract* tests/dev/mock-runtime-contract.test.ts --isolate` + typecheck.
**Files:** `concepts.ts`, `index.ts`, `testing.ts`, `adapter-pi/src/runtime.ts`, `adapter-openclaw/src/runtime.ts`. **Size:** M.

### P1.2 — The one renderer
**Description:** `src/core/tool-access.ts` → `renderToolAccessInstructions(access)`. `in-process`: "call your `bakin_exec_*` tools directly" + discipline lines, NO cheat-sheet. `mcp`: same, noting the tools appear as `bakin-<agent>.*` (from the spike). `cli-shim`: full `shimCommand` cheat-sheet.
**Acceptance:** three styles render correctly; in-process/mcp omit the exhaustive list; golden fixtures committed.
**Verify:** `bun test tests/core/tool-access.test.ts --isolate`.
**Files:** `src/core/tool-access.ts` + test + `tests/fixtures/tool-access/*`. **Size:** M.

### P1.3 — Provisioning lifecycle (relocate OpenClaw out of core)
**Description:** Contract: `provisionToolAccess(execTools)` + `deprovisionToolAccess()`. Move `syncOpenClawMcpConfig` + the MCP-config writing from `src/core/openclaw-integration.ts` INTO `adapter-openclaw`. The adapter needs Bakin's MCP server URL/port to write `config.mcp.servers` (core knows the port today; the adapter won't) — thread it through `AdapterInitOpts` alongside the `execTools` provider. Pi = its in-process bridge (no-op hook). `app-services.ts` calls `adapter.provisionToolAccess(createRuntimeExecToolProvider())` at init; **core keeps zero runtime-specific provisioning**. Reads live `getAllExecTools()`; agent-create triggers provision (closes the boot-only gap).
**Acceptance:** OpenClaw provisioning writes byte-identical `config.mcp.servers` to before (golden); Pi bridge unaffected; new plugin tools + new agent both provision live.
**Verify:** `bun test tests/**/provision* tests/**/openclaw*integration* --isolate` + full suite.
**Files:** `concepts.ts`/`shared.ts`, `adapter-openclaw/src/*` (new provisioning module), `src/core/app-services.ts`, `src/core/openclaw-integration.ts` (gutted). **Size:** L.

### P1.4 — Neutral role defaults + injected section + unify authors
**Description:** (Reordered before mcporter delete — switch the instructions to native FIRST, then remove the dead path.) Strip ALL mcporter/transport prose from `ROLE_DEFAULTS` (`team-context-defaults.ts`) → transport-neutral + stable. Inject the rendered tool-access section at compose (`resolveContextInputs`/`deriveExpectedBlocks`, `sync-scanner.ts`). Route `dispatch-prompts.ts`, `dispatch-workflow.ts`, `bakin-skill.ts` through `renderToolAccessInstructions` (drop `mcporterHelpers`). Regenerate dispatch byte fixtures — **OpenClaw's prompts genuinely change (mcporter → native `mcp`), a large intentional diff; OpenClaw agents need a re-sync after this ships, not just Pi.**
**Acceptance:** composed AGENTS.md on Pi says "call directly" (no cheat-sheet, smaller); on OpenClaw says mcp; role file stable across runtimes; `#357` budget green.
**Verify:** `bun test tests/core/dispatch-prompts*.test.ts tests/**/compose* tests/architecture/ --isolate`; regen + review fixture diff.
**Files:** `team-context-defaults.ts`, `sync-scanner.ts`/`composer.ts`, `dispatch-prompts.ts`, `dispatch-workflow.ts`, `bakin-skill.ts`, fixtures. **Size:** L. **Depends:** P1.2.

### P1.5 — Delete mcporter
**Description:** (After P1.4 — the instructions no longer reference it.) Remove `src/core/mcporter.ts`, `src/core/onboarding/mcporter.ts`, the `COMPONENT_ORDER` entry, the `server.ts` boot `mcporter.setup`, the npm dep, any `~/.mcporter` writes. `cli-shim` renderer branch stays (inert).
**Acceptance:** grep-clean of `mcporter` in `src/`/`packages/`/`server.ts` (code); `bakin --help` + onboarding don't mention it; suite green.
**Verify:** `grep -rn mcporter src packages server.ts` = only the inert `cli-shim` doc string; full suite.
**Files:** deletes + `server.ts` + `onboarding/index.ts` + `package.json`. **Size:** S. **Depends:** P1.4.

### P1.6 — Lockfile runtime + runtime-aware drift
**Description:** Add runtime/style to `ProjectionInputs` (lockfile.ts); `scanAgentSync` attributes `block-stale` to a runtime change; `team.agent-sync` finding message is runtime-aware.
**Acceptance:** composing under two styles → byte-different blocks → scan reports runtime-attributed stale; lockfile carries style.
**Verify:** `bun test tests/**/sync-scanner* tests/**/agent-sync* --isolate`.
**Files:** `lockfile.ts`, `sync-scanner.ts`, `plugins/team/lib/health-checks.ts`. **Size:** M. **Depends:** P1.5.

### P1.7 — Content transport-neutrality guard
**Description:** Extend `adapter-boundary.test.ts` to ban `mcporter`, `bakin-<agent>`, raw `media://` in shipped content (`plugins/*/defaults/**`, `team-context-defaults.ts`, agent-package manifests). Fix the leaks the audit found: `plugins/images/defaults/{runtime-skills,workflow-skills,workflows}/**`. Install/sync verify rejects transport-carrying content.
**Acceptance:** violation fixture fails; clean tree passes; images defaults render transport via the seam or drop it.
**Verify:** `bun test tests/architecture/adapter-boundary.test.ts --isolate`; grep-clean of transport strings in content.
**Files:** the arch test, `plugins/images/defaults/**`, install/sync verify. **Size:** M. **Depends:** P1.5.

**══ Checkpoint α ══** Full suite green; mcporter deleted; Pi renders in-process, OpenClaw mcp; core has zero runtime-specific provisioning; content guard green. *Revert line: the whole foundation.*

---

## Phase 2 — Contract cleanup

### P2.1 — channels/cron → optional
**Description:** Make `channels`, `cron` optional on the contract. **Start with a committed grep inventory of every consumer as a checklist**, then feature-detect each (`runtime.channels?`/`runtime.cron?`): post-channel exec tool, watchdog, workflows notifications/approvals, channel-aliases, health, schedule plugin. Pi drops its throwing `unsupported.ts` channels/cron stubs (omits the blocks). **Add an arch-test/lint banning unguarded `runtime.channels`/`runtime.cron` access outside the adapter** — turns "did we get them all?" into a gate a future consumer can't bypass.
**Acceptance:** Pi omits channels/cron; schedule plugin renders empty without error; watchdog degrades to log-only; no `runtime_failed`-on-absent throws; unguarded-access lint green.
**Verify:** `bun test tests/**/{watchdog,schedule,channel,workflow-notif}* tests/architecture/ --isolate` + full suite.
**Files:** `concepts.ts`, ~8 consumer sites, `adapter-pi/src/unsupported.ts` (trimmed), new arch-test. **Size:** L.

### P2.2 — credentialStatus()
**Description:** Add `credentialStatus(agentId?)` capability method (presence-only: providers configured, channels configured — never secrets). Onboarding llm/channels checks rewire onto it. Pi synthesizes from `auth.json`; OpenClaw reads its config internally.
**Acceptance:** onboarding llm/channels checks pass on both runtimes via `credentialStatus`; no secrets cross.
**Verify:** `bun test tests/core/onboarding*credential* --isolate`.
**Files:** `concepts.ts`, both adapters, `src/core/onboarding/credentials.ts`. **Size:** M.

### P2.3 — models plugin off runtime-config
**Description:** Rewire the models plugin: per-agent model → `agents.update`/`agents.list`; routing POLICY (defaults/fallbacks/aliases) → Bakin-owned plugin-settings storage. Remove `readRuntimeConfig('models.routing')`.
**Round-trip design (important):** model catalogs differ per runtime (OpenClaw `openai/gpt-5.5`, Pi `openai-codex/gpt-5.5`), so a switch can't blindly reuse an assignment. Store model policy **Bakin-side keyed by runtime** so switching Pi→OpenClaw→Pi PRESERVES each runtime's assignments (round-trip, not one-way). The Phase-3 switch flow validates the target runtime's assignments against its catalog and flags any model no longer available for re-selection.
**Acceptance:** model assignment + routing policy work on both runtimes with no runtime-config reads; the Pi `withModelConfigSkeleton` hack removed; a Pi↔OpenClaw round-trip preserves each runtime's model assignments. **Bar: this box works after re-setting models per runtime — assignments are re-selected/validated on switch, not silently migrated.**
**Verify:** `bun test tests/plugins/models/ --isolate` + a manual Pi↔OpenClaw round-trip preserving assignments.
**Files:** `plugins/models/lib/config-io.ts`, `available-models.ts`, `routes.ts`, `aliases.ts`. **Size:** L.

### P2.4 — team plugin off runtime-config
**Description:** Team agent-inventory → `agents.list` + metadata. Remove `readRuntimeConfig('team.agent-inventory')`.
**Acceptance:** team page + inventory work with no runtime-config reads.
**Verify:** `bun test tests/plugins/team/ --isolate`.
**Files:** `plugins/team/lib/runtime-agents.ts`. **Size:** M.

### P2.5 — Delete `config: RuntimeConfigAccess`
**Description:** Remove the `config` member from the contract; delete `src/core/runtime-config.ts` + `src/core/runtime-config-raw.ts`; drop the governed-config arch-test rules. (Provisioning use gone in P1.3; models/team/onboarding gone in P2.2–4.)
**Acceptance:** contract has no `config`; grep-clean of `runtime.config` / `readRuntimeConfig` / `config.raw`; suite green.
**Verify:** full suite + boundary test.
**Files:** `concepts.ts`, deletes, `adapter-boundary.test.ts`. **Size:** M. **Depends:** P2.2/2.3/2.4.

### P2.6 — Generalize the 'main' literal
**Description:** Replace hardcoded `'main'` fallback across `helpers.ts`, `dispatch-prompts.ts`, `onboarding/runtime.ts` with a resolved main-agent lookup (role `orchestrator` → declared → first). Adapters declare/seed their orchestrator.
**Acceptance:** main-agent resolution works with a non-`'main'` id; onboarding integrity passes.
**Verify:** `bun test tests/core/main-agent.test.ts tests/core/onboarding* --isolate`.
**Files:** `helpers.ts`, `dispatch-prompts.ts`, `onboarding/runtime.ts`. **Size:** M.

**══ Checkpoint β ══** Full suite green; `config` member gone; Pi omits channels/cron cleanly; models+team on Bakin storage (per-runtime, round-trip-safe); main-literal generalized. *Revert line: contract stays at α.* **Phase-2 acceptance bar: the box works after a re-sync + re-setting per-runtime state (models), NOT "existing state migrates untouched" — pre-launch, break-it-now is the intent, but switching must be round-trippable (Pi↔OpenClaw↔Pi), just not a zero-touch toggle.**

---

## Phase 3 — Runtime switch

### P3.1 — Switch orchestrator (core)
**Description:** `switchRuntime(target)`: backup settings → flip → `deprovisionToolAccess()` old → construct new adapter + `initialize` + `provisionToolAccess` → re-project agents (agent-sync) → re-validate `capabilities()` → build capability report → reload. Reversible from the backup on any step failure.
**Acceptance:** orchestrator runs the full lifecycle in an isolated env; failure mid-step restores the backup.
**Verify:** `bun test tests/integration/runtime-switch.test.ts --isolate`.
**Files:** `src/core/runtime-switch.ts` (new). **Size:** L.

### P3.2 — CLI + REST
**Description:** `bakin runtime use <adapter>` (`src/cli/commands/runtime.ts`), `POST /api/runtime/switch`, `GET /api/runtime/capabilities` (report of native/shimmed/unavailable per capability).
**Acceptance:** CLI switches + prints the capability report; endpoints return correct state.
**Verify:** CLI exit-code test + route tests.
**Files:** CLI command, request-handler routes. **Size:** M.

### P3.3 — Runtime-management page (UI)
**Description:** A page: current runtime + status, capability matrix (per-capability native/shimmed/unavailable), health, one-click switch + rollback, live progress via SSE. New core plugin or a Settings route — decide during build (recommend a route + slot, not a new plugin).
**Acceptance:** page shows the matrix, switches with confirmation + live progress, offers rollback.
**Verify:** dev-loop manual + component test for the matrix/report reducer.
**Files:** host route + component(s), capability-report hook. **Size:** L.

### P3.4 — Switch integration test
**Description:** OpenClaw↔Pi round-trip in an isolated env: re-provision + re-project + re-validate + report; reversible.
**Acceptance:** round-trip both directions; capability report correct each way.
**Verify:** `bun test tests/integration/runtime-switch-e2e.test.ts --isolate`.
**Size:** M.

**══ Checkpoint γ ══** Switch round-trips both ways in isolation; capability report correct; reversible.

---

## Phase 4 — Images retrofit

### P4.1 — Images onto CapabilitySet.imageGen
**Description:** Express image generation through `capabilities().imageGen` (`native` OpenClaw/Pi-codex / `shimmed` direct-provider / `unavailable`). The images plugin routes via the capability descriptor instead of ad-hoc `providerReadiness` fusing. Pi codex + shim + OpenClaw native all map on the formal model — the 2nd conformant proof.
**Acceptance:** image gen works on both runtimes via the descriptor; readiness derived from `imageGen.mode`; no behavior regression.
**Verify:** `bun test tests/plugins/images/ tests/integration/pi/images* --isolate` + a live gen on Pi.
**Files:** `concepts.ts` (imageGen fields), both adapters' `capabilities()`, `plugins/images/lib/providers.ts`/`tools.ts`. **Size:** L.

**══ Checkpoint δ ══** Images conformant on both runtimes; two capabilities × two runtimes validate the abstraction.

---

## Phase 5 — Docs + bits + live validation

### P5.1 — Docs sweep
New `.claude/knowledge/runtime-capabilities.md` (the model); update `layered-context.md`, `adapter-architecture.md`, `pi-adapter.md`, `dispatch.md`; CLAUDE.md (mcporter gone, capability model, switch, no `config`); README. **Files:** docs. **Size:** M.

### P5.2 — bits-official source fix
File/fix the mcporter references in `bakin-bits-official` package templates so fresh installs are clean (compose-neutralize covers installed; source fix prevents recurrence). **Size:** S (issue + external PR).

### P5.3 — Live validation (this box)
Re-sync roster to native; confirm a Pi chat turn shows clean native `bakin_exec_*` tool calls (the original bug, fixed at root); exercise the management-page switch OpenClaw↔Pi and back; full suite green. Recorded in the PR. **Size:** M.

**══ Checkpoint ε (merge gate) ══** All phases green; live evidence attached; docs accurate; user approves merge.

---

## Commit ladder (rollback checkpoints)

```
Phase 0  docs(specs): spike PASS                          (done)
P1.1  feat(core): CapabilitySet + RuntimeToolAccess contract
P1.2  feat(core): renderToolAccessInstructions
P1.3  feat(core,adapter-openclaw): adapter-owned tool provisioning
P1.4  feat(core,dispatch): neutral role defaults + injected tool-access section
P1.5  refactor(core): delete mcporter                        ← checkpoint α scope
P1.6  feat(agent-packages): runtime-aware sync drift
P1.7  test(architecture): content transport-neutrality guard  ══ α ══
P2.1  feat(core): channels/cron optional + feature-detect consumers
P2.2  feat(core): credentialStatus()
P2.3  refactor(models): off runtime-config onto agents + plugin-settings
P2.4  refactor(team): agent inventory off runtime-config
P2.5  refactor(core): delete config: RuntimeConfigAccess
P2.6  refactor(core): generalize the 'main' orchestrator literal  ══ β ══
P3.1  feat(core): runtime-switch orchestrator
P3.2  feat(cli,api): bakin runtime use + switch/capabilities endpoints
P3.3  feat(host): runtime-management page
P3.4  test(integration): OpenClaw↔Pi switch round-trip          ══ γ ══
P4.1  feat(images): retrofit onto CapabilitySet.imageGen         ══ δ ══
P5.1  docs: capability model + mcporter removal
P5.3  chore: this-box live validation                           ══ ε (merge) ══
```

## Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `config` deletion churns models+team broadly | High | Rewire onto EXISTING contract methods (agents.update/list) where possible; golden tests both runtimes; P2.3/2.4 land + verify before P2.5 deletes the member |
| OpenClaw provisioning relocation changes behavior | High | Byte-golden the written `config.mcp.servers` vs pre-move; spike already proved the runtime behavior |
| channels/cron feature-detect sweep misses a consumer | Med | grep inventory first; one `runtime.channels?` pattern; full-suite gate |
| Byte-fixture churn destabilizes dispatch tests | Med | Isolate P1.5 fixture regen in its own commit; content-identical intent reviewed |
| Runtime-switch reload semantics (restart needed?) | Med | Design in P3.1: prefer in-process re-init; fall back to a supervised restart signal; reversible backup covers failure |
| UI scope creep on the management page | Med | Ship the matrix+switch+rollback+progress; defer deeper per-runtime health drilldowns |
| Bits source lag | Low | Compose-neutralize covers installed content immediately; source fix is a fast-follow |

## Parallelization
- P1.1 blocks most of Phase 1; P1.2/P1.3 can proceed in parallel after it.
- P2.3 (models) and P2.4 (team) are independent, parallel; both gate P2.5.
- Phase 3 UI (P3.3) can build against the P3.2 endpoints once their contract is fixed.
- Phase 4 is independent of Phase 3 (both need Phase 1/2's capability model) — can interleave.

## Verification (plan-level)
- [x] Every task has acceptance + verify + files + size
- [x] Bottom-up dependency order; riskiest early per phase
- [x] Checkpoints α–ε with revert semantics
- [x] Commit ladder maps 1:1 to tasks
- [ ] Human approval → build starts at P1.1
