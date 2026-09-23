# Spend plugin — limits, billing lanes, pricing, the notification ladder

The 14th core plugin (`plugins/spend/`, initiative #907 / spec `.claude/specs/models-and-spend-overhaul.md` §5–6). ONE rule of ownership: the **models** plugin answers "which model" (selections, catalog, eligibility, routing); the **spend** plugin answers "what it costs" — observed + projected spend per billing lane, the opt-in limits with the fixed 50/75/90/100 ladder, billing-lane overrides, and pricing. Neither plugin imports the other (`tests/architecture/plugin-boundaries.test.ts` has NO plugin→plugin allowlist); shared data lives in core (`@bakin/core/llm/model-catalog`, `@bakin/core/llm/model-id`) and the two talk over hooks.

## Ownership at a glance

| Concern | Owner | Where |
|---|---|---|
| Limits policy (rules with ids, accept-unattributed cutoff) | spend | `~/.bakin/plugin-settings/spend.json` → `limits` (zod: `plugins/spend/lib/settings.ts`) |
| Billing-lane overrides + detection | spend | `spend.json` → `billing.overrides`; `plugins/spend/lib/billing.ts` |
| Pricing of turns / images | spend | `spend.priceTurn` / `spend.priceImage` (catalog pricing from core) |
| Per-agent effective model (for pricing / status) | models | `models.getEffectiveModel`, `models.listAgentModels` (hooks the spend plugin invokes) |
| Spend arithmetic | core | `src/core/budget-spend.ts` — ONE engine (`assembleBudgetSpend` cap windows, `assembleSpendForDays` day sets) |
| Gate decision + milestone crossings | core | `src/core/budget.ts` (`evaluateBudget`, `milestoneCrossings`, `MILESTONES`) |
| Durable milestones + incident episodes | core ledger | `budget_milestones`, `budget_incidents` (v10) — see `execution-ledger.md` |
| Observer + delivery worker | core | `src/core/spend-observer.ts` |
| Coverage receipts | core usage.db | `scan_days` (v5) — see `usage-recording.md` |

## Hooks (`plugins/spend/lib/register-hooks.ts`)

- `spend.getBudgetPolicy` (rpc) → `BudgetPolicy` (`{ rules[], acceptUnattributedBefore? }`). **Absent or throwing = the dispatch gate FAILS CLOSED** with `BudgetDecision.cause = 'budget_policy_unavailable'` (S13) — "we cannot know" is never "no limits". The media gate refuses with the same code; the board shows "Limits unavailable" → Health when `/status` 404s; the health-OWNED `health.spend.policy-available` check names the state (a plugin cannot report its own activation failure).
- `spend.updateBudgetPolicy` (rpc, narrow) — only `acceptUnattributedBefore` (the doctor's accept-unattributed-history repair); full edits are `PUT /limits`.
- `spend.resolveBilling` (rpc) — provider + lane (+ `laneSource` override|detected|default) for an agent/model; `prospective:false` = historical attribution, never substitutes today's model.
- `spend.priceTurn` / `spend.priceImage` (rpc) — estimated micro-dollars from catalog pricing; `null` when unpriced or subscription lane (tokens are that lane's unit; a subscription CHAT auth never suppresses billed IMAGE dollars).

## Routes (`/api/plugins/spend/…`, `plugins/spend/lib/routes.ts`)

| Route | Purpose |
|---|---|
| `GET /spend?window=24h\|7d\|30d\|all` | NULL-honest rollups (by agent/model/work class, timeline) + cap-window `facets` + `pace` + `observedDays { month, daysIntoMonth }` (the pace basis; `null` when receipts are unreadable) |
| `GET /coverage` | Last 30 days split into covered (complete-sweep receipts) vs uncovered, both totals from the day-set engine, plus the suggestion (`ready \| insufficient_history \| evidence_incomplete \| no_metered_spend`) |
| `GET /limits` / `PUT /limits` | The rule list **plus its `revision`** (content hash). PUT REQUIRES the revision the editor loaded (409 `stale_revision { current }` otherwise — a snapshot that never saw the current limits cannot replace them), keeps ids when present and assigns uuids when absent (a fresh id starts its ladder fresh), enforces ONE rule per (scope, scopeId, lane) and unique ids (400), normalizes model-scope ids, warns on unknown agent/provider ids (a typo caps nothing — never blocks), and reconciles live incidents: deleted rule / removed window cap / recreated id ⇒ `rule_removed`, raised cap ⇒ `raised` (both reopenable). 422 `spend_settings_invalid` when the file on disk is not a valid policy (nothing is written over it) |
| `GET /status[?lite=1]` | Kill switch, per-agent `ok\|deferred`, per-task holds (gate's own routing resolution + main-agent fallback), billing lanes, deferred providers, `openIncidents` (with episode/eventId), `milestones` (unacknowledged < 100 rows of the CURRENT windows for rules that still exist). `lite` = kill switch + ladder rows only — the header's ONE 15 s poll |
| `GET /incidents[?all=1]` | Durable breach records (rollover sweep on read) |
| `POST /incidents/:id/resolve` | `raise` (new cap must exceed current spend; the rule is re-found INSIDE the serialized write turn, same id; kicks dispatch) · `ack` (quiet, NOT reopenable; broadcasts `budget.incident_resolved`) · `resume` — resolves **`resumed` (REOPENABLE: going over again is a new episode, so a pause rule re-engages its hold instead of degrading to defer)**; **409 `still_over_limit`** while spend is still at/over the cap (S12): the honest way out is a raise |
| `POST /milestones/:id/ack` | "Dismiss for this window" on a 90 % row; also how the Spend page marks 50/75 heads-ups as seen. Broadcasts `spend.milestone_acknowledged` |
| `PUT /billing/overrides` | Manual lane assignments (agent+provider → agent → provider); rides the same serialized write path |

**Every policy write is ONE path** (`withSpendPolicyWrite`, `plugins/spend/lib/settings.ts`): a process-wide queue that re-reads `spend.json` at the final write boundary, checks the caller's `expectRevision`, validates the next document, and refuses to write over an invalid one. The generic `PUT /api/plugin-settings/spend` consults the plugin's `validateSettings` (new optional `BakinPlugin` member) so no side door leaves an invalid policy on disk. **Reading is fail-closed (S13):** an ABSENT `spend.json` is the empty policy; a file that exists but cannot be parsed or validated (an invalid BILLING section included) throws `SpendSettingsInvalidError` from every read — the `spend.getBudgetPolicy` hook rejects, the dispatch/media gates defer `budget_policy_unavailable`, and both `spend.policy-available` (health-owned) and `spend.budget` name the file, action required. Never "no limits". Every policy write kicks an observer pass so the ladder/incidents reflect the new rules now.

Models keeps `/available` (the rule editor's scope suggestions read it over plain HTTP) and everything else about *which* model.

## The one-shot settings upgrade (`plugins/spend/lib/settings-upgrade.ts`, spec §10)

Runs at spend activation **before** the hooks register (the gate fails closed meanwhile, so a mid-upgrade crash never runs uncapped). Idempotent and crash-safe, and it never destroys what it cannot read: an UNREADABLE `models.json`/`spend.json` or a present-but-INVALID `spend.json` ⇒ **`blocked`** (nothing written, the hooks then fail closed with the file named). `spend.json` valid ⇒ done — if `models.json` still carries `budget`/`billing` AND the backup exists, that is a crash between the two writes (resume by stripping); WITHOUT the backup there is no proof the keys were ever migrated (an earlier boot initialized an empty destination), so they are MERGED into the destination (destination wins on collisions). Otherwise back up `models.json.pre-spend.bak` **once, atomically, never rewritten**, build the document — rule-list budgets AND the pre-v2 `{ global: { dailyUsd, monthlyUsd }, perAgent }` metered-dollar shape (its mapper is composed here; a box that skipped releases keeps its caps) — uuid per rule, `warnPct` dropped, `atCap` kept, invalid or duplicate-identity legacy rules REPORTED not silently dropped, write it atomically, then strip the source keys. Rollback = code revert + restore the backup (the additive ledger columns are ignored by older code).

## Limits are opt-in — the S8 contract

No limits is a **healthy, plainly stated fact** everywhere: the `spend.budget` doctor check reports "No spending limits set — spend is recorded, nothing is capped" as healthy (the old `policy-missing` incident is gone); the onboarding `budget` component prints one line, never prompts, never writes, `check()` is always ok (`ONBOARDING_VERSION` 5); `bakin spend` / `bakin budget show` state it once. The Spend page's empty state offers **Add a limit**. There is no warn threshold anywhere (`warnPct` is gone from the schema, CLI and editor); the ladder is fixed.

## Coverage-aware suggestion (D27/D32, `plugins/spend/lib/coverage.ts`)

A day counts as **observed** only when a usage sweep completed with FULL roster coverage (`scan_days` receipt, written by `scanUsageHistory` on `coverage.status === 'complete'` — partial/unavailable sweeps record nothing). `coverageSummary(30)` = covered days + uncovered days, each priced by `assembleSpendForDays` (the ONE engine — the plugin adds no arithmetic beyond the daily rate, so the suggestion equals the Overview by construction; the same $10 in `run_costs` and usage.db counts once). `suggestMonthlyLimit`, in order of honesty: `< 14` covered days ⇒ `insufficient_history` (days needed); any rule-relevant evidence gap or unavailable usage store on covered days ⇒ `evidence_incomplete`; zero metered spend ⇒ `no_metered_spend` (the subscription-only story); else `roundToNice(1.5 × rate × 30)` ($5 steps under $100, $50 under $1,000, $500 above) with its basis, and spend on unobserved days reported separately, never in the rate.

## The ladder (D19/D22, spec S9)

`MILESTONES = [50, 75, 90, 100]` — fixed. `milestoneCrossings(policy, facets)` (pure, gate arithmetic, rules without an id contribute nothing) → the observer records durable `budget_milestones` rows keyed by rule id + window + window start; rows below the highest NEW one in a pass are `covered_by` it (recorded already-notified); the 100 row is covered by the cap incident, which the observer opens **or reopens** on every at/over-cap pass (UNIQUE makes a live one a no-op; a raise-resolved one that breached again becomes episode 2 with a fresh `event_id`).

| Level | User sees | Source of truth |
|---|---|---|
| 50, 75 | Toast + OS notification, once per `eventId` (client seen-set; at-least-once delivery may repeat) | `spend.milestone` SSE (aggregated per rule: highest + how many it speaks for) |
| 90 | Yellow header bar ("90% of your monthly limit … work stops at the line") with Review + Dismiss (= `POST /milestones/:id/ack`, per window) | `/status.milestones` rows, `acknowledged_at` |
| 100 | Red header bar ("limit reached") with Raise limit (→ `/spend?tab=limits`); a **pause** row offers Resume as-is (a 409 prints the server's reason and turns the link into "Raise limit to resume"), a **wait/defer** row offers Acknowledge (it releases itself at rollover — a Resume it can never take would be a stuck bar). Cap notifications de-duplicate on `eventId` | open `budget_incidents` row (episode, `event_id`, `at_cap`) |
| Any | Spend nav badge: worst level present — any open cap = error, unacknowledged 90 = attention, unseen 50/75 = info (spec §6: attention at every level; opening the Spend page acknowledges the 50/75 rows). Rows the rule's open cap incident supersedes (a 49→101 jump, or a 90 that reached 100) and rows crossed under a since-raised cap are history, not attention | `plugins/spend/components/attention.ts` (pure rules) + `liveMilestones` in `routes.ts` |

Header bars are rows of ONE fixed stack (`packages/host/src/components/layout/header.tsx` `HeaderBar`; order update → kill switch → cap bars → 90 % bars); the header/shell shift by `count × --bakin-banner-height`. Everything derives from durable rows on reload with no SSE.

### Observer + delivery (`src/core/spend-observer.ts`)

`observeSpend(now)` — coalesced single-flight (a call during a pass schedules exactly one follow-up with the latest `now`); memo keyed on `(day start, rules revision, spend generation)` so a post-write pass never reuses pre-write totals. Hook points: every `recordSpend` (through the leaf `src/core/spend-events.ts` seam the observer subscribes to at boot — keeps metering out of the observer graph), every usage sweep, the watchdog tick, and boot (`startup-recovery`, right after dispatch/watchdog start). The policy is re-read AFTER the spend read: crossings commit only against the policy they were computed for (a rule deleted mid-pass can never come back as an orphan incident — the pass recomputes). Rollover cleanup runs first in every pass. `deliverPending()` — its OWN single-flight mutex with coalescing, shared by observer/boot/watchdog: sweeps rollover FIRST (a headless boot never relays yesterday's already-released defer alert), sends undelivered milestone rows (< 100) grouped per rule × window × window start (a daily-75 and a monthly-50 are two events; rows of a deleted rule or an ended window are marked as history, never sent; an unreadable policy leaves milestone rows waiting) and cap incidents (the `budget-notify` fan-out, now async and per-channel: SSE + one metered main-agent relay carrying the event id), then marks the exact `(id, event_id)` — a cap incident only once the RELAY succeeded; a failed relay stays pending and the next pass retries, browsers de-duplicating the repeated SSE on `eventId`. At-least-once by construction. Both the gate's `recordBudgetBreach` and the observer write the same `budget.incident_opened` audit row when THEY open an episode (history is independent of which path saw the threshold first); the gate's `budget.deferred` is the turn hold, and a missing/throwing policy hook audits `budget.policy_unavailable` once per day window. The ledger v10 migration stamps already-acknowledged/resolved v9 incidents as delivered and re-delivers still-open ones once (v9 kept no receipt; a duplicate alert beats a live hold nobody was told about).

## UI (`plugins/spend/components/`)

`/spend` (nav "Spend", Operations, `CircleDollarSign`; `?tab=overview|limits`, `?window=`, `?spendBy=`). `use-spend-data.ts` is the page's data hook (`PLUGIN_ID = 'spend'`; roster via the shared `useAgentList`; scope suggestions from models' `/available`). Overview = lane-honest `StatGroup` ("Not metered" / "None" when a lane has no rows — "$ unavailable" stays for unpriced rows), the pace line with its observed-days basis, `AreaChart` + metric toggle, utilization tiles, `SpendBreakdown`. Limits = the guided **Add a limit** dialog (`limit-dialog.tsx`: what you spend on watched days → monthly limit prefilled from the suggestion or the honest reason there is none, optional daily cap, reaction radio "Wait for the next period" / "Pause matching work until I raise or resume" persisted as `defer|pause` — D21 — and the fixed notification line), the rule editor (`Add a rule`), billing lanes. Incident banners sit above the tabs. `spend-badge-provider.tsx` rides `nav-badge-providers` (plugin is `eager`). Enrolled **conformant** (`bakin.ui-test.ts`, `tests/ui.fixture.tsx`, run by `ui:test:conformance`).

## CLI (`src/cli/commands/budget.ts`)

`bakin spend [--window …] [--json]` (pace line with basis; "no limits" stated once), `bakin budget show` (rules + milestone state), `bakin budget set --monthly N [--daily N] [--at-cap wait|pause] [--scope … --id …] [--lane …]` (scope/lane default global/metered; `wait` persists as `defer`; editing an identity keeps its id; `--warn*` refused with the reason), `rm`, `pause`/`resume` (kill switch), `incidents [--resolve …]`.

## Tests

`tests/plugins/spend/{routes,registration,settings-upgrade,coverage,health-checks,billing,badge-provider,spend-page}.test.*`, `tests/core/{spend-observer,budget,budget-gate,budget-spend,budget-milestones-ledger,ledger-v10-incident-episodes-migration}.test.ts`, `tests/plugins/health/spend-policy-check.test.ts`, `tests/components/header-update-banner.test.tsx` (bars), `tests/cli/budget-command.test.ts`, `tests/core/onboarding/budget.test.ts`. Registry fakes in dispatch tests must answer `spend.getBudgetPolicy` — an absent hook fails closed by design.
