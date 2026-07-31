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

Follow-up: report both cases upstream (the `yoga-layout` one is reproducible without any
Bakin code; the TLA one needs a 5-line repro).

**Baseline carried forward** (bun 1.3.13, happy-dom 20.11.1) — re-verified after the revert:
- suite: 8522 pass / 9 skip / 0 fail · act warnings: 294–301 · output: 11,885 lines

## CP-A — Posture
- [ ] T1 silent logger output + `logger.test.ts` owns its env
- [ ] T2 act env owned by `rtl-settle` + `RTL_SKIP_AUTO_CLEANUP` + `plugins-build` import + comments corrected

## CP-B — Act debt (294 → 0)
- [ ] T3 schedule — `calendar-views` (130)
- [ ] T4 workflows — `workflow-actions` (76) + `node-config-drawer` (4) + `approvals-attention` (1)
- [ ] T5 team — `overview-tab` (50) + `heartbeat-tab` (2) + `active-context-tab` (2)
- [ ] T6 tail — `task-detail-gate-refresh` (12), `chat-page` (8), `runtime-hub` (2), `brands-page` (2), `use-record-deep-link` (2), `task-detail-dialog` (1), `brand-detail-save` (1), `copy-to-clipboard` (1)

## CP-C — Gate
- [ ] T7 act gate in `tests/setup.ts` + **prove it bites** (A2)

## CP-D — Fixed sleeps (78 sites, 39 files)
- [ ] T8 `tests/helpers/wait.ts` + replace 4 hand-rolled copies (`dispatch-concurrency`, `conversation-turns`, `chat/queue`, `budget-notify`)
- [ ] T9 adapter-openclaw heavy — `trajectory-forensics` (11), `gateway-rpc` (10), `runtime-abort` (3), `runtime-channels` (1) · run 3×
- [ ] T10 remaining 35 files

## CP-E — Hygiene
- [ ] T11 delete 11 zombie skips

## CP-F — CI
- [ ] T12 canonical `test:ci` + lint on PR/main + `release.yml` sharded
- [ ] T13 completeness gate + **prove it bites** (A5)

## CP-G — Close
- [ ] T14 `.claude/knowledge/test-suite-health.md` + CLAUDE.md + README check
- [ ] T15 done bar — all 14 criteria with recorded output; suite 3× green; lint/typecheck/cycles
- [ ] T16 push → PR → CI green → **Mark live-tests** → merge; update #753, leave it OPEN

## Acceptance criteria ledger (SPEC §4)

| # | Criterion | Result |
|---|---|---|
| A1 | Zero act warnings suite-wide | |
| A2 | Act gate bites (deliberate revert) | |
| A3 | Suite green, count not fallen | |
| A4 | `bun --version` == `.bun-version` == 1.3.14 | |
| A5 | Completeness gate bites (forced skip) | |
| A6 | Only `bun run test:ci` in workflows | |
| A7 | Lint gates PR + main | |
| A8 | Every surviving sleep is a justified `settleFor` | |
| A9 | Output < 8,000 lines, zero `[INFO]` | |
| A10 | No empty-body `it.skip` | |
| A11 | Docs contain no false claim | |
| A12 | Branch CI green incl. completeness job | |
| A13 | 3737 healthy, adapter `pi` | |
| A14 | `tests/cli/**` green (Ink canary) | |

## Findings log

Record anything that contradicts the spec — especially a bun 1.3.14 behavior change, an
act fix that appears to need a `src/` change, or a sleep whose class is ambiguous.

- (none yet)
