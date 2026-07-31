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
- [ ] T0 branch + bun 1.3.14 (local + `.bun-version`) + RTL/happy-dom + one 3737 restart + re-baseline

**Re-baseline on 1.3.14** (fill in — do not carry the 1.3.13 numbers forward):
- suite: ___ pass / ___ fail · act warnings: ___ · output lines: ___

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
