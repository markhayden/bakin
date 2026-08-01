# Test-Suite Health

Deep reference for how the suite stays trustworthy. Spec: `.claude/specs/test-suite-health/`.
Issue: #753. The short version lives in CLAUDE.md § Testing Rules; this is the why.

**The property we are protecting:** every run either reports the truth or fails loudly.
Not "the suite is green" — a green run that quietly skipped 7 files is worse than a red
one, because it buys false confidence.

## 1. The act posture

### What is configured

- `tests/setup.ts` (preload) sets `RTL_SKIP_AUTO_CLEANUP=true` and installs the **act gate**.
- `tests/rtl-settle.ts` owns React's act environment in a `beforeAll`, and owns the only
  `afterEach` cleanup in the suite.
- Every RTL-rendering test file imports `tests/rtl-settle` (all 124 of them).

### Why it is configured that way

`tests/setup.ts` used to state that "RTL auto-cleanup is inert under bun — test globals
are not visible at module-eval time." **That was false on bun 1.3.13**, and the false
belief is why ~300 act warnings accumulated unnoticed: they read as sloppy test authorship
rather than as a global mode nobody had chosen.

`@testing-library/react/dist/index.js:46` self-registers when it sees global `afterEach` /
`beforeAll`, which bun does provide to a test file. That gave us two behaviours by accident:

| RTL installed | Consequence |
|---|---|
| `beforeAll(() => setReactActEnvironment(true))` | the whole suite ran in act mode |
| `afterEach(() => cleanup())` | a **bare synchronous** cleanup, racing ours |

