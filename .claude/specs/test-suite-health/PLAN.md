# Test-Suite Health — Implementation Plan (#753)

**Spec:** `SPEC.md` v1 · **Branch:** `chore/test-suite-health-753` · **Status:** PLAN v1 (2026-07-30)

## 1. Shape of the work

16 tasks in 7 checkpoints. The ordering is driven by one constraint: **the act-debt fixes
must be written against the final posture**, because the posture determines which updates
warn. Everything else is either independent (sleeps, zombie skips, CI) or terminal (the
gates, the docs).

```
CP-0  T0 ──────────────────────────────────────────────► foundation
       │
CP-A   ├─ T1 silent logs ──┐
       └─ T2 act posture ──┴──► posture frozen
                            │
CP-B                        ├─ T3 schedule ─┐
                            ├─ T4 workflows │  (independent of each other)
                            ├─ T5 team      │
                            └─ T6 tail    ──┴──► 0 warnings
                                               │
CP-C                                           └─ T7 act gate (needs zero)

CP-D  T8 helper ──► T9 heavy ──► T10 rest      (independent of CP-B/C)
CP-E  T11 zombie skips                          (independent)
CP-F  T12 canonical CI ──► T13 completeness     (independent)
CP-G  T14 docs ──► T15 done bar ──► T16 PR      (needs all)
```

**Critical path:** T0 → T2 → T3–T6 → T7 → T14 → T15 → T16. T8–T13 run in the gaps and
gate independently.

## 2. Standing rules for every task

1. **Green before commit.** `bun run test` full-suite green. Not "the file I touched" —
   the whole suite, because this initiative exists precisely because per-file green and
   suite green disagree.
2. **Measure, don't assume.** Every task records real numbers in `TODO.md`. "Looks fixed"
   is not a result.
3. **One concern per commit.** Every commit reverts cleanly on its own.
4. **`bun run lint` before any push** — typecheck and tests miss unused-import errors.
5. **No assertion weakened.** If clearing a warning appears to need a `src/` change, stop
   and raise it (SPEC §9).
6. **No timeout increases, no longer sleeps** as a fix for anything.

## 3. Checkpoints and tasks

### CP-0 — Foundation

Rollback: delete the branch. Nothing shared has changed except local toolchain, which is
independently reversible via `bun upgrade --to 1.3.13`.

---

**T0 — Branch, toolchain bump, one deliberate server restart**
*Implements:* D3, D10 · *Depends on:* nothing

- `git checkout -b chore/test-suite-health-753`
- `bun upgrade` (local → 1.3.14) **and** edit `.bun-version` → `1.3.14` in the same commit
- Bump `@testing-library/react` + `@happy-dom/global-registrator` to latest
- `bun install`
- Restart 3737 **once**, deliberately; verify healthy before continuing
- Re-measure the baseline on 1.3.14 (the act counts are bun-version-sensitive — that is
  the whole premise of §2.1, so they must be re-taken, not carried over)

*Acceptance:*
- `bun --version` == `cat .bun-version` == `1.3.14`
- Full suite green; test/file counts unchanged from 8531/842 (a change here means the bump
  altered discovery — investigate before proceeding)
- 3737 responds; `settings.runtime.adapter` still `pi`
- Fresh act-warning census recorded in `TODO.md`

*Verify:*
```bash
bun --version && cat .bun-version
bun run test 2>&1 | tail -5
bun run test 2>&1 | grep -c "not wrapped in act"
curl -sf localhost:3737/api/health >/dev/null && echo "3737 ok"
```

*Commit:* `chore(deps): bump bun to 1.3.14 and the RTL/happy-dom test toolchain`

**Risk:** a bun patch can move test-runner semantics — that is how we got here. If the
census or counts shift materially, that finding lands in `TODO.md` and the plan adapts
before CP-A. Do not proceed on the assumption that 1.3.14 behaves like 1.3.13.

---

### CP-A — Posture

Rollback: `git revert` T2 then T1; both are small and self-contained. This is the
highest-risk checkpoint because both changes are global.

---

**T1 — Silence logger output in tests**
*Implements:* D7 · *Depends on:* T0

- `BAKIN_CONSOLE_FORMAT` set in the `tests/setup.ts` preload (bun 1.3.13 ignores
  `bunfig.toml` `[test.env]` — probed; that section was decorative and is now removed)
- Fix `tests/core/logger.test.ts` to **own** the env vars it exercises (delete them, don't
  inherit) — it fails 4 tests today when the var is preset, which is the test being wrong
  about its own isolation, not the setting being wrong
- Document the `BAKIN_CONSOLE_FORMAT=pretty` escape hatch in the file's header comment

