# Test-Suite Health — Task Checklist (#753)

Branch: `chore/test-suite-health-753` · Spec: SPEC.md v1 · Plan: PLAN.md v1

## Baseline (main @ d949de6e8, bun 1.3.13, 2026-07-30)

| Metric | Value |
|---|---|
| Suite | 8522 pass / 9 skip / **0 fail** · 8531 tests · 842 files · 101s |
| act warnings (isolated per file) | **294** across 15 files |
| act warnings (full parallel run) | 301 |
| Output volume | 11,885 lines · 3,958 logger lines · 1,641 from `storage-db` |
| Fixed sleeps | 78 sites · 39 files |
| Zombie skips | 11 |

Posture validation (pre-planning, reverted): global act env ⇒ 31 Ink failures + 4 logger;
act env scoped to `rtl-settle` ⇒ green, detection preserved (130 / 50). See SPEC §2.3.

## CP-0 — Foundation
- [x] T0 branch + toolchain — **bun stays 1.3.13** (see finding F1), happy-dom → 20.11.1, RTL already latest (16.3.2)

**F1 — bun 1.3.14 is a regression for this suite. Do not upgrade.**

Measured, not inferred. Isolation matrix (`tests/cli/readonly-logs.test.ts`):

| bun | happy-dom | result |
|---|---|---|
| 1.3.13 | 20.9.0 | green |
| 1.3.13 | **20.11.1** | **green** — the bump is safe |
| **1.3.14** | 20.9.0 | **fail** |
| **1.3.14** | 20.11.1 | **fail** |

Full suite on 1.3.14: **124 fail / 48 errors**, 8443 tests (88 fewer dispatched) vs
8522 pass / 0 fail on 1.3.13. Both failure classes are the same root cause — an ESM
module-initialization (TDZ) regression:

- `Cannot access 'Yoga' before initialization` × **62** — `ink/build/styles.js:3`
  importing `yoga-layout`. Third-party; nothing of ours involved. Kills the CLI TUI tests.
- `Cannot access 'NativeResponse' before initialization` × **47** —
  `tests/integration/pi/fake-provider.ts:25`, which is a **top-level await**
  (`const NativeResponse = (await nativeFetch(…)).constructor`). 1.3.14 lets module
  functions execute before the TLA settles, which valid ESM forbids. Surfaces as the Pi
  "Connection error." family and the runtime-conformance failures.

