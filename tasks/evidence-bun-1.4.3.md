# Evidence: bun 1.4.3 repin matrix (#965)

Date: 2026-10-21. Procedure: `.claude/knowledge/test-suite-health.md` § 5 as revised by the batch spec (`toolchain-and-sdk-boundary-batch-2026-10.md` D1.1); the exact script is in the batch plan's PR 1 checkpoint. Two runs with two purposes: a DIAGNOSTIC matrix on the unchanged tree (what does 1.4.3 change?) and an ACCEPTANCE matrix on the commit carrying only the resulting fixes.

## Candidate binary
- `bun-darwin-aarch64.zip` from the `bun-v1.4.3` GitHub release, sha256 `80afd4c069b46a6fa8f3ec520bebc750a7843e4a8d5b9583d29ad436c00a3403`, unpacked side-by-side in the session scratchpad; the system bun stayed 1.3.13 until merge.
- The candidate directory was FIRST on `PATH` for every acceptance leg (`which bun` recorded per run), so the runner and every `bun` a test spawns were 1.4.3.
- Linux: `oven/bun:1.4.3`, `--platform linux/amd64` (CI's architecture), as a non-root user with git installed.

## Diagnostic matrix — unchanged tree (`main` ea837822a)
Baseline 1.3.13 (2026-10-20): 12128 pass / 18 skip / 0 fail, 12146 tests across 1233 files, 247 s.

| Leg | 1.4.3 result |
|---|---|
| 1 Ink canary (`tests/cli/readonly-logs.test.ts`) | 4/0 |
| 2 Pi fake-provider canary (`tests/integration/pi/turn.test.ts`) | 31/0 |
| 3 full suite | 12125 pass / 18 skip / **3 fail** (12146), 76–78 s |
| 4 shard 2/3 ×4 (the 1.4.0–1.4.2 crasher) | 4089/2 ×3, 4088/3 ×1 — **no SIGSEGV** |
| 4 shards 1, 3 | 3967/1, 4069/0 |
| 5 `bun run build` → `dist/bakin-darwin-arm64 version` + compiled teeth | 8 s; prints; oauth-static 5/0, sharp-store 3/0, plugin-defaults 2/0 |
| 6 Linux amd64, non-root, git, Bits at CI's path, CI asset build, shard 2 | 4089/2, **no SIGSEGV** (an earlier arm64/root/no-git attempt added 4 environmental fails: git absent, chmod injections cannot fail as root) |

Four deltas, none a crash, all diagnosed and fixed in this PR (commits 1.1–1.3; spec D1.9):
1. `tests/core/delivery/readiness-collect.test.ts:109` — asserted the last SSE broadcast right after polling the in-memory snapshot; the broadcast sits behind `await import('@/core/sse')`, a macrotask on 1.4. Fix: poll the broadcast state the assertion needs.
2. `tests/cli/component-install.test.ts:113` — two Ctrl-C presses after polling the registry, but `followLocalAndRender` attaches its SIGINT listener after `await import('../core/operations')`. Fix: wait for the follower's first rendered update, as its sibling test does.
3. `tests/core/watchdog.test.ts:838` — the fake-timer shim's `flushMicrotasks(4)` was a depth guess (probes: +50 microtask turns pass, one real `setImmediate` turn passes). Fix: the shim drains with one real `setImmediate` turn; contract pinned by `tests/setup-fake-timers.test.ts`.
4. `tests/core/net/download.test.ts:133` — once in seven runs under parallel load: the write sink's async open raced the fail-fast cleanup and left an empty file. Product fix: `downloadToFile` awaits the sink's `close` before cleanup; deterministic proof via the `createSink` seam.

## Acceptance matrix — fixes commit (`chore/965-bun-1.4.3` e3e1d152a), both runtimes, same snapshot
First attempt taught the recipe one thing: after a build leg restores the tracked embedded manifest, the next runtime's server-booting tests refuse to boot ("embedded manifest is stale — 21 entries missing"); CI avoids this by regenerating the manifest before its test job (`build:host && build:plugins && build:assets-manifest`), so the recipe now runs that step per runtime first. Second attempt:

| Leg | 1.3.13 | 1.4.3 |
|---|---|---|
| pre-build (CI step) | 0 | 0 |
| 1 Ink canary | 0 | 0 |
| 2 Pi canary | 0 | 0 |
| 3 full suite |  12133 pass  19 skip  0 fail Ran 12152 tests across 1235 files. [224.94s]  |  12134 pass  18 skip  0 fail Ran 12152 tests across 1235 files. [74.63s]  |
| 3 completeness (junit + log) | every discovered test file ran | every discovered test file ran |
| 4 shard 1/3 |  3917 pass  13 skip  0 fail  |  3917 pass  13 skip  0 fail  |
| 4 shard 2/3 ×3 |  3978 pass  0 fail  (identical ×3) |  3978 pass  0 fail  (identical ×3, **no SIGSEGV**) |
| 4 shard 3/3 |  4239 pass  0 fail  |  4239 pass  0 fail  |
| 4 completeness (shard union) | every discovered test file ran | every discovered test file ran |
| 5 build → version → 3 compiled teeth | 0 / prints / 0,0,0 | 0 / prints / 0,0,0 |
| wall time, legs 1–5 | 452 s | 208 s |
| 6 Linux amd64 non-root + git + Bits + CI build, shard 2 | — | 3977 pass / 5 skip / **1 fail** — `NodeConfigDrawer`, the FIFTH delta (below); after its fix, on the pinned tree: fixed file 20/20 ×3 and shard 2 **4040 pass / 13 skip / 0 fail**, no SIGSEGV |

Every macOS leg green on both runtimes; the four diagnostic deltas did not recur.

**Fifth delta — Linux amd64 only (spec D1.9(e)).** The diagnostic Linux leg never exercised `tests/plugins/workflows/node-config-drawer.test.tsx` (the two new test files shifted the shard composition). On amd64 under 1.4.3 its two map_workflow cases failed the act gate 8/8 runs (file alone ×5, workflows dir ×3; 1–2 cases each), while the same container on **1.3.13 passed 20/20 ×3** — a real 1.4.3-on-Linux delta, not emulation noise. Cause: the cases rendered a step whose workflow picker loads options through `useJsonFetch`, unstubbed; the request failed against happy-dom's fetch and its error state landed after the test returned on the slower runner. Fix (commit 1.3b): stub the definitions endpoint as the file's own picker test does, await the load inside `act`, act-wrap the interactions. Retest on amd64/1.4.3: 20/20 ×3, shard 2 clean.

## Pin commit (1.5) gates on 1.4.3
Lock resolves `@types/bun@1.4.3` / `bun-types@1.4.3`; typecheck 0; lint 0 (`--max-warnings 0`); `tests/architecture/bun-pin.test.ts` + whiskit + rig lifecycle 140/0; `ui:performance` valid after regeneration — host initial JS 279,266 → 182,147 B under the 1.4 bundler (ceilings fall; D0.8). Full suite on the pinned tree: 12137 pass / 18 skip / 0 fail (12155 across 1236 files, 79 s); `bun run build` 2 s; `dist/bakin-darwin-arm64 version` prints `0.0.1-rc.41-42-ge3e1d15-dirty`; embedded manifest regenerated (+61/−43 lines of vendor references). Remaining per-PR gate on 1.4.3: `check:cycles` (12 pinned + 0 tolerated, allowlist current), `lint:home-bypasses` OK, `docs:check` green (the generated reference's only change was the date stamp — not committed), `ui:conformance --quick` green (run alone — beside two emulated containers its public-api inventory test once exceeded bun's 5 s per-test default at 6.7 s; alone it takes well under).

## Leg-6 recipe lessons
`oven/bun` ships without git and runs as root; CI's test job clones Bits at `${runner.workspace}/bakin-bits-official` and builds host/plugins/assets-manifest before testing; the inner script lives on a mounted evidence dir so the log, the JUnit report and the runner's own exit status survive `--rm`; `su -s /bin/bash` selects Bash like CI does.

## Verdict
1.4.3 is clear of the `--parallel` runner crash on macOS (shard 2 ×4 diagnostic + ×3 acceptance) and on Linux amd64 (CI's architecture); the suite is ~3× faster; the compiled lanes pass. Repin proceeds.