The second is precisely what `rtl-settle` was written to replace — an unguarded `cleanup()`
can land mid-slice on a yielded concurrent render ("Attempted to synchronously unmount a
root while React was already rendering"). It had been running *ahead* of the careful one
the whole time.

Removing it made the detector **more honest, not noisier**: the census went 294 → 315 and
8 previously-invisible files appeared. Roots had been torn down early, swallowing evidence
of work still in flight.

### Why the act env is set in rtl-settle and NOT the preload

Measured, not assumed. Setting it globally breaks **31 Ink/CLI TUI tests**: Ink is also a
React renderer, and act mode changes how React flushes, so the TUI never materializes for
tests that assert on rendered output. The stale warning in `setup.ts` about act mode
"failing ~450 component tests" was real but **misattributed** — the casualties are Ink's
terminal renderer, not RTL's DOM tests.

Scoping it to `rtl-settle` (imported only by RTL files) keeps every warning we want at
zero cost.

### The probe that found all of this

Reach for this whenever "who set this global?" is the question:

```ts
// in a --preload file
let v: unknown
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  get() { return v },
  set(next) {
    if (next === true) console.error('SET true\n' + new Error('x').stack)
    v = next
  },
  configurable: true,
})
```

The stack named `@testing-library/react/dist/index.js:46` directly. Reading library source
would have taken far longer than instrumenting the assignment.

## 2. The act gate

`tests/setup.ts` intercepts `console.error`, buffers `not wrapped in act` messages, and a
preload-registered global `afterEach` throws — attributing each violation to the exact test
that caused it, naming the component and count:

```
act gate: 2 React update(s) landed outside act() during this test (HeartbeatTab x2).
```

**Why it is a failure and not a warning.** React reports every state update landing outside
`act()`. That report is the only signal we have for a test ending with work still in
flight — the one *confirmed* mechanism for pinning an `--isolate` worker open forever
(#753). While it was merely noise, ~300 of them a run made the signal unusable.

**There is no allowlist, on purpose.** Exactly one file legitimately ends a test mid-flight:
`tests/components/rtl-settle-probe.test.tsx`, which exists to prove the settle hook survives
that. It opts out by disabling the act environment **in the file**, where a reader meets it.
A list in the gate would grow quietly whenever someone was in a hurry.

### Fixing a gate failure

Wrap the interaction that triggers the async state:

```ts
await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save/i })) })
```

For renders whose mount effects fetch, wrap the render. For `renderHook`, use `actRender`
from `rtl-settle` — it is generic, so the hook's result type survives (an explicit
`ReturnType<typeof renderHook>` annotation erases it and leaves `result.current` as
`unknown`).

Do **not** fix one by deleting the assertion, widening a timeout, or adding a sleep.

### A drain must run inside act

`settleReact()` wraps its own drain in `act`. A drain that flushes updates from *outside*
act is self-defeating: every update it lands is by definition un-acted, so the gate fires
on a test that was doing the right thing. This presented as 6 phantom `KanbanBoard`
warnings under parallel load that no amount of fixing that test could remove — the warning
belonged to the teardown, not the test. Nested act is legal, so callers already inside an
act window pay nothing.

## 3. Waiting: `tests/helpers/wait.ts`

```
asserting something DID happen   -> waitUntil(cond, { label })
asserting something did NOT      -> settleFor(ms, why)      // `why` is required
```

You cannot poll for the absence of an event: the poll either returns immediately (proving
nothing) or needs the same fixed window anyway. So negative assertions keep a real window,
but the justification is mandatory and greppable.

Prefer awaiting a genuine terminal signal over either when the code exposes one.

### The vacuous-poll trap

**A poll whose condition is already true is strictly worse than the sleep it replaced** —
it returns instantly, proves nothing, and reads as rigorous. Three were written during the
#753 sweep and caught only because the tests failed:

| Wrong | Why | Right |
|---|---|---|
| `Boolean(counts)` | `[]` is truthy | `counts.length > 0` |
| `Boolean(loadInstance(id))` | written synchronously | `loadInstance(id)?.currentStepId === 'after-create'` |
| `hook.calls.length > 0` | first call is sync; test needs the second | `hook.calls.length >= 2` |

Always poll the state **the assertion depends on**, not merely "something exists".

### What legitimately stays a fixed wait

- Real elapsed time is the input under test (`durationMs` from the wall clock, a 1s
  backoff step, a 2s auto-dismiss, CPU sampled *between* probes, advancing a clock so a
  second timestamp is provably later).
- Simulated latency **inside a mock body** — a slow store move, a hanging hook. That delay
  is the condition under test, not a wait for it. These are labelled in place.

## 4. CI shape

One canonical invocation: `package.json` → `test:ci`. `ci-pr.yml` (both jobs),
`ci-main.yml`, and `release.yml` all call it. They had drifted — release ran unsharded at a
15s timeout under a comment claiming it matched PR CI — so the flags now live in one place
and drift is structural rather than something review must catch.

Release stays **unsharded on purpose**: it is a single gate before an irreversible publish.
Sharding is a PR-latency optimization, not a correctness one.

`bun run lint` gates PR and main. It used to run only in `release.yml`, so a lint error
could merge to main and surface weeks later while cutting a release.

### The completeness gate

`scripts/check-test-completeness.ts` fails a run in which any discovered test file was
never dispatched, and names them.

**Why outcome-based checks cannot catch this:** a wedged worker reports GREEN. Its chunk
never runs, so nothing fails and the exit code is 0. #753 observed ~7 alphabetically
contiguous files silently undispatched. A run that does less work is indistinguishable from
a run where less work was needed — unless you check coverage.

Two properties of bun's output it must survive, both found by running it against real
shards rather than assuming:

1. junit `file=` is **sometimes absolute and sometimes repo-relative in the same report**.
   Normalize before comparing.
2. A file whose tests are **all skipped** (the antfly suites, gated on an absent binary)
   emits **no `<testsuite>` element at all**. In junit alone it is indistinguishable from a
   file that never ran — a junit-only checker fails every run. bun's stdout *does* print
   its path, so both sources are unioned and CI captures both.

Also: bun nests `<testsuite>` (one per file, then one per describe) with the file attribute
repeated. Count **distinct** files, never a sum.

## 5. Toolchain

**bun is pinned at 1.3.13. Do not upgrade without re-running the matrix below.**

1.3.14 is a regression for this suite: **124 failures / 48 errors**, 88 fewer tests
dispatched. Both classes are one ESM module-initialization (TDZ) bug:

- `Cannot access 'Yoga' before initialization` ×62 — `ink/build/styles.js:3` importing
  `yoga-layout`. Third-party; kills every CLI TUI test. → #755
- `Cannot access 'NativeResponse' before initialization` ×47 —
  `tests/integration/pi/fake-provider.ts:25`, a **top-level await**. 1.3.14 runs module
  functions before the TLA settles, which valid ESM forbids. Surfaces as the Pi
  "Connection error." family. → #756

Repin procedure — run this **before** changing `.bun-version`, not after:

```bash
# one variable at a time, on a file that exercises Ink
bun test tests/cli/readonly-logs.test.ts --isolate
# then the full suite; compare pass/fail AND the tests-dispatched count
```

`.bun-version` is what CI reads. Change the local binary and that file **together**, or
local and CI silently diverge.

## 6. Debugging a flake

The method that settled #687's "CI red, local green", in order:

1. **Control PR from unmodified main.** If it is also red, CI is the problem, not the code.
2. **Bisect PR:** all source changes, new test files parked. Green ⇒ the feature is
   innocent and the tests merely perturbed something latent.
3. **Isolate one variable at a time.** The bun 1.3.14 finding took a 2×2 matrix (bun ×
   happy-dom) to attribute correctly; two variables changed at once would have blamed the
   wrong one.
4. **Instrument rather than theorize.** The act-environment probe (§1) and the junit
   inspection both replaced a plausible wrong hypothesis with a fact in one step.
5. **Isolated-green is not evidence.** This whole initiative exists because per-file green
   and suite green disagree. Always confirm in the full parallel run.

### Time bombs

Two tests failed for the first time *during* this work because a date rolled over:

- `tests/plugins/memory/routes/record.test.ts` hardcoded a fixture at `2026-07-01` against
  the route's default 30-day audit retention. It aged out at midnight and would have 404'd
  forever.
- `tests/plugins/health/budget.test.ts` assumed "the start of the month" is older than
  "today" — true on every day except the 1st.

If a test depends on the calendar, pin the clock (`setSystemTime`) or make the fixture
relative to now, and restore the clock in `afterEach`. A test that fails on the 1st of the
month is a test nobody is around to see fail.

## 7. Running things

```bash
bun run test                    # full suite, local
bun run test:ci                 # what CI runs
bun test <file> --isolate       # one file, fresh process

# debug one file with logs on (they are silenced by default — see setup.ts)
BAKIN_CONSOLE_FORMAT=pretty bun test <file> --isolate

# act-warning census for one file
bun test <file> --isolate 2>&1 | grep -c "not wrapped in act"

# completeness, against real artifacts
bun scripts/check-test-completeness.ts junit-*.xml shard-*.log
```

Note `bunfig.toml` has **no `[test.env]` section**: bun 1.3.13 does not read one. A var set
there arrives `undefined`; `NODE_ENV=test` appears only because `bun test` sets it itself.
Test-run env belongs in the `tests/setup.ts` preload, which actually executes, and uses
`??=` so a shell override always wins.