*Acceptance:* full suite green · zero `[INFO]` lines in output · output < 8,000 lines
(measured: 11,885 → ~7,100)

*Verify:*
```bash
bun run test 2>&1 | tee /tmp/t1.log | tail -5
grep -c '\[INFO\]' /tmp/t1.log   # 0
wc -l < /tmp/t1.log              # < 8000
BAKIN_CONSOLE_FORMAT=pretty bun test tests/core/doctor.test.ts --isolate 2>&1 | grep -c '\[INFO\]'  # > 0
```

*Commit:* `test(setup): silence logger console output in tests`

---

**T2 — Own the act posture**
*Implements:* D1 · *Depends on:* T0

- `RTL_SKIP_AUTO_CLEANUP` set in the `tests/setup.ts` preload — kills RTL's racing bare
  `afterEach(cleanup)` and its implicit mode flip
- Set the act environment in **`tests/rtl-settle.ts`** (RTL scope only — the global
  preload breaks 31 Ink tests, SPEC §2.3)
- Correct the false comments in both files as part of this commit (they describe the
  posture; they must not outlive it)

*Acceptance:* full suite green · **`tests/cli/**` green** (A14 — the Ink canary) · act
warning count unchanged from T0's census (this task changes *who owns* the posture, not
what it detects; a count change means something else moved)

*Verify:*
```bash
bun run test 2>&1 | tail -5
bun test tests/cli --isolate 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"
bun run test 2>&1 | grep -c "not wrapped in act"   # == T0 census
grep -rn "IS_REACT_ACT_ENVIRONMENT" tests/          # rtl-settle only
```

*Commit:* `test(setup): own the React act environment instead of inheriting RTL's`

---

### CP-B — Act debt

Rollback: each task reverts independently; files do not interact. Grouped by area so a
regression bisects to one plugin's surface.

The fix pattern, from the validated spike: wrap any interaction that triggers async state
in `await act(async () => { … })`. Two sites cleared all 76 warnings in `workflow-actions`.
Where a component's own fetch lands after the test ends, the honest fix is to await the
state the test actually depends on, not to add a sleep.

---

**T3 — Schedule** · *Implements:* D1 · *Depends on:* T2
`tests/plugins/schedule/calendar-views.test.tsx` — **130 warnings**, the largest single
file. Interactions are dialog open → change → submit chains; `EventChip` and the three
calendar views also settle their own fetches.

*Acceptance:* that file 0 warnings isolated · file green · full suite green
*Commit:* `test(schedule): flush calendar view interactions inside act`

---

**T4 — Workflows** · *Depends on:* T2
`workflow-actions.test.tsx` (76) + `node-config-drawer.test.tsx` (4) +
`approvals-attention.test.tsx` (1) = **81**. `workflow-actions` is already spiked: two
sites.

*Acceptance:* all three 0 warnings isolated · green · full suite green
*Commit:* `test(workflows): flush dialog interactions inside act`

---

**T5 — Team** · *Depends on:* T2
`overview-tab.test.tsx` (50) + `heartbeat-tab.test.tsx` (2) +
`active-context-tab.test.tsx` (2) = **54**. `overview-tab` is the pure "our own async
state" case — all 50 land via `use-json-fetch.ts:55`, so this is where the fix is about
awaiting real state rather than wrapping clicks.

*Acceptance:* all three 0 warnings isolated · green · full suite green
*Commit:* `test(team): await fetched state instead of ending turns in flight`

---

**T6 — The tail** · *Depends on:* T2
`tasks/task-detail-gate-refresh` (12), `chat/chat-page` (8), `components/runtime-hub` (2),
`brands/brands-page` (2), `memory/use-record-deep-link` (2), `tasks/task-detail-dialog`
(1), `brands/brand-detail-save` (1), `lib/copy-to-clipboard` (1) = **29** across 8 files.

*Acceptance:* all eight 0 warnings isolated · green · full suite green · **whole-suite
count now 0**
*Commit:* `test(components): clear the remaining act debt`

---

### CP-C — The gate

Rollback: revert one commit.

---

**T7 — The act gate**
*Implements:* D2 · *Depends on:* T3–T6 (it can only be switched on at zero)

- In `tests/setup.ts`: intercept `console.error`, buffer `not wrapped in act` messages,
  and register a global `afterEach` that throws with the component name and count
- Global registration is safe and correct: the gate only fires where warnings occur, and
  warnings only occur where the act env is on (RTL files). Verified inert on non-React
  files.
- **No allowlist.** If it can be suppressed per-file it will be, and we are back here.

