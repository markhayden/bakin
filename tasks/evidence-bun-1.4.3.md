# Evidence: bun 1.4.3 repin matrix (#965)

Date: 2026-10-21. Procedure: `.claude/knowledge/test-suite-health.md` § 5 as revised by the batch spec (`toolchain-and-sdk-boundary-batch-2026-10.md` D1.1); the exact script is in the batch plan's PR 1 checkpoint (`…-plan.md`). Two runs with two purposes: a DIAGNOSTIC matrix on the unchanged tree (what does 1.4.3 change?) and an ACCEPTANCE matrix on the commit carrying only the resulting fixes, both runtimes on the same snapshot. Raw logs and JUnit reports live in the session scratchpad (`acceptance4/<runtime>/…`, `acceptance3/1.4.3/leg6/…`) — not committed; every number below is copied from them by `gen-evidence.py`.

## Identities
- Candidate: `bun-darwin-aarch64.zip` from the `bun-v1.4.3` GitHub release, sha256 `80afd4c069b46a6fa8f3ec520bebc750a7843e4a8d5b9583d29ad436c00a3403`, unpacked side-by-side; reports `1.4.3`. The system bun stayed `1.3.13` (`/Users/roscoe/.bun/bin/bun`) until merge.
- Acceptance runtimes as captured inside each run (`which bun` · `bun --version`): 1.3.13 → `/Users/roscoe/.bun/bin/bun · 1.3.13`; 1.4.3 → `/private/tmp/claude-501/-Users-roscoe-go-src-github-com-markhayden-bakin/970d9ed2-ea40-419e-bad4-12b986e801fc/scratchpad/bun-1.4.3-dl/bun-darwin-aarch64/bun · 1.4.3`. The candidate directory was FIRST on `PATH` for every 1.4.3 leg, so the runner and every `bun` a test spawns (the compiled teeth, SDK publication) were 1.4.3.
- Linux: `oven/bun:1.4.3`, image id `sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598`, `--platform linux/amd64` (CI's architecture), non-root (`useradd ci`, `su -s /bin/bash`), git installed, Bits cloned at CI's sibling path at `design-system/compatibility.json`'s ref `6b5c1fa7740759e8bf955284eb5b06f586a9ceb0`, CI's asset pre-build, the inner script on a mounted evidence dir.
- Snapshot: `chore/965-bun-1.4.3` at **065486ec1** (the last fixes-only commit, before the pin) checked out in a detached worktree beside the Bits checkout with a real `bun install --frozen-lockfile`.

## Diagnostic matrix — unchanged tree (`main` ea837822a)
Baseline 1.3.13 (2026-10-20): 12128 pass / 18 skip / 0 fail, 12146 tests across 1233 files, 247 s.

| Leg | 1.4.3 result |
|---|---|
| 1 Ink canary | 4 pass / 0 fail |
| 2 Pi fake-provider canary | 31 pass / 0 fail |
| 3 full suite | 12125 pass / 18 skip / **3 fail** (12146), 76–78 s |
| 4 shard 2/3 ×4 (the 1.4.0–1.4.2 crasher) | 4089/2 ×3, 4088/3 ×1 — **no SIGSEGV** |
| 4 shards 1, 3 | 3967/1, 4069/0 |
| 5 `bun run build` → `version` → compiled teeth | 8 s; prints; oauth-static 5/0, sharp-store 3/0, plugin-defaults 2/0 |
| 6 Linux amd64 (non-root, git, Bits, CI build), shard 2 | 4089/2, **no SIGSEGV** (an earlier arm64/root/no-git attempt added 4 environmental fails: git absent, chmod injections cannot fail as root) |

Deltas found, none a crash, all diagnosed and fixed in this PR (spec D1.9):
1. `tests/core/delivery/readiness-collect.test.ts:109` — asserted the last SSE broadcast right after polling the in-memory snapshot; the broadcast sits behind `await import('@/core/sse')`, a macrotask on 1.4. Fix: poll the broadcast state the assertion needs.
2. `tests/cli/component-install.test.ts:113` — two Ctrl-C presses after polling the registry, but `followLocalAndRender` attaches its SIGINT listener after `await import('../core/operations')`. Fix: wait for the follower's first rendered update, as its sibling test does.
3. `tests/core/watchdog.test.ts:838` — the fake-timer shim's `flushMicrotasks(4)` was a depth guess (probes: +50 microtask turns pass, one real `setImmediate` turn passes). Fix: the shim drains with one real `setImmediate` turn; contract pinned by `tests/setup-fake-timers.test.ts`.
4. `tests/core/net/download.test.ts:133` — once in seven runs under parallel load: the write sink's async open raced the fail-fast cleanup and left an empty file. Product fix: `downloadToFile` awaits the sink's `close` before cleanup; deterministic proof via the `createSink` seam.
5. **Linux amd64 only**, found by the first acceptance run's leg 6 (the diagnostic Linux leg never ran this file — the two new test files shifted the shard composition): `tests/plugins/workflows/node-config-drawer.test.tsx` map_workflow cases failed the act gate 8/8 runs on amd64/1.4.3 (file alone ×5, workflows dir ×3) while the same container on 1.3.13 passed 20/20 ×3. Cause: an unstubbed `useJsonFetch` of the workflow options whose error state landed after the test returned. Fix: stub the endpoint as the file's own picker test does, await the load inside `act`, act-wrap the interactions.

6. **CI only** (PR #1020, run 39720024532): under `GITHUB_ACTIONS` bun 1.4 prints each file header as a `::group::tests/….test.ts:` annotation (1.3 printed it bare), and `scripts/check-test-completeness.ts`'s header regex — the only source for a file whose tests all skipped — wanted the bare form, so CI reported the two all-skipped antfly suites as "never dispatched" while every file with a `<testsuite>` was covered by the junit source. Fix: the regex accepts the prefix; parsers exported and pinned by `tests/scripts/check-test-completeness.test.ts`; the patched checker passes against the failing run's downloaded artifacts ("✓ every discovered test file ran").
## Acceptance matrix — fixes-only snapshot 065486ec1, both runtimes
Two earlier attempts taught the recipe: (a) after a build leg restores the tracked embedded manifest, the next runtime's server-booting tests refuse to boot ("embedded manifest is stale — 21 entries missing") — CI regenerates the manifest before its test job, so the recipe now runs `build:host && build:plugins && build:assets-manifest` per runtime first; (b) a worktree that is not a sibling of `bakin-bits-official`, or whose `node_modules` is a copy rather than an install, fails ~250 tests identically on both runtimes (and the build) — the matrix runs only in a sibling worktree with a real install.

| Leg | 1.3.13 | 1.4.3 |
|---|---|---|
| pre-build (CI step: build:host && build:plugins && build:assets-manifest) | exit 0 | exit 0 |
| 1 Ink canary `tests/cli/readonly-logs.test.ts` | 4 pass / 0 skip / 0 fail | 4 pass / 0 skip / 0 fail |
| 2 Pi fake-provider canary `tests/integration/pi/turn.test.ts` | 31 pass / 0 skip / 0 fail | 31 pass / 0 skip / 0 fail |
| 3 full suite (`--parallel=4 --isolate --timeout 15000`) | 12134 pass / 18 skip / 0 fail (12152 tests, 1235 files, 262 s) | 12134 pass / 18 skip / 0 fail (12152 tests, 1235 files, 76 s) |
| 3 completeness (`junit-full.xml` + `full.log`) | ✓ every discovered test file ran | ✓ every discovered test file ran |
| 4 shard 1/3 | 3917 pass / 13 skip / 0 fail (3930 tests, 412 files, 55 s) | 3917 pass / 13 skip / 0 fail (3930 tests, 412 files, 36 s) |
| 4 shard 2/3, run 1 | 3978 pass / 5 skip / 0 fail (3983 tests, 412 files, 39 s) | 3978 pass / 5 skip / 0 fail (3983 tests, 412 files, 21 s) |
| 4 shard 2/3, run 2 | 3978 pass / 5 skip / 0 fail (3983 tests, 412 files, 43 s) | 3978 pass / 5 skip / 0 fail (3983 tests, 412 files, 21 s) |
| 4 shard 2/3, run 3 | 3978 pass / 5 skip / 0 fail (3983 tests, 412 files, 44 s) | 3978 pass / 5 skip / 0 fail (3983 tests, 412 files, 21 s) |
| 4 shard 3/3 | 4239 pass / 0 skip / 0 fail (4239 tests, 411 files, 44 s) | 4239 pass / 0 skip / 0 fail (4239 tests, 411 files, 23 s) |
| 4 completeness (shard union, junit + logs) | ✓ every discovered test file ran | ✓ every discovered test file ran |
| 5 `bun run build` → `dist/bakin-darwin-arm64 version` | exit 0 → 0.0.1-rc.41-43-g065486e-dirty | exit 0 → 0.0.1-rc.41-43-g065486e-dirty |
| 5 teeth `compiled-oauth-static` | 5 pass / 0 skip / 0 fail | 5 pass / 0 skip / 0 fail |
| 5 teeth `compiled-sharp-store` | 3 pass / 0 skip / 0 fail | 3 pass / 0 skip / 0 fail |
| 5 teeth `compiled-plugin-defaults` | 2 pass / 0 skip / 0 fail | 2 pass / 0 skip / 0 fail |
| wall time, pre-build + legs 1–5 | 499 s | 209 s |
| 6 Linux amd64, shard 2/3 (run at this snapshot in the earlier attempt; the container installs and clones for itself) | — | 3978 pass / 5 skip / 0 fail (3983 tests, 412 files, 46 s); runner exit shard2-exit=0; `1001 · /usr/local/bin/bun · 1.4.3` (uid · which bun · version) |

## Pin commit (1.5) gates on 1.4.3
Lock resolves `@types/bun@1.4.3` / `bun-types@1.4.3`; typecheck 0; lint 0 (`--max-warnings 0`); `tests/architecture/bun-pin.test.ts` + whiskit + rig lifecycle 140 pass / 0 fail; `ui:performance` valid after regeneration. Full suite on the pinned tree: 12137 pass / 18 skip / 0 fail (12155 tests, 1236 files, 79 s); `bun run build` 2 s; `dist/bakin-darwin-arm64 version` prints `0.0.1-rc.41-42-ge3e1d15-dirty`; embedded manifest regenerated (+61/−43 lines of vendor references). Remaining per-PR gate: `check:cycles` (12 pinned + 0 tolerated, allowlist current), `lint:home-bypasses` OK, `docs:check` green (the generated reference's only change was its date stamp — not committed), `ui:conformance --quick` 235/0 when run alone (beside two emulated containers its public-api inventory test once exceeded bun's 5 s per-test default at 6.7 s).

### Ratchet attribution (D0.8)
The 1.4 bundler splits the SDK differently. Reachable bytes — what a browser loads per entry — FELL everywhere: conversation 745,903 → 363,032; content 851,358 → 481,187; patterns 644,307 → 533,868; ui 509,274 → 490,921; navigation 166,793 → 121,079; layout 10,741 → 9,895; charts 72,243 → 71,467; host initial JS 279,266 → 182,147; shared `sdk-shared-*` chunks 707,375 → 484,384 total (21 → 30 chunks). It did so by inlining shared code into four entry FILES, whose raw-size ceilings rise: patterns 2,514 → 122,431; ui 7,404 → 85,186; layout 296 → 3,448; navigation 497 → 2,824. Core plugin clients are flat (±500 B); of the Bits clients, messaging and projects are flat too and terminal shrinks 689,867 → 686,371 B (−3,496 B) — the one plugin-client change above the noise, in the same direction. Mark approved taking the regenerated ceilings as-is (2026-10-21).

## Leg-6 recipe lessons
`oven/bun` ships without git and runs as root; CI's test job clones Bits at `${runner.workspace}/bakin-bits-official` and builds host/plugins/assets-manifest before testing; the inner script lives on a mounted evidence dir so the log, the JUnit report and the runner's own exit status survive `--rm`; `su -s /bin/bash` selects Bash like CI does; `--platform linux/amd64` on Apple Silicon runs under emulation (≈2–4× slower, which is what surfaced delta 5).

## Verdict
1.4.3 is clear of the `--parallel` runner crash on macOS (shard 2 ×4 diagnostic + ×3 acceptance) and on Linux amd64 (CI's architecture); the suite is ~3× faster; the compiled lanes pass; the six deltas are fixed at their cause. Repin proceeds.
