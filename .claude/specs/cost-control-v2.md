# Spec — Cost Control v2: End-User Budget Safety & Visibility (#464 close-out)

**Status:** DRAFT — pending operator approval.
**Origin:** Issue #464, round 2. PR #500 shipped the core (metering → `run_costs`, origin routing, `budgetGate` defer-at-cap). This round closes the **end-user experience gaps** so cost cannot spin out of control *unknowingly*, then closes #464.
**Related:** `.claude/specs/models-cost-optimization.md` (+`-plan.md`), `.claude/knowledge/{models-plugin,execution-ledger,usage-recording,dispatch,doctor-and-health-checks,agent-health-diagnostics}.md`.
**Branch:** `feat/464-cost-control-v2`, PR to `main`.
**Note:** saved directly under `.claude/specs/` — root `SPEC.md` is occupied by the in-flight gate/Discord validation draft.

---

## 1. Objective

A single-operator Bakin install must make it **structurally impossible to burn money without knowing**:

1. **Awareness is forced** — onboarding prompts for a budget; an unset budget is a standing doctor notice; breaches reach the operator proactively (browser notification + main-agent relay), not only when they open a dashboard.
2. **The cap means "my actual money"** — the gate counts total observed spend (Bakin-attributed + the unattributed delta from transcripts), not just what Bakin dispatched.
3. **Cost is billing-mode honest, unit-per-lane** — turns on metered API keys are estimated real dollars (labeled); turns on subscriptions (Codex/ChatGPT Pro, Claude Max) are **token quota usage with no dollar figure at all** (any $ there would be fiction). Two lanes, both visible, both cappable — each in the unit its bill/quota actually comes in. Raw tokens are stored on every row regardless, so the dollar layer is removable display, never load-bearing.
4. **Caps scope to how money actually flows** — global, per-agent, and **per-provider** rules (e.g. "Gemini image spend ≤ $5/day" separate from "Codex subscription usage"), on an architecture that extends to per-model without a rethink.
5. **Breaches are durable, actionable objects** — a budget **incident** (paperclip's strongest idea) with explicit resolution: *raise cap & resume* or *acknowledge & wait for window reset*; plus an opt-in **pause-at-cap** mode that holds dispatch until resolved.
6. **Nothing burns silently mid-turn** — billed media calls (image generate/edit) re-check the budget per call and refuse with a typed error at cap.
7. **There is a break-glass control** — a global **kill switch** pausing all Bakin-initiated dispatch, one click / one CLI command.
8. **The state is visible everywhere it matters** — utilization gauges with remaining budget and pace projection, cap-rule editing (scope × lane), budget-deferred task badges, attention chips, and a CLI surface.

**Out of scope:** invoice-exact billing; gating on provider quota windows (read-only surfacing only, if the runtime exposes them — see §11); per-model cap **UI** (architecture supports it; UI ships per-provider max this round); rolling (non-calendar) windows; anomaly detection; in-flight turn aborts at cap (rejected); per-origin spend breakdown (rejected); video metering (no generation path exists yet).

---

## 2. Ground truth (audit summary)

What exists (PR #500): `run_costs` ledger table + `spendTotal/spendByAgent/spendByModel`; `evaluateBudget` (`src/core/budget.ts`) — global + per-agent caps, daily + monthly local-calendar windows, warn at `warnPct` (0.8), defer at 100%, fail-closed; `budgetGate` in all three dispatch paths; debounced `budget.warn`/`budget.deferred` audits; `budget` health check (global-only); Spend tab (window totals, per-agent/per-model tables, **global-only** caps editor); image spend metered into `run_costs` (`meterImageTurn`, flat per-image rates); non-dispatch Bakin sends metered (`meterAgentTurn`); unattributed burn computed in `src/core/agent-burn.ts` (tokens, warn-only).

**How cost is known today:** token counts are real (trajectory `usage` per turn); model attribution is real (per-turn override or agent's effective model); prices are hand-maintained catalog list rates (9 cloud LLMs, `$/1M`, cache multipliers, `updatedAt`); unknown/local models → `null` cost, never $0. **Billing mode is invisible:** every turn is priced as metered API spend even when the agent runs on a subscription (marginal $0, quota-capped) — the only acknowledgment anywhere is the assets-enrichment "subscription quota" notice. Per-agent `auth-profiles.json` is readable via the adapter's allowlisted raw-config gate (`runtime.ts:1195-1199`), so detection is feasible.

The verified gaps this spec closes:

| # | Gap | Evidence |
|---|---|---|
| G1 | No utilization view (no spend-vs-cap %, gauge, remaining) | `spend-tab.tsx` — caps card and total card unrelated; browse window ≠ cap windows |
| G2 | Per-agent caps enforced but no UI — save path drops `perAgent` | `use-models-data.ts:167-189` |
| G3 | `warnPct` not editable | no field renders |
| G4 | Budget-deferred tasks invisible — sit silently in todo | zero budget refs in `plugins/tasks/`; `use-gate-status.ts` polls workflow gates only |
| G5 | No proactive alerting — cron doctor never notifies (`notifyAgent` only via CLI flag); no browser notification for budget | `src/core/doctor.ts:81-110,174-193`; `use-sse.ts:119` fires only for `workflow.gate_reached` |
| G6 | Fresh installs uncapped, no onboarding step, no nag | `src/core/onboarding/` — no budget component; empty policy ⇒ always allow |
| G7 | Within-turn image spend uncapped (gate is pre-dispatch only) | `plugins/images/lib/tools.ts:344` meters after the billed call |
| G8 | Non-dispatch agent spend observed but never counted against caps, tokens-only | `agent-burn.ts` warn-only; `budgetGate` sums `run_costs` only |
| G9 | No CLI spend/budget surface | `src/cli/commands/` — nothing |
| G10 | Billing-mode blind — subscription turns booked as metered dollars; no provider-scoped limits | `priceTurn` hook ignores auth; caps are global+agent only |

Paperclip delta (verified against source, July 2026): budget **incidents** + `budget_override_required` approvals with *raise & resume / keep paused*; hard stop pauses scope + cancels in-flight + **no auto-resume at rollover**; per-policy `warnPercent/hardStopEnabled/notifyEnabled`; `billingType` (`metered_api|subscription_included|subscription_overage`) + `biller` per cost event; live provider quota windows; utilization bars/status chips/dashboard banner/sidebar markers. It has **no** daily windows, no projections, no default caps, in-app-only notifications. Bakin keeps defer-first + daily windows, adopts incidents and billing-mode lanes, and exceeds paperclip on alerting, total-observed cap basis, provider-scoped caps, and pace projection.

---

## 3. Locked decisions (operator interview)

| # | Decision | Choice |
|---|---|---|
| V1 | Framing | Gap-closing v2 on the PR #500 foundation; close #464 at the end |
| V2 | Out-of-box posture | Onboarding budget step (prompted, skippable) + doctor notice while no budget is set. **No default caps** |
| V3 | Alerting | Browser notification via existing SSE/bell mechanism **and** proactive main-agent relay on new incidents |
| V4 | Cap basis | **Total observed** = attributed (`run_costs`) + unattributed delta (usage.db observed − attributed), dollars where reported, NULL-honest, lag-honest |
| V5 | Enforcement additions | Durable **budget incidents** with resolve actions; global **kill switch**; **opt-in pause-at-cap** per rule. NO in-flight abort |
| V6 | Media | Billed image calls gate per call; typed `budget_exceeded` tool error; kill switch blocks them too |
| V7 | Surfaces | Utilization gauges + remaining + warnPct + cap-rule UI; deferred-task badges; pace projection; CLI `bakin spend`/`bakin budget`. NOT per-origin breakdown |
| V8 | Billing modes + units | **Two lanes, unit-per-lane.** Metered turns = estimated dollars (labeled; tokens always shown alongside) — dollar caps gate them. Subscription turns = **tokens only, no dollar figures** ("included in subscription") — token caps gate them. Images stay dollar-priced (per-image rates; tokens can't express them). No fabricated numbers anywhere. Every surface shows the lane split |
| V9 | Cap scoping | **Per-provider caps now** (anthropic/openai/google/…), on a rule-based policy whose scope dimension extends to per-model later **without rebuild**. Use case: nanobanana(Gemini) image spend capped separately from Codex(subscription) main turns |

---

## 4. Feature specs

### 4.1 Spend engine: total observed, lane- and provider-aware (G8, G10, V4, V8, V9)

One shared engine, `src/core/budget-spend.ts` → `assembleBudgetSpend(now)` returning window spend (daily + monthly) **faceted by (scope, lane)**: totals and per-agent / per-provider / per-model rollups. Every facet carries **both** token sums and (where priced) micro-dollar sums; the metered lane is reported/capped in dollars, the subscription lane in tokens (no $ computed for it), plus an `unpriced` metered remainder reported honestly in tokens.

- **Attributed** spend comes from `run_costs`; **unattributed delta** = `max(0, observed$(usage.db) − attributed$(run_costs))` per agent per local day (reuse `agent-burn.ts` day-alignment discipline — do not fork it). NULL-cost rows contribute nothing (never fabricate); coverage shown honestly ("$X unattributed, N of M sessions costed").
- **Provider** derives from the model id (`provider/model` — the runtime's id format; normalization helper shared with the models plugin). Stored denormalized on `run_costs` (new column, backfilled by migration from `model`) so rollups are one GROUP BY. usage.db rows already carry `model` → same derivation for the unattributed share.
- **Lane** (`metered | subscription | local`) resolves per turn: catalog/per-model override → agent's auth-profile detection (plan-phase probe of `auth-profiles.json` schema; adapter exposes it via the allowlisted raw-config gate) → default `metered` (conservative: unknown auth reads as real money). Stored on `run_costs` (new column). Unattributed rows take the acting agent's current lane (approximation, documented).
- Consumers: gate, health check, `/spend`, `/budget/status`, CLI — **one engine, every surface a client**.

**Acceptance:** a Gemini image run and a Codex subscription turn land in different (provider, lane) buckets; $6 attributed + $5 observed-unattributed trips a $10 metered cap; NULL-cost metered sessions add tokens but no dollars; all surfaces agree for the same instant; the operator's exact scenario — "cap Gemini metered spend at $5/day while Codex subscription usage has its own separate token/day limit" — is expressible and enforced.

### 4.2 Cap-rule policy (V8, V9 — replaces the fixed BudgetPolicy shape)

The PR #500 `{global, perAgent}` shape is **replaced outright** (single-user machine, no shims) by a rule list in models-plugin settings:

```ts
BudgetRule {
  scope: 'global' | 'agent' | 'provider'   // 'model' reserved — evaluator + schema accept it from day one; UI ships through provider
  scopeId?: string                         // agent id | provider id | (model id later); absent for global
  lane: 'metered' | 'subscription'         // each rule targets exactly ONE lane — its unit follows
  dailyCap?: number                        // metered: whole USD; subscription: tokens
  monthlyCap?: number                      // same unit rule
  warnPct?: number                         // default 0.8
  atCap?: 'defer' | 'pause'                // default 'defer' (§4.4)
}
BudgetPolicy { rules: BudgetRule[] }
```

- **Unit-per-lane (V8):** a rule's unit is determined by its lane — metered rules cap estimated USD; subscription rules cap **tokens** (exact, never estimated). There is no cross-lane rule: "all my real money" = `scope: global, lane: metered`. UI/CLI render the unit explicitly ("$25/day" vs "5M tokens/day") so a rule can never be misread.
- `evaluateBudget` is rewritten (still pure): input = rules + the faceted spend from §4.1; every matching rule is checked against its lane's unit; defer beats warn beats allow; the worst breach identifies the rule for the incident/audit. No rules → always allow.
- Adding `'model'` scope later = one enum value + one UI picker; evaluator, spend facets, incidents, and schema already key on `(scope, scopeId, lane)`.

**Acceptance:** rules for global/agent/provider × lane each gate independently; a provider rule defers only dispatches/media calls that would spend on that provider (resolved model → provider before the claim; media gate knows its provider directly); legacy-shaped settings are migrated once (or reset — plan phase decides; no dual-read code).

### 4.3 Budget incidents (V5)

New ledger module table (per-module migration, coordination facts only):

```
budget_incidents(
  id INTEGER PK,
  scope TEXT, scope_id TEXT NULL, lane TEXT,          -- rule identity (§4.2)
  window TEXT ('daily'|'monthly'), window_start_ms INTEGER,
  kind TEXT ('warn'|'cap'),
  unit TEXT ('usd_micros'|'tokens'),                  -- follows the rule's lane (V8)
  cap_value INTEGER, spent_value INTEGER,             -- in `unit`, at open time
  opened_at INTEGER,
  status TEXT ('open'|'resolved'|'acknowledged'),
  resolved_at INTEGER NULL, resolution TEXT NULL ('raised'|'acknowledged'|'window_rollover'|'killswitch_cleared'),
  UNIQUE(scope, scope_id, lane, window, window_start_ms, kind)  -- idempotent open; replaces the in-memory debounce set
)
```

- Opened by `budgetGate` (and the media gate) on first warn/cap per (rule, window-start, kind). The UNIQUE constraint IS the debounce — the current `budgetAuditedWindows` in-memory set is deleted (it forgets on restart; the table doesn't).
- Audit events `budget.warn`/`budget.deferred` fire **on incident open** (once, durable) carrying the incident id; `budget.incident_resolved` fires on resolution.
- **Resolution actions** (REST + UI + CLI): *raise cap & resume* (validates new cap > current spend, updates the rule, resolves) and *acknowledge* (stops alerting; defer continues until window rolls). Rollover auto-resolves open defer-mode incidents (`window_rollover`).
- Ledger verbs: `openBudgetIncident`, `resolveBudgetIncident`, `listBudgetIncidents({openOnly, since})`. App facade in `src/core/execution-ledger.ts`.

**Acceptance:** cap breach opens exactly one incident per (rule, window) across restarts; raise updates the models-plugin rule and the next gate call allows; acknowledged incidents stop notifying but keep deferring; rollover auto-resolves.

### 4.4 Pause-at-cap mode (V5)

`atCap: 'pause'` per rule (default `'defer'`).

- `'defer'` (today): task stays claimable, auto-resumes at window rollover.
- `'pause'`: the cap incident requires resolution — the gate keeps blocking that rule's scope **even after window rollover** until resolved (raise, or explicit acknowledge-resume). Mirrors paperclip's no-auto-resume, opt-in only.
- Implementation: gate checks open unresolved `kind='cap'` incidents for pause-mode rules before evaluating spend.

**Acceptance:** pause-mode breach still blocks after simulated rollover until resolved; defer-mode resumes at rollover unchanged (regression).

### 4.5 Kill switch (V5)

`settings.dispatch.paused: boolean` (default false) in `~/.bakin/settings.json`.

- Checked at the top of all three dispatch gates and the billed-media gate; when true → defer/refuse with typed reason `dispatch_paused` (audited once per activation, not per task).
- Surfaces: System & Alerts settings tab; a **header banner** in the client shell while active ("Dispatch paused — resume in Settings"); `bakin budget pause|resume`; state shown in `bakin spend`, Spend tab, health check.
- Watchdog/doctor internal maintenance sends stay allowed (cheap, diagnostic); documented boundary: kill switch stops **task dispatch + billed media**, not Bakin's own health probes.

**Acceptance:** toggling pauses new dispatch within one cycle; in-flight turns finish; banner appears; resume restores dispatch; setting survives restart.

### 4.6 Per-call media gating (G7, V6)

Before each billed image provider call (`generate`, `edit`): consult kill switch + §4.1/§4.2 for the acting agent **and the image model's provider/lane**. On `defer` (or paused): do **not** call the provider; return a typed tool error `{ code: 'budget_exceeded' | 'dispatch_paused', scope, scopeId?, lane, window, unit, capValue, spentValue }` the agent can relay; open/attach the incident; audit. `warn` does not block media calls (avoids mid-task flapping) — it only ensures the warn incident exists.

**Acceptance:** with the Gemini provider rule exhausted, `generate` on a Gemini model returns the typed error with no provider call/idempotency row, while an Anthropic-provider dispatch still proceeds; under cap it bills normally.

### 4.7 Proactive alerting (G5, V3)

One notify engine, `src/core/budget-notify.ts`, triggered **on incident open** (not by polling):

1. **SSE / browser:** broadcast plugin-event `budget.incident_opened` (and `_resolved`); `use-sse.ts` fires `sendBrowserNotification('Budget alert', …)` — same mechanism/toggle as workflow gates. Nav/health badge refresh piggybacks the existing audit stream.
2. **Agent relay:** one concise message to the main agent via `runtime.messaging.send` per incident open (metered via the existing `meterAgentTurn` path). The doctor check remains the *state* surface; incident-open triggering beats doctor-interval polling.

**Acceptance:** breach while a background tab is open → OS notification; main agent receives exactly one message per incident (restart-safe via the incident UNIQUE); acknowledged/resolved incidents don't re-notify.

### 4.8 Onboarding + unset-budget nag (G6, V2)

- New onboarding component `budget` in `COMPONENT_ORDER` (`src/core/onboarding/`): `check()` = ≥1 cap rule exists; `install()` = interactive prompt (no suggested default; example "e.g. 25 daily / 300 monthly, global"), writes via the models-plugin settings path; skippable (`--yes` skips with a printed warning).
- `budget` health check gains a standing **notice-level** row when no rule is set: "Spend is uncapped — set a budget (Models → Spend)". Notice, not warn.

**Acceptance:** fresh onboard prompts; skip leaves a doctor notice; setting any rule clears it.

### 4.9 Visibility surfaces (G1–G4, G9, V7, V8)

**Spend tab (models plugin):**
- **Lane split everywhere:** metered (estimated $, tokens alongside) vs subscription (**tokens only, no $**, labeled "included in subscription") vs unpriced-metered (tokens, honest); per-agent, per-provider, and per-model tables.
- Utilization card per cap rule in the rule's unit: progress bar, `$spent of $cap (N%)` or `3.2M of 5M tokens (64%)`, remaining, window reset time, warn marker at `warnPct`; **pace projection** ("on pace ~$X / ~N tokens by month end", linear, colored vs cap).
- **Cap-rule editor:** rule rows with scope picker (global / agent / provider), lane (which sets the unit and the input's label), daily/monthly, warnPct, atCap. Fixes the current `saveBudget` drop bug by construction (the whole rule list round-trips).
- Open-incident banner with resolve actions (raise & resume / acknowledge).
- Window-alignment fix: utilization always computes on cap windows regardless of the browse-window selector; unattributed share shown with coverage note.

**Health dashboard:** spend card gains utilization + pace vs the tightest matching rule, lane-split; `budget` check becomes rule-aware (evaluates every rule with faceted spend, attaches `data.agents`/`data.rules` rows — UIs never parse text) and maps into Attention chips (`kind: 'budget'`); kill-switch state shown.

**Tasks UI:** lightweight status endpoint `GET /api/plugins/models/budget/status` → `{ paused, perAgent: {agentId: 'ok'|'warn'|'deferred'}, deferredProviders: [...], openIncidents }` from the shared engine. Tasks plugin polls it alongside `use-gate-status` and badges todo tasks whose target agent (or global/provider rule) is deferred: card badge "Budget-deferred", detail line with rule + reason + resume time. No task metadata writes — state is derived.

**CLI (`src/cli/commands/budget.ts`, wired in `cli/bakin.ts`):**
- `bakin spend [--window 24h|7d|30d|day|month]` — lane-split totals (metered in $, subscription in tokens), per-agent/per-provider/per-model, utilization vs rules, unattributed share, kill-switch state.
- `bakin budget show | set --scope global|agent|provider [--id <scopeId>] --lane metered|subscription [--daily N] [--monthly N] [--warn-pct N] [--at-cap defer|pause] | rm … | pause | resume | incidents [--resolve <id> --action raise|ack --cap N]` — `N` is USD on metered rules, tokens on subscription rules; the command echoes the unit back.
- HTTP-client only (`src/cli/http.ts` plumbing; `process.exit` convention).

**Acceptance:** every surface reads the shared engine/status endpoints (no parallel math); a deferred task is visibly badged within one poll; CLI output matches the Spend tab; subscription rows are visually distinct from metered rows on every surface.

---

## 5. Commands

- Build: `bun run build` (⚠ mutates `generated-version.ts` — never commit it).
- Tests: `bun run test` (full), `bun test tests/<path> --isolate` (single).
- Dev: `bun run dev:mock` for UI; `bun run instance dev` for real-adapter verification (isolated mode for tests).
- Verify skill: `/verify` (isolated boot + HTTP drive) for end-to-end checks.

## 6. Project structure (touch map)

```
src/core/budget.ts                       BudgetRule/BudgetPolicy rewrite; rule-based evaluateBudget (pure)
src/core/budget-spend.ts                 NEW — assembleBudgetSpend (lanes × scopes; attributed + unattributed delta; one engine)
src/core/budget-notify.ts                NEW — incident-open notify (SSE plugin-event + main-agent relay)
src/core/dispatch-turns.ts               budgetGate: rule evaluation, incidents replace in-memory debounce; kill switch; pause-mode; provider resolution pre-claim
src/core/dispatch-{cycle,single,workflow}.ts  kill-switch check (shared helper)
packages/core/src/execution/ledger.ts    run_costs +provider +lane columns (migration/backfill); budget_incidents table + verbs
src/core/execution-ledger.ts             facade for new verbs
packages/core/src/settings.ts            dispatch.paused
src/core/agent-cost.ts                   record provider/lane on spend rows; lane resolution
packages/adapter-openclaw/src/*          auth-profile billing-mode probe surface (plan-phase schema check)
src/core/onboarding/{index,budget}.ts    NEW component in COMPONENT_ORDER
plugins/images/lib/tools.ts              per-call media gate (provider/lane-aware) + typed error
plugins/models/data/known-models.ts      billingMode override field; provider normalization helper
plugins/models/lib/{routes,route-schemas}.ts   /budget PUT (rule list), /budget/status, /budget/incidents(+resolve), /spend lane/provider facets
plugins/models/components/spend-tab.tsx  lane split, utilization, pace, rule editor, incident banner
plugins/health/lib/system-checks/budget.ts     rule-aware eval, unset-budget notice, kill-switch state, structured data rows
plugins/health/components/*              spend card utilization/pace + lane split; attention chip kind 'budget'
plugins/tasks/hooks/use-budget-status.ts NEW poll; task-card/detail badge
src/hooks/use-sse.ts                     browser notification on budget.incident_opened
packages/host/src/components/layout/*    kill-switch header banner
src/cli/commands/budget.ts + cli/bakin.ts     bakin spend / bakin budget
tests/**                                 per §8
.claude/knowledge/{models-plugin,execution-ledger,usage-recording,dispatch,doctor-and-health-checks,agent-health-diagnostics,tasks-plugin}.md + CLAUDE.md key-patterns line
README.md                                only if it makes budget/spend claims (verify during docs phase)
```

## 7. Code style

Repo conventions apply unchanged: TS strict; zod at boundaries (new routes/schemas); `createLogger`; kebab-case files; conventional commits with scope; import order per CLAUDE.md; typed reasons/kinds — **never classify by message text** (architecture-test enforced); UIs read structured `data`, never parse check messages.

## 8. Testing strategy

CLAUDE.md testing rules are mandatory (mock BOTH content-dir resolvers + OpenClaw home; `getBakinPaths` mocks include `db`; `closeDb()` before `rmSync`; mock logger/watcher/AppServices; `--isolate`; never touch `~/.bakin`/`~/.openclaw`). TDD (RED→GREEN) per task.

- **budget-spend:** lane/provider faceting truth table (token + dollar sums per facet; no $ computed for subscription lane); attributed+unattributed assembly (NULL-cost sessions, day alignment, negative-delta clamp, month summation); lane resolution precedence (override → auth-probe → metered default); parity across all consumers (one-engine test).
- **cap rules:** evaluator truth table over scope × lane × window × unit (metered USD vs subscription tokens); worst-breach selection; empty rules = allow; provider rule scoping (only matching-provider dispatch defers); `'model'` scope accepted by schema/evaluator (future-proofing regression).
- **incidents:** UNIQUE-open idempotency across simulated restart; resolve actions (raise validates > spend); rollover auto-resolve; pause-mode blocks past rollover until resolved; audits carry incident id.
- **kill switch:** all three dispatch paths defer; media tool refuses; single activation audit; settings round-trip.
- **media gate:** provider-rule-exhausted `generate` → typed error, no provider call, no idempotency row; other-provider dispatch unaffected; warn does not block.
- **notify:** one SSE event + one agent message per incident open; ack/resolve silence; restart no re-notify.
- **onboarding:** component check/install; `--yes` skip warning; doctor notice appears/clears.
- **routes/UI data:** `/budget/status`, `/budget/incidents`, PUT round-trips the full rule list (regression on the old perAgent drop bug); plugin tests via `tests/plugins/test-helpers.ts`.
- **CLI:** command output paths against a mocked server (exit codes per convention).
- **Regressions:** no-rules = allow everywhere; defer-mode rollover resume; existing gate/metering tests keep passing (updated to the rule shape, not shimmed).

## 9. Boundaries

**Always:** one spend engine (`assembleBudgetSpend`) behind every surface; NULL-honest dollars (never fabricate, never $0-fill); unit-per-lane (subscription usage is NEVER presented in dollars — tokens only; metered dollars always labeled "estimated" with tokens alongside); incidents = coordination facts in the ledger — never content; typed reasons; fail-closed gate on ledger-unavailable (unchanged); adapter boundary (auth-profile reads via the allowlisted raw-config gate; runtime messaging via `ctx/AppServices.runtime`).

**Ask first:** any non-empty default cap; auto-pausing *agents* (vs dispatch) at cap; extending the kill switch to block watchdog/doctor probes; gating on provider quota windows; new notification channels beyond browser + agent relay.

**Never:** parallel stat/cost tracker (extend recorder/ledger/usage.db only); parse health-check message text in UIs; in-flight turn aborts at cap (rejected); backwards-compat shims (replace the old BudgetPolicy shape outright; delete the in-memory debounce); commit `generated-version.ts`; let tests touch real home dirs.

## 10. Phased roadmap + commit strategy (rollback checkpoints)

Each commit builds green and passes the full suite; each phase is a natural rollback point.

**Phase 1 — Spend engine: lanes, providers, total-observed basis (G8, G10)**
- C1.1 `feat(core): run_costs provider + lane columns (migration + backfill from model ids)`
- C1.2 `feat(core): billing-mode lane resolution (catalog override + auth-profile probe, metered default)`
- C1.3 `feat(core): assembleBudgetSpend — faceted total-observed spend engine`
- C1.4 `refactor(core): budgetGate + budget health check + /spend consume the shared engine`
- *Checkpoint: spend is lane/provider-faceted and total-observed; behavior identical with no rules changed.*

**Phase 2 — Cap rules + incidents + enforcement modes (V5, V9)**
- C2.1 `feat(core): BudgetRule policy rewrite + rule-based evaluateBudget (replaces global/perAgent shape)`
- C2.2 `feat(core): budget_incidents ledger table + open/resolve/list verbs`
- C2.3 `feat(core): budgetGate opens incidents (replaces in-memory debounce) + rollover auto-resolve + provider-scoped deferral`
- C2.4 `feat(core): atCap pause mode — unresolved cap incident blocks past rollover`
- C2.5 `feat(core): dispatch kill switch (settings.dispatch.paused) across all dispatch paths`
- *Checkpoint: durable, rule-scoped enforcement; defer-mode regression-guarded.*

**Phase 3 — Media gating (G7)**
- C3.1 `feat(images): per-call budget + kill-switch gate (provider/lane-aware) with typed budget_exceeded error`
- *Checkpoint: within-turn leak closed.*

**Phase 4 — Alerting + onboarding (G5, G6)**
- C4.1 `feat(core): budget-notify — SSE incident events + main-agent relay on incident open`
- C4.2 `feat(host): browser notification for budget incidents (bell mechanism)`
- C4.3 `feat(core): onboarding budget component + unset-budget doctor notice`
- *Checkpoint: proactive awareness complete.*

**Phase 5 — Surfaces (G1–G4, G9)**
- C5.1 `feat(models): /budget/status + /budget/incidents routes; PUT round-trips the rule list`
- C5.2 `feat(models): Spend tab — lane split, utilization, pace, rule editor, incident banner`
- C5.3 `feat(health): rule-aware budget check + attention chips + spend-card utilization + kill-switch banner`
- C5.4 `feat(tasks): budget-deferred task badges via budget status poll`
- C5.5 `feat(cli): bakin spend + bakin budget command group`
- *Checkpoint: every visibility surface live.*

**Phase 6 — Docs + close-out**
- C6.1 `docs(knowledge): cost-control v2 — update models-plugin/execution-ledger/usage-recording/dispatch/doctor/tasks knowledge docs + CLAUDE.md; close #464`
- README checked for impact in this commit.

## 11. Open items for the plan phase

1. **Auth-profile schema probe:** what `auth-profiles.json` actually contains per agent (OpenClaw 2026.6.x) and how reliably subscription vs API-key auth is distinguishable; define the fallback (per-model/agent manual override in the models plugin) when ambiguous.
2. **Quota-window probe:** does OpenClaw expose subscription quota state (used %, resets-at)? If yes → read-only Spend-tab surface this round (no gating); if no → note and drop.
3. Exact usage.db read verbs `assembleBudgetSpend` needs (reuse `usageByAgentDaySince` vs a new windowed rollup) — decide against real store signatures.
4. Legacy `{global, perAgent}` settings: one-shot migration to rules vs reset-with-notice (no dual-read code either way).
5. Where pace-projection math lives (server route vs client) — lean server, one implementation.
6. `budget/status` polling cadence (likely reuse `use-gate-status`).
7. Kill-switch banner placement in the host shell (header vs persistent toast).
8. Media-gate placement: shared gate helper in core called by the images plugin before billing (lean), vs inline in tool bodies.
9. Provider-id normalization: confirm the runtime's `provider/model` id format covers all catalog entries (incl. nanobanana-style image models) and define the unknown-provider bucket.