*Acceptance:* full suite green with the gate live · **A2: the gate bites** — revert one
T3–T6 fix, confirm the run fails naming that exact test, restore

*Verify:*
```bash
bun run test 2>&1 | tail -5
git stash pop  # a reverted fix
bun test tests/plugins/team/overview-tab.test.tsx --isolate 2>&1 | grep "(fail)"
```

*Commit:* `test(setup): fail the run on un-acted React updates`

---

### CP-D — Fixed-sleep sweep

Rollback: three independent commits. Runs in parallel with CP-B/C — touches different files.

Distribution: 78 sites across 39 files, but concentrated — 2 files hold 21, and 30 files
hold exactly 1.

---

**T8 — Shared helper + de-duplicate the hand-rolled loops** · *Depends on:* T0

Four files hand-roll the same thing under three different names and inconsistent bounds:
`core/dispatch-concurrency.test.ts:159` (`waitUntil`, 10s), `core/conversation-turns.test.ts:669`
(`waitUntil`, fixed 200×2ms), `plugins/chat/queue.test.ts:83` (`waitUntil`),
`core/budget-notify.test.ts:51` (`waitFor`, 10s).

- New `tests/helpers/wait.ts`: `waitUntil(cond, {label, timeoutMs})` and
  `settleFor(ms, why)` — `why` is required, and `'wait'` is not a reason
- Replace all four local copies

*Acceptance:* four files green · no local `waitUntil`/`waitFor` definitions remain in
`tests/**` · full suite green
*Commit:* `test(helpers): add the shared wait helper and drop four hand-rolled copies`

---

**T9 — The heavy files** · *Depends on:* T8
`adapter-openclaw/trajectory-forensics.test.ts` (11) + `gateway-rpc.test.ts` (10) +
`runtime-abort.test.ts` (3) + `runtime-channels.test.ts` (1) = **25 sites**, all in the
adapter that drives session forensics — the most timing-sensitive area in the repo.

*Acceptance:* each site classified positive/negative and converted per D6 · files green
· full suite green · **run these four 3× consecutively** (a timing area deserves more than
one green)
*Commit:* `test(adapter-openclaw): replace fixed sleeps with condition waits`

---

**T10 — The remaining 35 files** · *Depends on:* T8
`core/conversation-turns` (6), `workflows/runtime-engine` (4),
`core/dispatch-team-resolution` (3), then 32 files with 1–2 sites each.

*Acceptance:* every surviving fixed sleep is a `settleFor(ms, why)` with a real
justification · full suite green
*Verify:*
```bash
rg -U -c 'await new Promise\(\s*(?:\([^)]*\)|r|resolve)\s*=>\s*setTimeout' tests
# only settleFor internals should remain
```
*Commit:* `test: convert the remaining fixed-sleep settles to condition waits`

---

### CP-E — Hygiene

**T11 — Delete the zombie skips** · *Implements:* D8 · *Depends on:* T0

11 `it.skip(…, () => {})` with empty bodies: `schedule/routes-jobs.test.ts` (6),
`team/routes.test.ts` (3), `lifecycle/upgrade-decline` + `upgrade-flow.integration` (2).
The first nine describe routing that no longer exists; the last two claim "git not on
PATH" while skipping unconditionally even when git is present.

*Acceptance:* `rg "it\.skip\('[^']*', *\(\) => *\{\}\)" tests` → no matches · skip count
drops from 9 to the 5 genuine `skipIf` gates · full suite green
*Commit:* `test: delete eleven empty skipped tests`

---

### CP-F — CI coherence

Rollback: two commits; CI-only, no effect on the suite itself.

---

**T12 — One canonical invocation + lint everywhere** · *Implements:* D5 · *Depends on:* T0

- `package.json`: `test:ci` holding the invocation (`--parallel=4 --isolate --timeout 60000
  --path-ignore-patterns "dev/**"`)
- `ci-pr.yml` (both jobs), `ci-main.yml`, `release.yml` → `bun run test:ci --shard=N/3`
- `release.yml` onto the same sharded matrix; delete its false "identical invocation to
  PR CI" comment
- Add `bun run lint` to PR and main CI (today: release-only)

*Acceptance:* `grep -rn "bun test" .github/workflows/` returns nothing but `bun run test:ci`
· `bun run lint` present in both CI workflows · release.yml sharded

*Commit:* `ci: one canonical test invocation and lint on every gate`

---

**T13 — The completeness gate** · *Implements:* D4 · *Depends on:* T12

- Each shard writes `--reporter=junit --reporter-outfile=junit-N.xml`, uploaded as an
  artifact
- New `scripts/check-test-completeness.ts`: union the `<testsuite file="…">` attributes
  across shards, diff against the discovered test-file list, fail printing every missing
  file
