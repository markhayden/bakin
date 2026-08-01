# Test-Suite Health — Act Discipline, Stall Detection, CI Coherence (#753)

**Status:** SPEC (v1, 2026-07-30)
**Issue:** [#753 — Test-suite health: act() debt + a parallel-only worker stall](https://github.com/markhayden/bakin/issues/753)
**Predecessor:** #687 / #750, where the CI instability was bisected and the feature code proven innocent.

## 1. Objective

Make the test suite trustworthy: every run either reports the truth or fails loudly.
Three properties, none of which hold today:

1. **No unobserved async work.** A test that ends with React work in flight is the one
   confirmed mechanism for pinning a `--isolate` worker open forever. That class is
   currently detected by accident and ignored (294 warnings), which is worse than not
   detecting it.
2. **No silent short-runs.** A run that never dispatches ~7 files must not be reportable
   as green. This is the failure mode that actually costs us — it hides missing coverage
   behind a passing badge.
3. **One definition of "the suite."** Four hand-written `bun test` invocations have
   already drifted; the release pipeline still runs the pre-sharding configuration under
   a comment claiming it matches PR CI.

**Operating principle:** fix at the cause, then make the cause impossible to reintroduce
with a gate. Every item below either removes a defect or installs the gate that keeps it
removed. Where a gate is not possible, the residual risk is written down.

**Priority (owner):** tech-debt reduction. This machine is the only user — no backwards
compatibility, no shims, no deprecation paths.

## 2. Ground truth (measured 2026-07-30, on `main` @ `d949de6e8`)

All numbers below were measured, not estimated. Reproduction commands are in §6.

| Fact | Value |
|---|---|
| Suite size | 8531 tests, 842 files |
| Baseline result | 8522 pass, 9 skip, **0 fail**, 101s local (4 workers) |
| act warnings (each RTL file run in isolation) | **294 across 15 files** |
| act warnings (full parallel run) | 301 — load-dependent, same class |
| RTL files | **124**, all of which import `tests/rtl-settle` |
| Test output volume | 11,885 lines, of which **3,958 are logger lines** (1,641 `storage-db`) |
| Fixed-sleep settles | **78 sites across 39 files** |
| Zombie skips (`it.skip` with empty body) | **11** |
| Local bun / CI bun | 1.3.13 / 1.3.13 (`.bun-version`) — latest is 1.3.14 |

### 2.1 The root cause nobody had found

`tests/setup.ts` asserts that "RTL auto-cleanup is inert under bun — test globals are not
visible at module-eval time." **This is false on bun 1.3.13.** Traced with a
`defineProperty` probe on `globalThis.IS_REACT_ACT_ENVIRONMENT`, the setter fires from
`@testing-library/react/dist/index.js:46` — RTL's auto-registration block — in every file
that imports RTL. Two consequences, neither chosen by us:

- `beforeAll(() => setReactActEnvironment(true))` — **the suite runs in React act mode
  globally.** All 294 warnings follow directly from this. The companion fear recorded in
  `setup.ts` (act mode "fails ~450 component tests") is stale: all 124 RTL files pass
  with it on today.
- `afterEach(() => cleanup())` — a **bare synchronous cleanup**, registered ahead of
  ours, which is precisely the race `tests/rtl-settle.ts` was written to eliminate
  ("still races... poisoning the next tests in the file").

So the suite has been running in a posture nobody selected, documented by comments that
describe a different posture. The debt accumulated invisibly because the warnings were
attributed to test authorship rather than to a global mode flip.

### 2.2 What the 294 warnings actually are

Attributed by component:

| Class | Count | Examples |
|---|---|---|
| Base UI floating internals | ~150 | `DialogRoot`, `DialogPopup`, `DialogBackdrop`, `DialogPortal`, `PopoverTrigger`, `FloatingFocusManager` |
| Our own async state | ~144 | `OverviewTab` (50, all via `use-json-fetch.ts:55`), `CalendarToday`/`Weekly`/`Monthly` (~45), `EventChip`, `ExtensionsSection` |

The issue's table listed 10 files; the full scan found **15** — it missed
`plugins/brands/brands-page`, `plugins/workflows/approvals-attention`,
`plugins/tasks/task-detail-dialog`, `plugins/brands/brand-detail-save`, and
`lib/copy-to-clipboard`. `tests/hooks` and `tests/sdk*` (previously unscanned) are clean.

**The Base UI class is not the hard problem the issue assumed.** Spike: wrapping *two*
interaction sites in `await act(async () => { … })` took
`tests/plugins/workflows/workflow-actions.test.tsx` from **76 → 0** warnings with all
tests still green. The fix is mechanical, not architectural.

### 2.3 The posture was validated against the full suite before planning

The chosen posture was run across all 842 files, not reasoned about. The first attempt —
act environment set in the **global preload** — produced **35 failures**, which split
cleanly once the variables were separated one at a time:

| Variable | Result |
|---|---|
| `BAKIN_CONSOLE_FORMAT=silent` alone | green — and removes all 3,390 `[INFO]` lines |
| `RTL_SKIP_AUTO_CLEANUP=true` alone | green |
| act env in the **global preload** | **31 Ink/CLI TUI failures** + 4 logger failures |
| act env in **`tests/rtl-settle.ts`** | green; RTL detection preserved exactly (130 / 50) |

So `setup.ts`'s recorded fear that act mode "fails ~450 component tests" was **real but
misattributed**: the casualties are Ink's terminal React renderer, not RTL component
tests. Scoping the act environment to `rtl-settle` keeps every warning we want and costs
nothing. The 4 logger failures are `BAKIN_CONSOLE_FORMAT=silent` meeting a test that
inherits ambient env instead of owning it — anticipated by D7.

This is why D1 sets the flag in `rtl-settle` rather than the preload, and it is the
reason the plan's first working commit is a posture commit gated on the full suite.

## 3. Decisions

Each decision was taken deliberately during the design interview; the rejected
alternative is recorded because the reasoning is the durable part.

**D1 — Own the act posture explicitly, scoped to RTL files.**
Set `RTL_SKIP_AUTO_CLEANUP=true` (kills RTL's racing bare cleanup and its implicit mode
flip), and set the act environment ourselves in **`tests/rtl-settle.ts`** — imported by
the RTL files and nothing else — so it is chosen, greppable, and correctly scoped.
`rtl-settle`'s settle-then-unmount `afterEach` becomes the *only* cleanup in the suite.
All 124 RTL files already import it. (`tests/api/plugins-build.test.ts` looked like a
125th but only writes an RTL import inside a fixture *string* for the plugin builder to
compile — it never renders.)
**Scope matters — measured, see §2.3:** setting the act environment in the global preload
instead breaks **31 Ink/CLI TUI tests**. Ink is a React renderer, and act mode changes how
React flushes its work, so the TUI never materializes for tests that assert on rendered
output.
*Rejected:* turning act mode off. It would zero the warnings for free, but React would
stop reporting unobserved async updates — deleting the only signal we have for the very
work-in-flight that pins workers open.
*Rejected:* the global preload, on the evidence in §2.3.

**D2 — Gate act violations at zero.**
The preload intercepts `console.error`, buffers any `not wrapped in act` message, and a
preload-registered global `afterEach` throws — attributing the violation to the exact
test that caused it. Verified working: it produces `(fail) OverviewTab > renders the
embedded PackageCard…` and is inert on non-React files. Zero tolerance; no allowlist.
*Rationale:* this is the third time these files have accumulated warnings. Review has
demonstrably not held the line.

**D3 — Bump the test toolchain only, first.**
`bun` 1.3.13 → 1.3.14 (local binary *and* `.bun-version` together, so local and CI never
diverge), plus `@testing-library/react` and `@happy-dom/global-registrator`. Land it as
commit 1 so every subsequent fix is written and measured on the version we ship.
*Explicitly not touched:* `@base-ui/react` (1.4.1 → 1.6.0 would change the Dialog
internals we're fixing and demands a UI regression pass), `lucide-react`, `js-yaml`,
`nodemailer`, `dagre`, `dnd-kit`, `xyflow`, TanStack. Those are app-behavior risk, not
test health, and mixing them in would make "is the suite healthy now?" unanswerable.

**D4 — A CI completeness gate.**
Each shard writes `--reporter=junit`; a final job unions the `<testsuite file="…">`
attributes across all shards and fails if any discovered test file did not run, printing
every missing file. This catches the reported stall signature directly (~7 contiguous
files never dispatched, zero failures logged, run green) **regardless of cause** —
including causes we have not found.
*Rejected:* building the per-worker heartbeat / open-handle dump now. That is speculative
engineering against a bug that clearing the act debt may already have fixed. The gate is
cheap and catches the symptom that actually hurts; instrumentation stays on the shelf and
is justified only if the gate fires again.

**D5 — One canonical test invocation.**
`package.json` gains `test:ci`; `ci-pr.yml` (both jobs), `ci-main.yml`, and `release.yml`
all call it with only `--shard=N/3` appended. `release.yml` moves onto the same sharded
matrix and its false "identical invocation to PR CI" comment is corrected. `bun run lint`
is added to PR and main CI — today it runs **only** in `release.yml`, so a lint error can
merge to main and surface only at release time.
*Rationale:* fixing `release.yml` alone fixes this instance; unifying fixes the class.

**D6 — Rule-based sleep sweep, all 78 sites audited.**
New `tests/helpers/wait.ts` exporting `waitUntil(cond, {label, timeoutMs})` and
`settleFor(ms, why)`. Every site is classified and converted:
- *positive assertion* ("X happened") → `waitUntil` — deterministic and fast;
- *negative assertion* ("exactly one call ever") → keep a bounded wait, but prefer
  awaiting a real terminal signal where one exists; where none does, `settleFor(ms, why)`
  makes the justification mandatory and greppable;
- *hand-rolled local `waitUntil` loops* (e.g. `tests/core/conversation-turns.test.ts:669`)
  → replaced by the shared helper.
*Rejected:* mechanically converting all 78 to polling. Polling for "no second call
arrives" either returns instantly (proving nothing) or needs the same fixed window — it
would quietly weaken those assertions.

**D7 — Silence logger output in tests by default.**
`BAKIN_CONSOLE_FORMAT=silent` in `bunfig.toml` `[test.env]`. The logger already supports
this format, so no logger code changes. `tests/core/logger.test.ts` must be fixed to fully
own the env vars it exercises (it currently inherits ambient config and fails 4 tests when
the var is preset). `BAKIN_CONSOLE_FORMAT=pretty` is the documented one-flag override for
debugging a specific file.

**D8 — Delete the 11 zombie skips.**
Nine are `it.skip('… legacy: routing requires :jobId in path', () => {})` with empty
bodies, describing behavior that no longer exists; two are
`it.skip('git not on PATH — skipping integration tests', () => {})` placeholders that skip
unconditionally even when git *is* present, which actively misleads. The 5 genuine
`skipIf` environment gates stay.

**D9 — Documentation follows the repo's own pattern.**
New `.claude/knowledge/test-suite-health.md` as the deep reference; the now-false comments
in `tests/setup.ts` and `tests/rtl-settle.ts` corrected in place; `CLAUDE.md`'s Testing
Rules reduced to the rules plus a pointer to the deep doc.
*Rationale:* the false comments are what made this debt invisible. Leaving them is the
single highest-value thing not to do.

**D10 — Live-server sequencing.**
Branch in this main checkout (standing rule: 3737 must serve the branch under test).
`bun upgrade` and the `.bun-version` edit land together, then `bun install`, then **one
deliberate restart of 3737** with a health check before any further work. One controlled
interruption rather than the live server drifting onto half-swapped dependencies.

## 4. Acceptance criteria

Every criterion is mechanically checkable. "Verified" means the command was run and its
output recorded in `TODO.md`.

| # | Criterion | How it is verified |
|---|---|---|
| A1 | Zero act warnings across the whole suite | `bun run test 2>&1 \| grep -c "not wrapped in act"` → `0` |
| A2 | The act gate bites | Revert one fix, confirm the run fails naming that test; restore |
| A3 | Suite still fully green | 8531 tests, 0 fail (count may rise as sleeps convert; **must not fall**) |
| A4 | Local bun == CI bun | `bun --version` == `cat .bun-version` == 1.3.14 |
| A5 | Completeness gate bites | Force a shard to skip a file; confirm the job fails naming it |
| A6 | One invocation | `grep -rn "bun test" .github/workflows/` shows only `bun run test:ci` |
| A7 | Lint gates PR and main | `bun run lint` present in `ci-pr.yml` and `ci-main.yml` |
| A8 | No unjustified sleeps | Every surviving fixed sleep is a `settleFor(ms, why)` with a real reason |
| A9 | Output is readable | Test output < 8,000 lines; zero `[INFO]` lines |
| A10 | No zombie skips | `rg "it\.skip\('[^']*', *\(\) => *\{\}\)" tests` → no matches |
| A11 | Docs true | No statement in `setup.ts`, `rtl-settle.ts`, or `CLAUDE.md` contradicts §2.1 |
| A12 | Green CI, sharded, on the branch | PR CI green including the new completeness job |
| A13 | 3737 healthy | Server restarted once, responding, adapter unchanged (`pi`) |
| A14 | Ink/CLI TUI tests unaffected | `tests/cli/**` green — the act env never reaches them (§2.3) |

**Explicit non-criterion:** the worker stall is *not* claimed fixed. It is claimed
*detectable*. A5 proves the detector works; only accumulated green runs can retire the
bug, and the issue stays open until they do.

## 5. Project structure

Files this initiative touches. Nothing outside this list changes.

```
Test infrastructure
  bunfig.toml                          [test.env]: RTL_SKIP_AUTO_CLEANUP, BAKIN_CONSOLE_FORMAT
  tests/setup.ts                       the act gate (global); corrected comments
  tests/rtl-settle.ts                  owns the act env (RTL scope); sole cleanup; corrected comments
  tests/helpers/wait.ts                NEW — waitUntil / settleFor

Act debt (15 files)
  tests/plugins/schedule/calendar-views.test.tsx          130
  tests/plugins/workflows/workflow-actions.test.tsx        76
  tests/plugins/team/overview-tab.test.tsx                 50
  tests/plugins/tasks/task-detail-gate-refresh.test.tsx    12
  tests/plugins/chat/chat-page.test.tsx                     8
  tests/plugins/workflows/node-config-drawer.test.tsx       4
  tests/plugins/team/heartbeat-tab.test.tsx                 2
  tests/plugins/team/active-context-tab.test.tsx            2
  tests/plugins/memory/use-record-deep-link.test.tsx        2
  tests/plugins/brands/brands-page.test.tsx                 2
  tests/components/runtime-hub.test.tsx                     2
  tests/plugins/workflows/approvals-attention.test.tsx      1
  tests/plugins/tasks/task-detail-dialog.test.tsx           1
  tests/plugins/brands/brand-detail-save.test.tsx           1
  tests/lib/copy-to-clipboard.test.tsx                      1

Sleep sweep                            39 files, 78 sites
Zombie skips                           tests/plugins/schedule/routes-jobs.test.ts (6)
                                       tests/plugins/team/routes.test.ts (3)
                                       tests/plugins/lifecycle/upgrade-{decline,flow.integration}.test.ts (2)
Env-owning fix                         tests/core/logger.test.ts

CI + toolchain
  package.json                         test:ci; toolchain dep bumps
  .bun-version                         1.3.13 -> 1.3.14
  .github/workflows/ci-pr.yml          test:ci, lint, junit, completeness job
  .github/workflows/ci-main.yml        test:ci, lint, junit, completeness job
  .github/workflows/release.yml        test:ci + sharded matrix; corrected comment
  scripts/check-test-completeness.ts   NEW — junit union vs discovered files

Docs
  .claude/knowledge/test-suite-health.md   NEW — deep reference
  CLAUDE.md                                Testing Rules -> rules + pointer
  .claude/specs/test-suite-health/         SPEC.md, PLAN.md, TODO.md
```

## 6. Commands

```bash
# Full suite (local)
bun run test

# Canonical CI invocation (new)
bun run test:ci
bun run test:ci --shard=1/3

# Act-warning census, per file, isolated
bun test <file> --isolate 2>&1 | grep -c "not wrapped in act"

# Attribute warnings to components
bun test <file> --isolate 2>&1 | grep -oE "An update to [A-Za-z]+" | sort | uniq -c | sort -rn

# Who set the act environment (the probe that found the root cause)
#   defineProperty a setter on globalThis.IS_REACT_ACT_ENVIRONMENT in a --preload,
#   log new Error().stack on set-true. See the knowledge doc.

# Completeness check
bun test --reporter=junit --reporter-outfile=junit-1.xml --shard=1/3
bun scripts/check-test-completeness.ts junit-1.xml junit-2.xml junit-3.xml

# Debug one file with logs on
BAKIN_CONSOLE_FORMAT=pretty bun test <file> --isolate

# Gates
bun run lint && bun run typecheck && bun run check:cycles
```

## 7. Code style

- Test helpers are `kebab-case.ts` under `tests/helpers/`, exporting named functions.
- `await act(async () => { … })` wraps any interaction that triggers async state — this is
  the standard fix for the act debt; do not "fix" a warning by deleting the assertion or
  widening a timeout.
- `settleFor(ms, why)` requires a real reason string. `'wait'` is not a reason.
- Comments explain *why*, and must be true. A comment stating a fact about the runner
  (bun, RTL, React) must name how it was verified — this whole initiative exists because
  two such comments were confidently wrong.
- Conventional commits with scope: `test(...)`, `ci(...)`, `chore(deps)`, `docs(...)`.

## 8. Testing strategy

The subject *is* the test suite, so "tests for this work" means gates that fail when the
property regresses:

- **A1/A2 — the act gate** is itself the test for the act debt. Proving it bites (A2) is
  mandatory; a gate that cannot fail is decoration.
- **A5 — the completeness gate** is proven by forcing a missing file and observing a red
  job, not by reasoning about the junit schema.
- **Every fixed file is re-run isolated** (`--isolate`) *and* in the full parallel suite.
  Isolated-green is not evidence for a load-sensitive class; the whole point of #753 is
  that these two disagree.
- **The full suite is the gate on every commit** in the sequence, not just at the end —
  the commit boundaries exist so a regression bisects to one concern.
- **No assertion may be weakened** to clear a warning. If a fix requires changing what a
  test asserts, that is a finding to raise, not a step to take silently.

## 9. Boundaries

**Always**
- Fix at the cause; add the gate that keeps it fixed.
- Re-measure after every commit; record real numbers in `TODO.md`.
- Keep local and CI toolchain versions identical, changed together.
- Run `bun run lint` before pushing (typecheck + tests miss unused-import errors).

**Ask first**
- Any change to a test's assertions or to production `src/` code. This initiative is
  scoped to test infrastructure; if clearing a warning appears to need a component fix,
  surface it rather than widening scope.
- Removing or weakening any gate, including a "temporary" allowlist entry.
- Bumping any dependency beyond the three in D3.

**Never**
- Silence a warning class without either fixing it or writing down why it is acceptable.
- Add a `--timeout` increase or a longer sleep as a fix for a flake. That ladder is
  already recorded as a chain of wrong fixes (5s → 15s → 60s, then `--parallel=2`), each
  of which moved the failure rather than removing it.
- Touch `~/.bakin/` or `~/.openclaw/` from a test.
- Kill the 3737 server outside the one planned restart in D10.
- Merge before Mark has tested the branch live.

## 10. Out of scope

- App dependency upgrades (`@base-ui/react`, `lucide-react`, `js-yaml`, `nodemailer`,
  `dagre`, `dnd-kit`, `xyflow`, TanStack) — recorded as a follow-up.
- Per-worker heartbeat / open-handle instrumentation — held behind D4's gate.
- Test coverage expansion. This is a health initiative; new behavioral tests are only
  written where a sleep conversion or act fix reveals a genuine gap.
- The 5 legitimate `skipIf` environment gates.
