# Spec — Work-Class Model Routing & Cost Confidence (models plugin hardening)

**Status:** DRAFT — awaiting approval
**Date:** 2026-07-16
**Origin:** Operator pass: "control what models are used for what tasks, and report it clearly enough that users trust it." Successor to `.claude/specs/models-cost-optimization.md` (origin routing) and `.claude/specs/cost-control-v2.md` (#464 budget rules/incidents — shipped).
**Related knowledge:** `.claude/knowledge/{models-plugin,dispatch,execution-ledger,usage-recording,chat-plugin,doctor-and-health-checks,agent-health-diagnostics,runtime-capabilities}.md`
**Branch:** `feat/workclass-routing` in the MAIN checkout (test-live-before-merge: Mark verifies on 3737 before merge).

---

## 1. Objective

A single-operator Bakin install must make model spend **controllable per kind of work and provably so**:

1. **Every LLM-consuming call site is a named work class** in one routing matrix — not just dispatch turns. Cheap work (titles, relays, triage) runs on cheap models when routed; nothing is invisible or unroutable by omission.
2. **Every Bakin-initiated send is metered and attributed to its work class** — "unattributed" shrinks to genuinely external agent activity.
3. **Routing decisions leave evidence** — every cost row records what work class it was and how its model was chosen; the operator can see "ran on X via class route" per run, and spend per work class per window.
4. **Misrouting is detected, not discovered on the bill** — a routing health check flags unrouted system classes, routes pointing at unavailable models, unsupported thinking levels on the active runtime, and expensive models on cheap classes.
5. **Getting to a good state is one click** — "Apply recommended routes" proposes cheap-tier routes for system classes from actually-available models; the operator confirms. No silent defaults.
6. **Existing honesty rules extend, not fork** — one spend engine, NULL-honest dollars, unit-per-lane, typed reasons; the legacy `$0`-fabricating rollups are deleted.

**Non-goals (explicitly out of scope):** savings estimator ("you saved $X") — deferred until route evidence has accumulated; work-class × agent routing grid (per-agent preference stays at the runtime default-model layer); silent smart defaults; subscription quota-window gating; image-generation routing (separate billed path, already provider/budget-gated per call); invoice-exact costs.

**Confirmed non-issues (audit):** heartbeats are JSON status files — zero inference on both runtimes; Pi has no runtime cron; watchdog/doctor sends are event-driven, never periodic. There is no timer-based background burn to fix.

---

## 2. Ground truth (audit summary, 2026-07-16)

What exists on main:

- **Origin routing is live but dispatch-only.** `src/core/model-routing.ts`: `Origin = scheduled|workflow|adhoc|recovery|decomposition`, `classifyOrigin` (deterministic from task shape), `resolveTurnModel` cascade tag → origin → inherit, model + thinking resolved independently. Applied once per dispatch (`dispatch-turns.ts:382`), threaded to `messaging.send`, priced against the routed model, `task.routed` audit on non-inherit. Config: `settings.routing` (models plugin), UI = Models → Routing tab. Both adapters honor per-turn `model`; Pi accepts thinking `off..xhigh` but **silently drops `adaptive`/`max`** (`adapter-pi/src/messaging.ts:48`); OpenClaw passes all levels.
- **Seven unrouted system call sites** run on agent-default models: chat auto-title (`plugins/chat/lib/auto-title.ts:60`), asset enrichment (`plugins/assets/lib/enrichment/runtime.ts:149`), doctor escalation (`src/core/doctor-escalation.ts:92`), watchdog alert (`src/core/watchdog.ts:143`), budget-notify relay (`src/core/budget-notify.ts:87`), task-complete orchestrator notify (`src/core/task-service.ts:595`), generic sends (`src/core/agents.ts:76`, `src/lib/agents.ts`). Team assignment (`plugins/team/lib/assignment-resolver.ts:182`) is a **separate hardcoded direct-provider call** (default `claude-haiku-4-5`, config orphaned in team settings `routingModel`/`routingProvider`) outside the runtime and the routing UI.
- **Attribution holes:** auto-title spend is budget-gated but **never metered** (no `run_costs` row); chat turns are never attributed (land only as usage.db "unattributed" burn). All other runtime sends are metered via `meterAgentTurn`.
- **Evidence holes:** `run_costs` has **no work-type column** (origin computed then discarded; only run_id prefixes `task:`/`turn:`/`image:`/`chat:<id>:title` hint at it). The `task.routed` audit is **write-only** — no `mapAuditMessage` humanizer, not in `TIMELINE_AUDIT_KINDS`; no UI anywhere shows a routing decision. Nothing records route source (tag vs class vs inherit).
- **Reporting state:** Spend tab facets = byAgent/byProvider/byModel only; **byAgent + byModel headline tables still read legacy `spendByAgent`/`spendByModel` rollups (`ledger.ts:1012-1051`) that `COALESCE(SUM,0)` — fabricating `$0`** for unpriced rows, contradicting the NULL-honest engine facets rendered above them. Model-per-run is visible only in Team Diagnostics timeline. No per-work-class slice exists anywhere.
- **Competitor:** paperclip has no model routing (metering + caps only; its incidents idea already absorbed in v2). Routing-product UX research: §3.

Gap table:

| # | Gap | Evidence |
|---|-----|----------|
| R1 | Only dispatch turns routable; 7 system sites + team-routing bypass the matrix | call-site audit above |
| R2 | Auto-title spend unmetered; chat unattributed | `auto-title.ts:60` (no meter call); no `meterAgentTurn` in `plugins/chat/lib/` |
| R3 | No work-class column on `run_costs`; no per-class spend facet | `ledger.ts:142-152`, `budget-spend.ts` facets |
| R4 | Routing evidence write-only (`task.routed` unread); no route-source record | `map-audit-message.ts:5-56`, `timeline.ts:17-26` |
| R5 | No routing health check (unrouted classes / unavailable models / capability mismatch) | `plugins/models/` has no health-checks file |
| R6 | Pi silently drops `adaptive`/`max` thinking; UI offers them anyway | `adapter-pi/src/messaging.ts:48` vs `routing-tab.tsx:18` |
| R7 | Legacy `$0`-fabricating rollups back two headline Spend tables | `ledger.ts:1012-1051`, `use-models-data.ts:82` |
| R8 | Team-routing model config orphaned outside the routing surface | `assignment-resolver.ts:31-32,141-142` |

---

## 3. Competitor research (routing-product sweep, 2026-07-16)

Products examined: LiteLLM, OpenRouter, Portkey, Helicone, Claude Code/Codex CLI, paperclip (web recheck). Full report in the session record; what this spec adopts:

**Adopted patterns:**
1. **Closed-enum work class as the routing key** (vs LiteLLM/Helicone free-form tags, which typo into orphan spend buckets) — Bakin controls every caller, so classes are an enum with a guaranteed inherit/default behavior (Portkey's "mandatory default → routing is a total function").
2. **Route receipt on every turn** (OpenRouter's `model`-in-response / Claude Code's `modelUsage`): the ledger row carries `{workClass, routeSource, model, applied thinking}` — evidence attached to the turn, never reconstructed from logs.
3. **One key, two uses** (LiteLLM tags / Portkey metadata / Helicone properties all converge here): the dimension that routes IS the dimension spend reports on. `byWorkClass` falls out of routing for free.
4. **Effort as a co-equal column with clamp-and-warn** (Claude Code): per-class thinking level; when the active runtime doesn't support the requested level, clamp to the nearest supported level and record requested→applied on the receipt — never fail the turn, never silently comply (fixes Pi's current silent drop, which is strictly worse than clamping).
5. **Recommended preset with diff preview** (Claude Code's `opusplan` spirit, avoiding OpenRouter auto-router opacity): one opinionated proposal, applied only through an explicit preview of exactly which rows change.
6. **Unit economics per class row** (Helicone Properties page): the byWorkClass table shows cost, run count, and avg cost/run — not just totals.

**Anti-patterns avoided:** opaque auto-routing (OpenRouter `auto`); routing visibility as an afterthought (LiteLLM — users reverse-engineer routes from spend rows); config-ID indirection for a single user (Portkey — the matrix is THE live config, edited in place); silent clamping in non-interactive paths (all clamps leave audit evidence); multi-layer inheritance without showing which layer won (the receipt names the source).

**Paperclip recheck:** still no model routing as of v2026.626.0 — metering + caps only (new: per-wake "heartbeat preflight budget caps"). The work-class routing matrix remains open field vs the closest competitor.

---

## 4. Locked decisions (operator interview, 2026-07-16)

| # | Decision | Choice |
|---|----------|--------|
| W1 | Ambition | **Visible routing matrix** — every call site a named work class with assigned model/effort; deterministic, auditable. No automatic/LLM-picked routing |
| W2 | Confidence surfaces | Per-work-class spend breakdown + per-turn route evidence + routing health check. **No savings estimator this round** |
| W3 | Research | Routing-product web sweep (no paperclip re-clone) |
| W4 | Taxonomy | **One unified WorkClass enum replaces Origin outright** (no shims, rename through) |
| W5 | Attribution | **Meter every Bakin-initiated send**, incl. chat + auto-titles |
| W6 | Defaults | **No silent defaults.** "Apply recommended routes" one-click proposal + health-check nag while system classes are unrouted |
| W7 | Dimensions | Routes per **work class + tag overrides** (global). Per-agent stays at runtime default-model layer |
| W8 | Tech debt (in-pass) | Delete legacy rollups (R7); capability-honest thinking levels (R6); fold team-routing config into the matrix (R8); one-shot migrate `settings.routing` origins → work classes |

---

## 5. Feature specs

### 5.1 WorkClass taxonomy (W4 — replaces `Origin`)

`src/core/model-routing.ts` is rewritten around:

```ts
type WorkClass =
  // dispatch classes (classified from task shape, as today)
  | 'scheduled' | 'workflow' | 'adhoc' | 'recovery' | 'decomposition'
  // system classes (declared by the call site)
  | 'auto-title'          // chat auto-titles
  | 'enrichment'          // asset vision/caption/OCR turns
  | 'relay'               // doctor escalation, watchdog alert, budget-notify, orchestrator notify
  | 'team-routing'        // team.resolveAssignment direct-provider classification
  | 'send'                // generic/other Bakin-initiated agent sends
  | 'chat'                // interactive chat turns (metered-only, NOT routable)
```

- Each class has static metadata in one table: `{ id, label, description, routable: boolean, kind: 'dispatch'|'system', recommendedTier?: 'cheap'|'cheap-vision' }`. `chat` is `routable: false` — interactive chat model choice belongs to the operator/agent, but its spend is attributed (W5).
- `classifyOrigin` → `classifyDispatchWorkClass` (same deterministic precedence). System classes are **declared at the call site**, never inferred.
- The four relay-ish sites share one `relay` class (same shape of work: short system notification turn to the main agent). Splitting further would add matrix rows without adding routing value.
- `RoutingConfig` becomes `{ routes: WorkClassRoute[]; tagOverrides: TagOverride[] }` with `WorkClassRoute { workClass, model?, thinking? }`. Tag overrides unchanged (dispatch-only — tags are a task concept).
- **Migration:** one-shot in models plugin settings load (pattern: `budget-migration.ts`): `policies[{origin,…}]` → `routes[{workClass,…}]` 1:1; old key deleted. No dual-read.

**Acceptance:** all five dispatch classes classify exactly as before (regression); every system call site compiles against a declared class; `Origin` identifier is gone from the codebase.

### 5.2 Routing for system sends (R1, R8)

- `resolveTurnModel(config, workClass, tags)` — same cascade (tag → class route → inherit), tags empty for system classes.
- A small helper `resolveSystemRoute(workClass)` (core, reads the `models.getRoutingConfig` hook like dispatch does) is called by each system site; resolved `{model, thinking}` passes into `messaging.send` args. Sites: auto-title, enrichment, relay ×4, generic sends (`send` class).
- **Team-routing fold-in:** `assignment-resolver` reads the matrix route for `team-routing` to pick its direct-provider model; team settings `routingModel`/`routingProvider` are **deleted** (one-shot migrate: if set and no matrix route exists, seed the matrix route from them). Provider derives from the routed model id; the direct-provider transport stays as-is.
- Unrouted (`inherit`) system classes behave exactly as today: agent default model, no thinking override.

**Acceptance:** setting `auto-title → <cheap model>` changes the model Pi/OpenClaw actually receive for the next title turn (adapter-level assertion); relay routes apply to all four relay sites; team-routing route changes the direct-provider call's model; with no routes, behavior is byte-identical to today.

### 5.3 Full attribution (W5, R2)

- **Every Bakin-initiated runtime send is metered** with its work class. New/changed call sites: auto-title (`meterAgentTurn` after send with `workClass:'auto-title'`), chat turns (metered in the chat turn-completion path with `workClass:'chat'`), enrichment + relays + generic sends pass their class through the existing `meterAgentTurn` path.
- `run_costs` migration (next ledger version): add `work_class TEXT NULL`. **Backfill** from run_id prefix heuristics (`task:` → NULL(dispatch-era rows keep honest NULL — their dispatch class wasn't recorded), `image:` → excluded (media), `chat:<id>:title` → `auto-title`, `turn:` → `relay`); anything ambiguous stays NULL. NULL renders as "unclassified (pre-migration)" — never guessed.
- `RunCostInput` gains required `workClass` (compile-time forcing function: no new unclassified rows).

**Acceptance:** after one auto-title and one chat turn, both have `run_costs` rows with correct class + lane + tokens; unattributed delta for that agent shrinks correspondingly; dispatch rows carry their dispatch class.

### 5.4 Route evidence (W2, R4)

- `run_costs` also gains `route_source TEXT NULL` — `'tag:<name>' | 'class' | 'inherit'` recorded at metering time for every routed-capable turn, plus the applied thinking level and any clamp (`requested → applied`, §5.7). The tuple `(work_class, route_source, model, thinking)` is the per-turn **route receipt** (research pattern #2) — evidence attached to the turn, never reconstructed from logs.
- Team Diagnostics timeline run rows extend to `model · tokens · $ · via <route_source>`; `task.routed` audit gets a `mapAuditMessage` humanizer ("Routed to <model> (<thinking>) via <source>") and joins `TIMELINE_AUDIT_KINDS`.
- Task detail (run history) shows the same line — read from `listRunsByTask`, no new query engine.

**Acceptance:** a tag-overridden run shows `via tag:<name>`; a class-routed run shows `via class`; an inherit run shows the agent default with `via inherit`; the audit renders human-readable in the timeline.

### 5.5 Per-work-class spend facet (W2, R3)

- `assembleBudgetSpend` facets gain `byWorkClass` (attributed-only — same honesty stance as byProvider/byModel, §13.3 of the v2 spec; unattributed delta stays on global/agent scopes). Both token and micro-dollar sums per class, lane-aware.
- Spend tab: new "By work class" table (class | runs | tokens | est. $ metered | tokens subscription | **avg cost/run**), with NULL-class rows shown as "unclassified" (Helicone unit-economics pattern — per-class averages expose "titles cost $0.002/run" at a glance). CLI `bakin spend` gains the same block.
- **No budget-rule scope extension this round** — rules stay global/agent/provider/model; a `workClass` cap scope is a natural later extension the rule shape already permits structurally.

**Acceptance:** an auto-title turn and a dispatch turn land in different facet rows; Spend tab + CLI agree with the engine; subscription-lane classes show tokens only.

### 5.6 Routing health check + recommended routes (W6, R5)

- New `plugins/models/lib/health-checks.ts` registering `models.routing` via `ctx.registerHealthCheck`:
  - **warn:** routable system classes with no route ("Auto-titles run on each agent's default model — route them to a cheap model"), listing estimated recent spend for that class as evidence.
  - **error:** route points at a model absent from the available-models cache; route requests a thinking level the active runtime doesn't support.
  - **warn:** cheap-class turn observed on a premium-priced model in the last 7d (catalog price threshold; warn-only, evidence rows attached as structured `data` — UIs never parse text).
- **Recommended routes:** server route `POST /api/plugins/models/routing/recommend` computes proposals: for each unrouted routable system class pick the cheapest available model (catalog pricing, active-runtime availability; `enrichment` requires a vision-capable model — `cheap-vision` tier). Response is a proposal list; UI renders an "Apply recommended routes" button on the Routing tab opening a **ConfirmDialog** (house rule: whole action flow in the modal) listing each proposed route; confirm PUTs the routes. A deterministic repair action (`ctx.registerHealthRepairAction`) applies the same proposal from the doctor surface.

**Acceptance:** fresh state → warn with per-class evidence; applying recommendations clears it; deleting the routed model from availability flips to error; on Pi a route with `thinking: 'max'` is an error, on OpenClaw it is not.

### 5.7 Capability-honest thinking levels with clamp-and-warn (W8, R6)

- The runtime messaging capability surface declares `supportedThinkingLevels: ThinkingLevel[]` (Pi: `off..xhigh`; OpenClaw: all; mock: declared subset). Adapter-owned, exposed through the models `/config` payload alongside `routingSupport`.
- Routing tab thinking dropdowns render **only supported levels** for the active runtime (prevention).
- If a persisted route still carries an unsupported level (e.g. after a runtime switch), the resolution layer **clamps to the nearest supported lower level** (`max`→`xhigh`, `adaptive`→inherit since it has no ordinal) instead of Pi's current silent drop-to-inherit. Every clamp is recorded on the route receipt (`requested → applied`) and leaves audit evidence — never silent, never a failed turn (research pattern: Claude Code clamp-and-warn; anti-pattern: silent clamps in non-interactive paths).
- The health check (§5.6) flags standing routes that clamp on the active runtime so the operator can fix the config, and the runtime conformance suite gains a capability-honesty check: an adapter must honor every level it declares and declare every level it honors.

**Acceptance:** Pi UI shows no `adaptive`/`max`; a persisted `max` route on Pi runs at `xhigh` with receipt + audit evidence of the clamp; conformance teeth fail a mock that lies about supported levels.

### 5.8 Legacy rollup deletion (W8, R7)

- `spendTotal`/`spendByAgent`/`spendByModel` (`ledger.ts:1012-1051`) are **deleted**; the Spend tab's byAgent/byModel tables re-read from the engine's NULL-honest facets (which already exist). `RunCostRow` legacy shape absorbed into the modern row type where `recentRunsByAgent` needs it.
- Every `$` number on the Spend tab now traces to `assembleBudgetSpend` — the "one engine" invariant becomes literally true, not "true where it matters".

**Acceptance:** an unpriced run shows tokens with no fabricated `$0` in byAgent/byModel; totals match the lane summary for the same window; grep proves no caller of the deleted verbs.

---

## 6. Commands

- Build: `bun run build` (⚠ mutates `generated-version.ts` — never commit it).
- Tests: `bun run test` (full, CI flags); `bun test tests/<path> --isolate` (single file).
- Dev: `bun run dev:mock` for UI; `bun run instance dev` for real-adapter verification; `/verify` skill for isolated end-to-end boot.
- Live verification: branch runs on 3737 via `nohup bun run dev` from this checkout (server restart required — server code isn't watched).

## 7. Project structure (touch map)

```
src/core/model-routing.ts                    WorkClass taxonomy + metadata table; classifyDispatchWorkClass; resolveTurnModel; resolveSystemRoute
src/core/dispatch-turns.ts                   rename threading (origin→workClass); route_source into metering; audit unchanged shape
src/core/agent-cost.ts                       meterAgentTurn workClass/route_source params
src/core/{doctor-escalation,watchdog,budget-notify,task-service,agents}.ts, src/lib/agents.ts   relay/send class + route resolution
plugins/chat/lib/{auto-title,stream-bridge or turn-completion path}.ts   auto-title + chat metering + auto-title routing
plugins/assets/lib/enrichment/runtime.ts     enrichment class + routing
plugins/team/lib/assignment-resolver.ts      team-routing matrix route; delete routingModel/routingProvider settings (seed-migrate)
packages/core/src/execution/ledger.ts        run_costs +work_class +route_source (migration + prefix backfill); delete spendTotal/spendByAgent/spendByModel
src/core/execution-ledger.ts                 facade updates
src/core/budget-spend.ts                     byWorkClass facet
packages/core/src/adapters/runtime/concepts.ts   supportedThinkingLevels on messaging capability surface
packages/adapter-pi/src/*                    declare levels; keep guard
packages/adapter-openclaw/src/*              declare levels
tests/integration/runtime-conformance/*      thinking-level honesty check + teeth
plugins/models/types.ts                      RoutingConfig routes shape
plugins/models/lib/{register-hooks,routes,route-schemas}.ts   routing GET/PUT new shape; /routing/recommend; config exposes supported levels
plugins/models/lib/health-checks.ts          NEW — models.routing check + repair action
plugins/models/lib/routing-migration.ts      NEW — one-shot settings migration (pattern: budget-migration.ts)
plugins/models/components/routing-tab.tsx    matrix (dispatch + system sections), supported-levels filter, Apply-recommended ConfirmDialog
plugins/models/components/spend-tab.tsx      byWorkClass table; byAgent/byModel re-pointed at engine facets
plugins/models/components/use-models-data.ts data shapes
plugins/team/{lib,components}/*              timeline route_source line
src/lib/map-audit-message.ts                 task.routed humanizer
plugins/team/lib/timeline.ts                 TIMELINE_AUDIT_KINDS + task.routed; run row route_source
src/cli/commands/budget.ts (or spend)        byWorkClass block in bakin spend
tests/**                                     per §9
.claude/knowledge/{models-plugin,dispatch,execution-ledger,usage-recording,chat-plugin,doctor-and-health-checks,runtime-capabilities}.md + CLAUDE.md Cost Control/key-patterns lines
README.md                                    check for model-routing claims during docs phase
```

## 8. Code style

Repo conventions unchanged: TS strict; zod at boundaries (new/changed routes); `createLogger`; kebab-case; conventional commits with scope; typed reasons — never classify by message text; UIs read structured `data`; plugin cross-calls via hooks only; adapter boundary respected (thinking-level declaration is adapter-owned; no provider identifiers upstream).

## 9. Testing strategy

CLAUDE.md testing rules mandatory (mock BOTH content-dir resolvers + runtime homes; `getBakinPaths` mocks include `db`; `closeDb()` before `rmSync`; `--isolate`; RTL files import rtl-settle). TDD per task.

- **Taxonomy:** classify truth table (dispatch classes regression vs old `classifyOrigin`); resolver cascade incl. tag overrides; `chat` unroutable; settings migration one-shot (old policies → routes, old key gone; idempotent re-run).
- **System routing:** each call site passes its class + resolved route to `messaging.send` (mock runtime asserts args); team-routing model comes from matrix; seed-migration from old team settings.
- **Attribution:** auto-title + chat turns produce `run_costs` rows (class, lane, tokens); `RunCostInput.workClass` required (type-level); ledger migration + prefix backfill truth table; NULL stays NULL.
- **Evidence:** route_source recorded for tag/class/inherit; timeline rows + humanized audit render (RTL); `listRunsByTask` carries fields.
- **Facet:** byWorkClass sums (tokens + $ per lane; NULL bucket); parity engine ↔ /spend ↔ CLI.
- **Health check:** unrouted-class warn with evidence rows; unavailable-model error; unsupported-thinking error per runtime; premium-on-cheap warn; repair action applies proposals; recommend endpoint picks cheapest (vision-capable for enrichment).
- **Capability honesty:** conformance check + teeth file; Pi declares subset; UI filter (RTL).
- **Legacy deletion:** no fabricated $0 (unpriced-run regression); grep-style architecture assertion that deleted verbs have no callers.
- **Regressions:** no-routes behavior identical; budget gate still prices routed model; existing budget/incident suites green.

## 10. Boundaries

**Always:** one spend engine behind every $ figure; NULL-honest (never fabricate, incl. backfill); unit-per-lane; work classes declared at call sites (never inferred from strings/run-ids at read time except the one-shot backfill); ConfirmDialog for apply-recommended (whole flow in the modal); adapter boundary (levels declared by adapters; direct-provider transport stays in team plugin); typed reasons.

**Ask first:** adding a `workClass` budget-rule scope; routing interactive `chat`; auto-applying recommended routes without confirmation; splitting the `relay` class further.

**Never:** parallel spend math; shims/dual-read for old shapes (`Origin`, old `settings.routing`, team `routingModel`, legacy rollups — all deleted); silent thinking-level mapping; guessed backfill; commit `generated-version.ts`; tests touching real home dirs.

## 11. Phased roadmap + commit strategy (rollback checkpoints)

Each commit builds green and passes the full suite; each phase is a rollback point.

**Phase 1 — Taxonomy + ledger foundation**
- C1.1 `refactor(core): WorkClass taxonomy replaces Origin (rename-through, dispatch classes 1:1)`
- C1.2 `feat(core): run_costs work_class + route_source columns (migration + prefix backfill)`
- C1.3 `feat(models): settings.routing one-shot migration to work-class routes`
- *Checkpoint: behavior identical; new columns land; old shapes gone.*

**Phase 2 — Full attribution + evidence**
- C2.1 `feat(core): meterAgentTurn carries workClass/route_source; RunCostInput requires class`
- C2.2 `feat(chat): meter auto-title + chat turns into run_costs`
- C2.3 `feat(team,lib): timeline + task detail route evidence; task.routed humanizer + timeline kind`
- *Checkpoint: every Bakin send attributed; evidence visible.*

**Phase 3 — System-send routing**
- C3.1 `feat(core): resolveSystemRoute + relay/send/enrichment/auto-title call sites honor the matrix`
- C3.2 `feat(team): team-routing folds into the matrix; orphan settings deleted (seed-migrate)`
- *Checkpoint: matrix controls every routable class.*

**Phase 4 — Reporting**
- C4.1 `feat(core): byWorkClass spend facet`
- C4.2 `feat(models): Spend tab by-work-class table; byAgent/byModel re-pointed at engine; legacy rollups deleted`
- C4.3 `feat(cli): bakin spend by-work-class block`
- *Checkpoint: per-class spend visible everywhere; $0 fabrication gone.*

**Phase 5 — Health + recommendations + capability honesty**
- C5.1 `feat(core,adapters): supportedThinkingLevels capability + conformance check`
- C5.2 `feat(models): routing tab matrix redesign (system section, supported-levels filter)`
- C5.3 `feat(models): routing health check + /routing/recommend + Apply-recommended ConfirmDialog + repair action`
- *Checkpoint: misrouting detectable; one-click good state.*

**Phase 6 — Docs + close-out**
- C6.1 `docs(knowledge): work-class routing — models-plugin/dispatch/execution-ledger/usage-recording/chat-plugin/doctor/runtime-capabilities + CLAUDE.md; README check`

## 12. Open items for the plan phase

1. Chat metering placement — exact hook in the chat turn-completion path (stream-bridge vs turn recorder) where usage is known; confirm usage fields are available on Pi + OpenClaw chat paths.
2. Enrichment vision-capability detection for `cheap-vision` recommendations — what the models cache/catalog exposes; fallback when no cheap vision model exists (skip with reason, never propose blind).
3. `send` class breadth — confirm `src/lib/agents.ts` start/restart/deliver sends should be routable or metered-only.
4. Thinking-level declaration surface — messaging capability vs `routingSupport()`; pick one, conformance-pin it.
5. Backfill prefix mapping — verify `turn:` run-ids are exclusively relay-ish before mapping them to `relay` (else NULL).
6. Premium-on-cheap warn threshold — catalog price percentile vs static list; keep warn-only.
7. Whether `bakin spend` byWorkClass lands in `budget.ts` CLI module or a new `spend` section (follow existing file).