- New CI job `needs: [test]` that downloads the artifacts and runs it

*Acceptance:* job green on a healthy run · **A5: the gate bites** — force a shard to skip
a file, confirm a red job naming it

*Verify:*
```bash
bun test --reporter=junit --reporter-outfile=/tmp/j1.xml --shard=1/3
bun scripts/check-test-completeness.ts /tmp/j1.xml /tmp/j2.xml /tmp/j3.xml
```

*Commit:* `ci: fail a run that silently skips test files`

**Note:** this is the only defense against the actual #753 stall symptom. If it cannot be
made to work against real artifacts, that is a blocking finding, not something to route
around.

---

### CP-G — Documentation and close

**T14 — Docs** · *Implements:* D9 · *Depends on:* T1–T13

- New `.claude/knowledge/test-suite-health.md`: the act posture and why, RTL
  auto-registration under bun 1.3 (with the probe recipe that found it), the gate and how
  to fix a violation, the sleep rules, CI shape and the completeness gate, and the flake
  bisect method
- `CLAUDE.md` Testing Rules → rules + pointer (it currently carries the false claims)
- Confirm `tests/setup.ts` / `tests/rtl-settle.ts` comments corrected in T2 still match
  the shipped behavior
- README check (likely untouched — verify, don't assume)

*Acceptance:* no statement in `setup.ts`, `rtl-settle.ts`, or `CLAUDE.md` contradicts
SPEC §2.1/§2.3 · docs build green
*Commit:* `docs(testing): record the act posture, the gates, and how the debt hid`

---

**T15 — Done bar** · *Depends on:* T14

Walk all 14 acceptance criteria, record real output for each in `TODO.md`. Then:
- Full suite **3× consecutively** green (once is not evidence for a flake initiative)
- `bun run lint && bun run typecheck && bun run check:cycles`
- 3737 healthy on the branch

---

**T16 — Ship** · *Depends on:* T15

Push, open the PR, confirm CI green **including the new completeness job**, then Mark
live-tests on 3737 before merge. Merge only after approval (standing rule).
Post-merge: update #753 with what is fixed vs. merely detectable, and leave it **open** —
the stall is not claimed fixed (SPEC §4).

## 4. Commit strategy and rollback

16 commits, one concern each, every one leaving a green suite. Checkpoints are the
rollback granularity:

| CP | Commits | Rollback | Blast radius if wrong |
|---|---|---|---|
| CP-0 | 1 | delete branch; `bun upgrade --to 1.3.13` | local toolchain only |
| CP-A | 2 | revert T2 then T1 | **global** — every test file |
| CP-B | 4 | revert any one | one plugin's tests |
| CP-C | 1 | revert | the gate only; suite unaffected |
| CP-D | 3 | revert any one | timing-sensitive tests |
| CP-E | 1 | revert | none (deletions) |
| CP-F | 2 | revert | CI config only |
| CP-G | 2 | revert | docs only |

**CP-A is the one to watch.** Both commits are global and both are cheap to revert, which
is exactly why they are isolated into their own checkpoint rather than folded into the
first act-debt fix. If anything downstream behaves strangely, revert CP-A first and
re-measure before debugging.

**Ordering rationale.** T12/T13 (CI) could land first and would give the completeness gate
earlier, but they change what CI runs while the suite is mid-repair — which would make a
red CI ambiguous between "our fix broke it" and "the new invocation broke it." They land
after the suite is quiet, on purpose.

## 5. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| bun 1.3.14 shifts test semantics again | Medium | T0 re-measures everything; the census is re-taken, not carried |
| An act fix needs a `src/` change | Medium | Boundary: stop and raise (SPEC §9). Do not widen scope silently |
| A negative-assertion sleep is misclassified as positive | Medium | D6's rule is explicit; misclassification weakens an assertion, so each conversion states which class it is |
| The stall recurs despite zero act debt | **Unknown** | T13's gate makes it visible instead of green. Instrumentation stays on the shelf, justified only if it fires |
| Toolchain bump destabilizes 3737 | Low | One deliberate restart with a health check (D10) |
| RTL bump changes auto-registration again | Low | T2 sets the posture explicitly, so RTL's default stops mattering |

## 6. Explicitly not in this plan

App dependency upgrades (`@base-ui/react`, `lucide-react`, `js-yaml`, `nodemailer`,
`dagre`, `dnd-kit`, `xyflow`, TanStack) → follow-up issue. Per-worker heartbeat /
open-handle instrumentation → held behind T13. New behavioral test coverage → only where a
fix reveals a genuine gap.