Consequence for D3: its rationale ("don't build fixes on a version we're about to
leave") inverts — 1.3.14 is not a version we can move to. `.bun-version` stays 1.3.13
and is doing exactly the job it exists for. Re-evaluate on 1.3.15+ by re-running the
matrix above **before** repinning.

Filed as **#755** (yoga-layout / Ink) and **#756** (top-level await). Both carry the
isolation matrix and a repro checklist; the upstream decision is deferred until this
initiative lands. Note on #756: it is avoidable on our side by resolving `NativeResponse`
lazily, but we deliberately have **not** applied that workaround — it would mask the bug
and destroy the reproduction.

**Baseline carried forward** (bun 1.3.13, happy-dom 20.11.1) — re-verified after the revert:
- suite: 8522 pass / 9 skip / 0 fail · act warnings: 294–301 · output: 11,885 lines

## CP-A — Posture
- [x] T1 silent logger output + `logger.test.ts` owns its env — output 11,885 → 3,735 lines, zero logger lines
- [x] T2 act env owned by `rtl-settle` + `RTL_SKIP_AUTO_CLEANUP` + comments corrected

**F2 — removing RTL's bare cleanup surfaced 8 more files. The census grew 294 → 315.**

RTL's auto-registered `afterEach(cleanup)` ran *before* our settle-then-unmount hook and
tore roots down early, suppressing warnings that would otherwise land during the drain.
It was hiding real work-in-flight, not preventing it. With it gone the detector sees
everything:

| new file | warnings |
|---|---|
| `plugins/chat/chat-page-routing` | 5 |
| `plugins/workflows/workflows-page` | 3 |
| `plugins/workflows/workflow-detail` | 3 |
| `plugins/team/agent-detail-adopt` | 2 |
| `host/global-search-overlay` | 2 |
| `plugins/workflows/map-step-ui` | 1 |
| `plugins/brands/brand-doc-editor` | 1 |
| `components/rtl-settle-probe` | 1 |

`plugins/memory/use-record-deep-link` also went 2 → 4, and `workflow-actions` 76 → 77,
for the same reason. **CP-B's scope is 23 files, not 15.** No file fails; this is purely
detection improving.

**T0 note (deviation from PLAN):** the `plugins-build` rtl-settle import was dropped — it
is not an RTL file. It only writes an RTL import inside a fixture *string* for the plugin
builder to compile, so the real RTL count is 124, all already importing the helper.

**F3 — `bunfig.toml [test.env]` is not read by bun 1.3.13.** Probed: a var set there
arrives `undefined` in the test process; `NODE_ENV=test` appears only because `bun test`
sets it itself. The block this repo carried was decorative. Test-run env now lives in the
`tests/setup.ts` preload, which actually executes, using `??=` so a shell override wins.

## CP-B — Act debt (294 → 0)
- [x] T3 schedule — `calendar-views` (130)
- [x] T4 workflows — `workflow-actions` (76) + `node-config-drawer` (4) + `approvals-attention` (1)
- [x] T5 team — `overview-tab` (50) + `heartbeat-tab` (2) + `active-context-tab` (2)
- [x] T6 tail — `task-detail-gate-refresh` (12), `chat-page` (8), `runtime-hub` (2), `brands-page` (2), `use-record-deep-link` (2), `task-detail-dialog` (1), `brand-detail-save` (1), `copy-to-clipboard` (1)

## CP-C — Gate
- [x] T7 act gate in `tests/setup.ts` + **prove it bites** (A2)

## CP-D — Fixed sleeps (78 sites, 39 files)
- [x] T8 `tests/helpers/wait.ts` + replace 4 hand-rolled copies (`dispatch-concurrency`, `conversation-turns`, `chat/queue`, `budget-notify`)
- [x] T9 adapter-openclaw heavy — `trajectory-forensics` (11), `gateway-rpc` (10), `runtime-abort` (3), `runtime-channels` (1) · run 3×
- [x] T10 remaining files

## CP-E — Hygiene
- [x] T11 delete 9 zombie skips (2 were env guards, correctly kept)

## CP-F — CI
- [x] T12 canonical `test:ci` + lint on PR/main + `release.yml` sharded
- [x] T13 completeness gate + **prove it bites** (A5)

## CP-G — Close
- [x] T14 `.claude/knowledge/test-suite-health.md` + CLAUDE.md + README check
- [x] T15 done bar — all 14 criteria with recorded output; suite 3× green; lint/typecheck/cycles
- [x] T16 push → PR #757 → CI green → **awaiting Mark's live test** → merge; update #753, leave it OPEN
- [ ] T16b merge after approval → CI green → **Mark live-tests** → merge; update #753, leave it OPEN

## Acceptance criteria ledger (SPEC §4)

| # | Criterion | Result |
|---|---|---|
| A1 | Zero act warnings suite-wide | **PASS** — 0 across 3 consecutive full runs |
| A2 | Act gate bites (deliberate revert) | **PASS** — reverting the heartbeat-tab fix produces `act gate: 2 React update(s)… (HeartbeatTab x2)` against that exact test; silent when clean |
| A3 | Suite green, count not fallen | **PASS** — 8522 pass / 0 fail / 0 skip. Total moved 8531 → 8522 only because 9 empty zombie tests were deleted |
| A4 | `bun --version` == `.bun-version` | **PASS** — both 1.3.13. Held there deliberately: 1.3.14 is a regression (F1, #755/#756) |
| A5 | Completeness gate bites (forced skip) | **PASS** — healthy: 842 discovered / 842 accounted, exit 0. Dropping 7 contiguous files from a shard: exit 1, names all 7 |
| A6 | Only `bun run test:ci` in workflows | **PASS** — `grep "run: bun test" .github/workflows` returns nothing |
| A7 | Lint gates PR + main | **PASS** — present in both (was release-only) |
| A8 | Every surviving sleep justified | **PASS** — 78 → 12, each either simulated mock latency or a real time window, all labelled |
| A9 | Output < 8,000 lines, zero `[INFO]` | **PASS** — **740 lines** (from 11,885), 0 INFO |
| A10 | No empty-body `it.skip` | **PASS** — 9 deleted; the 2 remaining are `if (!HAS_GIT)` env guards |
| A11 | Docs contain no false claim | **PASS** — the "auto-cleanup is inert" / "~450 tests" claims are gone from CLAUDE.md, setup.ts, rtl-settle.ts |
| A12 | Branch CI green incl. completeness | **PASS** — PR #757, all 8 jobs green. The completeness job reports 842 discovered / 842 accounted across 6 reports on the real runners; its shard logs contribute 281/281/280 files against junit's 280/281/279, so the stdout source is demonstrably catching the all-skipped files junit omits |
| A13 | 3737 healthy, adapter `pi` | **PASS** — restarted on the branch, HTTP 200, pid 30084, adapter unchanged (`pi`) |
| A14 | `tests/cli/**` green (Ink canary) | **PASS** — 282 pass / 0 fail |

## Findings log

Record anything that contradicts the spec — especially a bun 1.3.14 behavior change, an
act fix that appears to need a `src/` change, or a sleep whose class is ambiguous.

- **F1** bun 1.3.14 regression → #755, #756 (above).
- **F2** removing RTL's cleanup grew the census 294 → 315 across 23 files — detection
  improving, not a regression (above).
- **F3** `bunfig.toml [test.env]` is not read by bun 1.3.13 (above).
- **F4 — two time bombs, both pre-existing, both triggered mid-initiative by a date
  rollover.** `memory/routes/record.test.ts` hardcoded a `2026-07-01` fixture against the
  route's 30-day audit retention: it aged out at midnight and would have 404'd forever.
  `health/budget.test.ts` assumed "start of month" is older than "today" — false on the
  1st, so it failed on the 1st of every month. Both fixed at the cause (relative fixture /
  pinned clock). Neither was caused by this work; both were found because it re-ran the
  suite repeatedly across a date boundary.
- **F5 — the act gate's first real catch was the harness itself.** `rtl-settle`'s afterEach
  drained OUTSIDE act, so every update it flushed was by definition un-acted and got blamed
  on the test that had just finished (6 phantom `KanbanBoard` warnings under load). Drains
  now run inside act.
- **F6 — a product bug surfaced by the cleanup.** `OverviewTab`'s Tokens tile rendered
  `fmtNum(usage?.tokens.total ?? 0)`, claiming zero tokens when usage was merely
  unavailable; the test that should have caught it was asserting the LOADING state while
  its name claimed otherwise. Fixed (owner-approved src/ change) to render `—`.
- **F7 — automation is unsafe for this class of edit.** Two transformer rounds were
  reverted rather than shipped: a regex that spanned test boundaries and merged two tests,
  and a condition generator that emitted vacuous polls (`Boolean(counts)` on an array).
  The remaining 78 sleep sites were read by hand.
