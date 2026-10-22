# Implementation Plan: Toolchain & SDK-Boundary Batch (2026-10-21)

Spec: `toolchain-and-sdk-boundary-batch-2026-10.md` (rev 4; Codex rounds 1–3 folded). Plan rev 2 (2026-10-21): rev 1 was reviewed read-only by Codex; its 12 findings (3 P1) are folded in and marked **(P#)**. Four PRs, one branch each, cut sequentially from merged `main` in the main checkout (3737 keeps serving `main` between PRs; Mark restarts it himself).

## Overview

Four PRs in a fixed order. Each PR is a set of vertical slices, each slice one conventional commit that leaves the tree green AND functional at that revision (a module moves with every consumer that imports it — D0.7). Codex reviews each PR (≥2 rounds, cap ~5, stop at approve; `codex exec --sandbox read-only -o out.md - < prompt.md`), findings are fixed in-batch, CI must be green, then the PR is squash-merged (D0.2/D0.3). No live gate per PR; no screenshots (no visual change, D0.3).

| # | Branch | Issue | Commits |
|---|--------|-------|---------|
| 1 | `chore/965-bun-1.4.3` (+ Bits `chore/bun-1.4.3`) | #965 | 6 |
| 2 | `fix/890-antfly-commit` | #890 | 4 |
| 3 | `refactor/809-sdk-boundary` | #809a | 6 |
| 4 | `refactor/809-sdk-hooks` | #809b | 4 |

## Architecture Decisions (spec, restated for the implementer)

- **Diagnostic vs acceptance matrix (D0.1, R1)** — the diagnostic matrix already ran on the unchanged tree and found four 1.4.3 deltas; the ACCEPTANCE matrix runs on the branch at the commit that carries ONLY the four D1.9 fixes, before the pin commit, with nothing changing in the checkout. The pin commit follows a green acceptance run.
- **Fix the assumption, never the symptom (D1.9)** — the three test deltas are a lazy-import macrotask (readiness), a listener attached behind a lazy import (Ctrl-C), and a depth-guess microtask flush in OUR fake-timer shim; the fourth is a product race in the download primitive. No sleeps, no wider timeouts, no deleted assertions.
- **The exact validated binary, everywhere (D1.2, D1.7, C16)** — `.bun-version`, `MANAGED_BUN_VERSION`, the lock's resolved `@types/bun`/`bun-types`, and the system bun all name 1.4.3; the scanner pins the first three together, the installer pins the fourth to the release tag.
- **The binary commit is the rollback boundary (D2.2, R4, T2, T4)** — before it, restore the previous state and restart the old installation only if one existed (`hadBinary`); after it, keep the new pair, retain `share.previous`, and report what did not complete. A leftover `share.previous` is refused with the version rule, never deleted (R5).
- **Honest homes, no facades (D3, D4)** — presentation → `packages/ui`, hook-binding wrappers → `packages/sdk`, server helpers + the turn engine + tool-access → `packages/core`; deleted paths get no re-export. Public import paths and signatures are unchanged, so Bits needs nothing for #809.
- **Structural duplication is the sanctioned cross-boundary type pattern (D3.1)** — ui keeps a structural `ConversationMessage` (precedent: `RuntimeChatChunk`), sdk/types owns the canonical one, a private module asserts mutual assignability, `type-single-home` scans ui and sanctions the pair.
- **Every reference is inventory (D4.3, C3)** — ~90 test files import or `mock.module` the app hooks; a narrow `mock.module` of a module the SDK graph also imports is an ESM link error, so such mocks spread the real module.

## Dependency Graph

```
PR1 #965 ──► PR2 #890 ──► PR3 #809a ──► PR4 #809b
 (toolchain;    (independent;   (independent of 1–2;   needs 3 (D3.8 allowlist exists;
  CI for 2–4     runs on 1.4.3)   D3.8 allowlist born)   use-conversation-* moved into sdk)
  then runs
  on 1.4.3)
Bits companion ─ after PR1 merges (Bits CI reads .bun-version)
```
PRs 1–3 are independent of each other's code; the order is risk-first (toolchain proves itself before the moves) and lets every later CI run on the new runtime. PR 4 depends on PR 3 for the allowlist it shrinks and the two SDK-level conversation hooks it re-points.

## Commit Strategy (batch rules)

One conventional commit per slice, scope = the package/module touched. Gate before EVERY commit, each step on its exit code (never a `tail`): `bun run typecheck && bun run lint` + the slice's test files with `--isolate`; a slice that changes SDK export lists regenerates `design-system/public-api.json` ONLY when the spec says a name/kind changes (none in this batch — `ui:public-api:check` must pass without regeneration in PRs 3–4), and `design-system/census.json` via `ui:census:generate` when an export list changes (PR 3); a slice that moves browser-reachable source rebuilds `build:vendors && build:host && build:plugins && build:assets-manifest` and commits `_embedded-assets-static.ts` only when it changed (D0.9); `ui:performance` runs against the EXISTING baseline in PRs 2–4 (a rise above 2,048 B is a finding to explain, never a regeneration — D0.8) and is regenerated exactly once, in PR 1's pin commit, because the bundler changed. Never commit `generated-version.ts`; restore `packages/sdk/styles.css` if the dev tailwind watcher rewrote it. Per-PR gate before opening the PR: `bun run check:cycles && bun run lint:home-bypasses && bun run test`, then `bun run build:host && bun run ui:conformance --quick` (`--full`, alone, for PRs 3–4), `bun run build` for PR 1, `bun run docs:check`. Each commit message ends with the attribution line in effect. **Revert sets are transitive closures evaluated at the branch tip (P9)** — a commit is self-sufficient going FORWARD (a move lands with all its consumers), but a later commit may depend on it (types, deleted-path assertions), so each PR table names the rollback chain: reverting a row means reverting everything listed after it in its chain, tip-first.

---

## PR 1 — #965 bun 1.4.3 (`chore/965-bun-1.4.3`)

| # | Commit | Revert set |
|---|--------|------------|
| 1.1 | `test(delivery,cli): poll the state the assertion needs — readiness waits for the SSE event, the Ctrl-C test waits for the follower` | alone |
| 1.2 | `test(setup): the fake-timer shim drains with one real setImmediate turn, never a microtask depth` | alone |
| 1.3 | `fix(core): downloadToFile awaits the sink's close before partial-file cleanup` | alone |
| 1.4 | `docs(evidence): bun 1.4.3 diagnostic + acceptance matrix` | alone |
| 1.5 | `chore(toolchain): pin bun 1.4.3 — .bun-version, @types/bun, managed-bun pin, lockfile, ratchet, embedded manifest, dev rig pin` | chain: 1.6 → 1.5 |
| 1.6 | `docs(toolchain): bun 1.4.3 is the pin — CLAUDE.md, test-suite-health §5, dependency-sweeps, CONTRIBUTING, README` | tip |

Chain: 1.1–1.4 are independent of each other and of the pin (they are correct on both runtimes); 1.6 describes 1.5.

### Task 1.1: Two test assumptions (D1.9 a, b)
- Acceptance: `tests/core/delivery/readiness-collect.test.ts:107-109` polls `waitUntil(() => lastReadinessEventState() === 'connected')` (the broadcast it asserts) and then asserts; `tests/cli/component-install.test.ts:108-110` waits for `updates.some(v => v.stages[0]?.status === 'active')` (the follower's first render, as `:93-96` does) before the two presses. Both files green on 1.3.13 AND on the side-by-side 1.4.3 (`PATH`-pinned), verified in the commit body with the two version strings.
- Verify: `bun test tests/core/delivery/readiness-collect.test.ts tests/cli/component-install.test.ts --isolate` on both binaries.
- Files: the two tests. Size: XS.

### Task 1.2: The shim drains, never guesses (D1.9 c, R2)
- Acceptance: `tests/setup.ts:436` `flushMicrotasks(n)` replaced by `drainMicrotasks()` = `await new Promise(r => setImmediate(r))` at the four call sites (`:339,:351,:363,:374`), with the narrowed guarantee in the comment (drains what is runnable; does not await `import()`/I/O/later immediates; lets real scheduled work run between fake fires). NEW `tests/setup-fake-timers.test.ts` (pure, no app modules): a 200-deep promise chain completes within one `advanceTimersByTimeAsync`; a fake `setTimeout` enqueued from a microtask fires within the same advance; `runAllTimersAsync` drains a retry-with-backoff chain of three; a pending dynamic import of a stubbed module is NOT observed by the advance (the test proves the negative then awaits it explicitly). `tests/core/watchdog.test.ts:838` green unchanged on both binaries.
- Verify: `bun test tests/setup-fake-timers.test.ts tests/core/watchdog.test.ts --isolate` on both binaries; then the FULL suite on 1.3.13 (`bun run test`) — a test that depended on the depth-4 guess is fixed in this commit, never by restoring the guess.
- Files: `tests/setup.ts`, `tests/setup-fake-timers.test.ts`, `tests/core/watchdog.test.ts` (only if a pin wording changes). Size: S.

### Task 1.3: The sink race (D1.9 d)
- Acceptance (P11): in `packages/core/src/net/download.ts:275-318` the failed-attempt path calls `sink.destroy()` and awaits the sink's **`close` event specifically** (`close` always follows `destroy()`, after `error` if one fired — `sinkDone` at `:280` rejects on `error` instead of resolving, so it is not the signal) before the per-attempt cleanup runs; the comment at `:296-301` is rewritten to describe the guarantee, not the race. `tests/core/net/download.test.ts:130-134` (real HTTP) stays as the regression pin. The DETERMINISTIC proof is a new isolated file `tests/core/net/download-sink-close.test.ts`: a `mock.module('fs')` overlay (spreading the real module) returns a `WriteStream` whose open is delayed ~20 ms, the fetch stub answers 404 immediately, and the test records the order of `close` and `rmSync` — it asserts rejection, `close` BEFORE cleanup, and no file afterwards; without the fix the same file proves the empty file exists (teeth, kept as a skipped-with-reason negative or asserted via the recorded order).
- Verify: `bun test tests/core/net/download.test.ts tests/core/net/download-sink-close.test.ts --isolate` ×3 on both binaries; `bun test tests/core/onboarding/antfly.test.ts tests/agent-packages/bin-installer.test.ts --isolate` (consumers of the primitive) **(P6)**.
- Files: `packages/core/src/net/download.ts`, `tests/core/net/download.test.ts`. Size: S.

### Checkpoint: acceptance matrix (D1.1, R1) — at the 1.3 tip; nothing else in the checkout changes until it is green
Executable recipe (P7) — the SAME snapshot (1.3 tip) on BOTH binaries, `set -o pipefail` so a `tee` never hides the runner's exit, one artifact per repetition, both completeness checks. `OUT` is the evidence dir in the scratchpad; `BUNDIR` the unpacked 1.4.3 release; the baseline loop uses the system 1.3.13.
```bash
set -o pipefail; cd "$REPO"; git status --short   # must be clean apart from untracked evidence
for RT in 1.3.13 1.4.3; do
  if [ "$RT" = 1.4.3 ]; then export PATH="$BUNDIR:$PATH"; fi
  O="$OUT/$RT"; mkdir -p "$O"; { which bun; bun --version; } > "$O/runtime.txt"
  bun test tests/cli/readonly-logs.test.ts --isolate               > "$O/leg1.log" 2>&1; echo "leg1 $?" >> "$O/exit.txt"
  bun test tests/integration/pi/turn.test.ts --isolate              > "$O/leg2.log" 2>&1; echo "leg2 $?" >> "$O/exit.txt"
  bun test --parallel=4 --isolate --timeout 15000 --path-ignore-patterns "dev/**" \
    --reporter=junit --reporter-outfile="$O/junit-full.xml" 2>&1 | tee "$O/full.log" >/dev/null; echo "leg3 $?" >> "$O/exit.txt"
  bun scripts/check-test-completeness.ts "$O/junit-full.xml" "$O/full.log" > "$O/complete-full.txt" 2>&1; echo "leg3-complete $?" >> "$O/exit.txt"
  for s in 1 2 3; do for r in 1 2 3; do [ "$s" = 2 ] || [ "$r" = 1 ] || continue
    bun test --parallel=4 --isolate --timeout 60000 --path-ignore-patterns "dev/**" --shard=$s/3 \
      --reporter=junit --reporter-outfile="$O/junit-$s-r$r.xml" 2>&1 | tee "$O/shard-$s-r$r.log" >/dev/null; echo "leg4 shard$s r$r $?" >> "$O/exit.txt"
  done; done
  bun scripts/check-test-completeness.ts "$O"/junit-1-r1.xml "$O"/junit-2-r1.xml "$O"/junit-3-r1.xml "$O"/shard-1-r1.log "$O"/shard-2-r1.log "$O"/shard-3-r1.log > "$O/complete-shards.txt" 2>&1; echo "leg4-complete $?" >> "$O/exit.txt"
  bun run build > "$O/build.log" 2>&1; echo "leg5-build $?" >> "$O/exit.txt"; ./dist/bakin-darwin-arm64 version >> "$O/build.log" 2>&1; echo "leg5-version $?" >> "$O/exit.txt"
  for t in tests/adapter-pi/compiled-oauth-static.test.ts tests/integration/media/compiled-sharp-store.test.ts tests/integration/plugins/compiled-plugin-defaults.test.ts; do
    bun test "$t" --isolate > "$O/$(basename "$t" .test.ts).log" 2>&1; echo "leg5 $(basename "$t") $?" >> "$O/exit.txt"; done
  git checkout packages/core/src/generated-version.ts packages/host/src/api/_embedded-assets-static.ts
done
# leg 6 (1.4.3 only): amd64, non-root, git, Bits at CI's sibling path, CI's asset build, shard 2 — the recipe that produced leg 6b:
BITS_REF=$(node -p "require('./design-system/compatibility.json').repositories['bakin-bits-official'].ref")
docker run --rm --platform linux/amd64 -v "$PWD":/src:ro -e BITS_REF="$BITS_REF" oven/bun:1.4.3 bash -c '
  set -eo pipefail; apt-get update -qq >/dev/null && apt-get install -y -qq git >/dev/null 2>&1; useradd -m ci
  mkdir -p /w && cp -R /src/. /w/bakin && rm -rf /w/bakin/node_modules /w/bakin/dev/bakin-instances && chown -R ci /w
  su ci -c "set -eo pipefail; cd /w
    git clone --filter=blob:none --no-checkout https://github.com/markhayden/bakin-bits-official.git /w/bakin-bits-official
    git -C /w/bakin-bits-official fetch --depth 1 origin \"$BITS_REF\" && git -C /w/bakin-bits-official checkout --detach FETCH_HEAD
    cd /w/bakin; id -u; which bun; bun --version; bun install --frozen-lockfile
    bun run build:host && bun run build:plugins && bun run build:assets-manifest
    bun test --parallel=4 --isolate --timeout 60000 --path-ignore-patterns \"dev/**\" --shard=2/3 --reporter=junit --reporter-outfile=/tmp/junit-2.xml 2>&1 | tee /tmp/shard-2.log | tail -5"' > "$OUT/1.4.3/leg6.log" 2>&1; echo "leg6 $?" >> "$OUT/1.4.3/exit.txt"
```
- [ ] Every `exit.txt` line is `0` on 1.4.3; the 1.3.13 baseline lines are the comparison for counts (a 1.3.13 red would mean the fixes commit broke 1.3 — stop).
- [ ] Every leg green — zero fails is the bar, including a recurrence of any D1.9 delta (that would mean its fix is incomplete, T1); counts per leg recorded against the same leg on 1.3.13. Any red ⇒ D1.8.
- [ ] `git checkout packages/core/src/generated-version.ts packages/host/src/api/_embedded-assets-static.ts` after leg 5 (the pin commit regenerates the manifest deliberately; the build's version stamp is never committed).

### Task 1.4: Evidence file
- Acceptance: `tasks/evidence-bun-1.4.3.md` = the scratchpad draft + the acceptance-run table (per-leg counts, times, `which bun`, zip sha256, image digest, Bits ref), the four deltas with their fixes, the leg-6 recipe lessons, verdict.
- Verify: `bun run docs:check` (no generated docs touched — expect no-op).
- Files: `tasks/evidence-bun-1.4.3.md`. Size: XS.

### Task 1.5: The pin commit (D1.2, D1.3, D1.4, D1.5)
- Acceptance: `.bun-version` = `1.4.3`; `package.json` `@types/bun` = `~1.4.3`; `bun.lock` regenerated by `bun install` under 1.4.3 (both `@types/bun` and `bun-types` resolve 1.4.x); `src/core/whiskit/bun-pin.ts` `MANAGED_BUN_VERSION = '1.4.3'` with the three sha256s regenerated by the header loop (values pasted into the commit body with the curl URLs); NEW `tests/architecture/bun-pin.test.ts` (pure scanner): `MANAGED_BUN_VERSION` === `.bun-version`; lock-resolved `@types/bun` and `bun-types` share `major.minor` with the pin; `bunfig.toml:4` comment records the `[test.env]` re-probe on 1.4.3; `dev/docker/Dockerfile` `ARG BUN_VERSION` + `bash -s "bun-v${BUN_VERSION}"`, `docker-compose.yml` args `BUN_VERSION: ${BUN_VERSION:?set from .bun-version — use bun run docker:up or bun run instance}` (an unset version fails loudly instead of floating), EVERY compose entrypoint derives it **(P8)**: `scripts/instance/lifecycle.ts` exports `BUN_VERSION` from `.bun-version` and `composeUpArgs` adds `--build` (`tests/scripts/instance/lifecycle.test.ts:72` updated), `package.json:85` `docker:up` becomes `BUN_VERSION=$(cat .bun-version) docker compose -f dev/docker/docker-compose.yml up -d --build openclaw-gateway`, and the compose header's direct-command comment (`docker-compose.yml:3`) points at those two; `design-system/performance.json` regenerated (`ui:performance:generate` after production `build:vendors && build:host && build:plugins` on 1.4.3 — the ceilings fall; deltas in the commit body); `_embedded-assets-static.ts` regenerated and committed (D0.9). Reference-plugin and scaffold `@types/bun ^1.0.0` untouched.
- Verify: on 1.4.3 — `bun run typecheck && bun run lint && bun test tests/architecture/bun-pin.test.ts tests/core/whiskit tests/scripts/instance/lifecycle.test.ts --isolate && bun run ui:performance && bun run test` (full suite on the new pin) `&& bun run build && ./dist/bakin-darwin-arm64 version` **(P6)**.
- Files: `.bun-version`, `package.json`, `bun.lock`, `src/core/whiskit/bun-pin.ts`, `tests/architecture/bun-pin.test.ts`, `bunfig.toml`, `dev/docker/{Dockerfile,docker-compose.yml}`, `scripts/instance/lifecycle.ts` (+ its test), `design-system/performance.json`, `packages/host/src/api/_embedded-assets-static.ts`. Size: M.

### Task 1.6: Docs (D1.6)
- Acceptance: CLAUDE.md:183–185 (pin 1.4.3, history one sentence, readiness rules + the drain rule); `test-suite-health.md` §5 rewritten (pin, matrix as run, history dated, leg-6 recipe, fake-timer rule), `:184` release sharding sentence fixed; `release.yml:226` comment fixed; `dependency-sweeps.md` §3 row struck RESOLVED 2026-10-21 (#965), coupling row true, §5 per-PR log row; `CONTRIBUTING.md:7`, `README.md:12`, `SPEC.md:118`.
- Verify: `bun run docs:check`; `grep -rn "1\.3\.13" CLAUDE.md README.md CONTRIBUTING.md SPEC.md .bun-version bunfig.toml` returns only the dated history sentences.
- Files: the docs above. Size: S.

### Checkpoint PR 1
- [ ] Per-PR gate on 1.4.3 (`check:cycles`, `lint:home-bypasses`, full suite, `build:host && ui:conformance --quick`, `bun run build`, `docs:check`); Codex ≥2 rounds; CI green on all three shards; squash-merge.
- [ ] System bun → exact `bun-v1.4.3` via the pinned installer (D1.7), `bun --version` + zip sha256 checked, `rm -rf node_modules && bun install`; tell Mark to restart 3737.
- [ ] Bits companion `chore/bun-1.4.3` from a fresh worktree off Bits `origin/main`: `.bun-version`, root/terminal/_template `@types/bun ~1.4.3`; Bits CI green; merge; record in the sweep log.
- [ ] Memory `bun-1314-regression.md` updated; #965 closed with the evidence link.

---

## PR 2 — #890 antfly installer commit (`fix/890-antfly-commit`)

| # | Commit | Revert set |
|---|--------|------------|
| 2.1 | `fix(adapter-antfly): every version probe takes op.signal` | alone |
| 2.2 | `refactor(adapter-antfly): binary commit rides commitFileAtomic; share/ swaps aside with the binary commit as the rollback boundary` | with 2.3 |
| 2.3 | `test(adapter-antfly): installerFs seam + five failure cases; arch pin for the file commit` | with 2.2 |
| 2.4 | `docs(search): the antfly commit order, rollback boundary and share.previous; #890 closed` | alone |

### Task 2.1: Cancellation wired into all four probes (D2.3, C9)
- Acceptance: `installer.ts:294,301,395,410` pass `{ signal: op.signal }` to `antflyBinaryVersion`; `antfly.test.ts:639` green unchanged; new case: cancel during the current-version recheck (`:301`) settles `cancelled` with `serviceIo` recording no stop; `tests/adapter-antfly/version-probe.test.ts` gains the already-aborted-signal case.
- Verify: `bun test tests/core/onboarding/antfly.test.ts tests/adapter-antfly/version-probe.test.ts --isolate`.
- Files: `packages/adapter-antfly/src/installer.ts`, the two tests. Size: S.

### Task 2.2: Commit order and rollback (D2.1, D2.2)
- Acceptance: inside `withServiceOperation`: refuse BEFORE `stopService` if `share.previous` exists (message names the dir and the version rule: pinned version reported at the install path ⇒ delete it, otherwise restore it over `share/` and reinstall — never "restore beside the new binary"); then `stopService`; rename live `share/` → `share.previous` (upgrade only); rename extracted `share/` in; `commitFileAtomic(extractedBinary, targetPath, { mode: 0o755 })`; derived-data clear; `finish()`; delete `share.previous` best-effort only after `finish()` succeeds. A throw before the binary commit succeeds → restore (`share/` → away, `share.previous` → `share/` when it exists), `finish()` the old installation ONLY when `hadBinary`, rethrow (a fresh install restores absence and keeps its original error); a throw after it → keep the new pair AND `share.previous`, rethrow with the message naming the uncompleted step. `renameSync(extractedBinary` gone; `commitFileAtomic` imported. All existing `antfly.test.ts` cases green with their exact message substrings.
- Verify: `bun test tests/core/onboarding/antfly.test.ts --isolate`; `bun run typecheck`.
- Files: `packages/adapter-antfly/src/installer.ts`. Size: M.

### Task 2.3: Seam, four failure cases, arch pin (D2.4, R5, R6)
- Acceptance: typed `installerFs?: { renameDirectory?, commitFile? }` (defaults real) on the Antfly installer's OWN fourth options argument (`installer.ts:245`, beside `serviceIo`/`readyBudgetMs`; `antfly.test.ts:69` passes it there) — `SearchAdapterSetupOptions` untouched; the five D2.4 cases (i)–(v): (i)/(ii) upgrade failures before the commit (bytes, restore, stop→start), (iii) start fails after the commit (new pair kept, `share.previous` retained), (iv) pre-existing `share.previous` refused before stop, (v) fresh-install commit failure (no start, moved-in `share/` removed, original error); `tests/architecture/operations-transfers.test.ts`: antfly installer imports `commitFileAtomic` and has no `renameSync(extractedBinary`; the file-promoting modules each import `commitFileAtomic`; NO general rename ban (media/requirements promote directories).
- Verify: `bun test tests/core/onboarding/antfly.test.ts tests/architecture/operations-transfers.test.ts --isolate`.
- Files: `packages/core/src/adapters/search/index.ts`, `packages/adapter-antfly/src/installer.ts`, the two tests. Size: M.

### Task 2.4: Docs + close (D2.5, D2.6)
- Acceptance: `media-pipeline.md:101-103`, `search-system.md:90-99,407` (+ `share.previous` paragraph), `media-zero-install-889.md` status line; #890 closed naming `3d449ca4e`, `4e8ebe5bc` and this PR.
- Verify: `bun run docs:check`.
- Files: the docs. Size: XS.

### Checkpoint PR 2
- [ ] Per-PR gate; Codex ≥2; CI; squash-merge; #890 closed.

---

## PR 3 — #809a conversation dir, Drawer, turn engine (`refactor/809-sdk-boundary`)

| # | Commit | Revert set |
|---|--------|------------|
| 3.1 | `refactor(sdk,ui): ConversationMessage's canonical home is @makinbakin/sdk/types; ui keeps its structural copy under a private contract` | chain: 3.6 → 3.5 → 3.3 → 3.2 → 3.1 |
| 3.2 | `refactor(core): the turn engine, turn recorder, thread id and tool-access renderer live in @bakin/core` | chain: 3.6 → 3.5 → 3.3 → 3.2 |
| 3.3 | `refactor(ui,sdk): reply-toast body, attention and the reply chime are kit presentation; the attention hook and the SDK toast wrapper are SDK modules; src/components/conversation is gone` | chain: 3.6 → 3.5 → 3.3 |
| 3.4 | `refactor(ui,host): Drawer is a kit pattern; the src/components/ui shims are deleted` | chain: 3.6 → 3.5 → 3.4 |
| 3.5 | `test(architecture): sdk-app-boundary allowlist; tolerated cycles are stale-checked` | chain: 3.6 → 3.5 |
| 3.6 | `docs(kit): conversation homes, repo map, CLAUDE.md pointers` | tip |

Chain (P9): 3.1 ← 3.2 (the recorder's types) ← 3.3 (the wrapper re-exports the sdk/types names) ; 3.5 asserts the paths 3.2/3.3/3.4 deleted; so 3.1 reverts only with 3.2, 3.3, 3.5, 3.6; 3.2 with 3.3, 3.5, 3.6; 3.4 with 3.5, 3.6.

### Task 3.1: Type home (D3.1)
- Acceptance: `packages/sdk/src/types/conversation.ts` declares `ConversationMessage`, `DisplayAttachment` (+ the row unions the recorder emits), exported from `@makinbakin/sdk/types`; `packages/ui/src/conversation/fold.ts` keeps its structural declarations (renamed internally only if the scanner demands it — it does not: the pair is sanctioned); `tests/architecture/type-single-home.test.ts` adds `packages/ui/src` to `SCAN_ROOTS` and sanctions `ConversationMessage`/`DisplayAttachment` to the pair — any OTHER sanctioned name ui turns out to declare is resolved here; `packages/sdk/src/conversation/message-contract.ts` (private, not re-exported) asserts mutual assignability; `@makinbakin/sdk/conversation` re-exports the sdk/types names (no name/kind change → `ui:public-api:check` passes).
- Verify: `bun run typecheck && bun test tests/architecture/type-single-home.test.ts tests/ui/architecture/conversation-foundation.test.ts --isolate && bun run ui:public-api:check`.
- Files: `packages/sdk/src/types/{conversation,index}.ts`, `packages/sdk/src/conversation/{index.ts,message-contract.ts}`, `packages/ui/src/conversation/fold.ts`, `tests/architecture/type-single-home.test.ts`. Size: S.

### Task 3.2: Server code → core (D3.2, C1)
- Acceptance: `packages/core/src/conversation/{turn-recorder,thread-id,turns}.ts` and `packages/core/src/tool-access.ts` exist with their old contents (imports made core-relative; `turns.ts` lazy-imports `../tool-access`); `src/core/conversation-turns.ts`, `src/core/tool-access.ts`, `src/components/conversation/{turn-recorder,thread-id}.ts` deleted; consumers repointed: engine — `src/lib/plugin-context-factory.ts`, `src/core/conversation-metering.ts:12` (type import) **(P1)**, `plugins/brands/lib/{brainstorm-bridge,store}.ts`, `plugins/chat/lib/stream-bridge.ts`, `packages/sdk/src/testing/index.ts`, `packages/sdk/src/types/conversation-turns.ts:4` (comment), 7 tests (`tests/core/{conversation-row-parity,conversation-turns}.test.ts`, `tests/integration/search-watcher-sync.test.ts`, `tests/plugins/chat/sweep.test.ts`, `tests/plugins/contract.test.ts`, `tests/plugins/workflows/{gate-hooks,sync-hook}.test.ts`); tool-access — `src/core/{bakin-skill,dispatch-prompts,team-context}.ts`, `src/core/exec-tools/tools/pdf.ts`, `tests/core/tool-access.test.ts`; recorder/thread-id — `packages/sdk/src/utils/index.ts:45-48` → `@bakin/core/conversation/*`, `plugins/brands/lib/brainstorm-bridge.ts:18`, `tests/sdk/conversation-stream.test.ts:20-21`. Any `mock.module` of the moved modules re-pathed (spread the real module where the SDK graph also imports it). `scripts/ui/performance.ts:140-146,186-191` domain predicates still match (`/conversation/` under packages). Dispatch-prompt byte fixtures (`tests/fixtures/dispatch-prompts/`) unchanged.
- Verify: `bun run typecheck && bun run check:cycles && bun test tests/core/conversation-turns.test.ts tests/core/conversation-row-parity.test.ts tests/core/tool-access.test.ts tests/sdk/conversation-stream.test.ts tests/plugins/chat tests/plugins/brands tests/core/dispatch-prompts.test.ts --isolate`.
- Files: as listed. Size: L (mechanical; one logical move).

### Task 3.3: Presentation → ui, wrapper + attention hook in sdk, dir gone (D3.3, D3.4, D3.5, C7, R7, P2, P5)
- Acceptance: `packages/ui/src/conversation/{attention.ts,notification-sound.ts,reply-toast-body.tsx}` (body = `ReplyToastBody({ avatarAgent, headline, preview, onSelect, testId })` rendering `AgentAvatar` from `avatarAgent`, the headline verbatim, raw `<button>` kept) exported from `@bakin/ui/conversation`; `plugins/team/hooks/use-agent-store.ts` gains `useAgentIdentity(agentId)` (display-name override, as the avatar adapter does today), re-exported by `@makinbakin/sdk/hooks`; `packages/sdk/src/conversation/reply-toast.tsx` exports `ConversationReplyToast` with the UNCHANGED props, importing `useRouter` from `'../navigation'` and `useAgentIdentity`/`useAgent` from `'../hooks'`, composing the headline from the RAW `agent?.name ?? agentId` exactly as `reply-toast.tsx:41` does (T5) — a new RTL case renders it with an overridden display name and asserts avatar = override, headline = raw name; `src/components/agent-avatar.tsx` uses `useAgentIdentity`; `packages/sdk/src/conversation/use-conversation-attention.tsx` moved in THE SAME commit (its `./attention`/`./notification-sound` imports become `@bakin/ui/conversation`; its `@/hooks/*` + `@/lib/browser-notify` imports stay, allowlisted until PR 4) and `packages/sdk/src/conversation/index.ts:60-72` re-exports everything from the new homes in this commit (no intermediate commit imports a deleted path — P2); `src/components/conversation/` (all seven files incl. the deprecated `fold.ts` shim) deleted; `conversation-foundation.test.ts:40` drops the shim assertion; `tests/ui/architecture/ui-dependencies.test.ts` re-pathed; `@makinbakin/sdk/conversation` re-exports the attention/chime names from `@bakin/ui/conversation`; `design-system/exceptions.json:152,158` + `migrations.json` T34 re-pathed to `packages/ui/src/conversation/reply-toast-body.tsx` (counts unchanged); `conversation-renderers.test.ts:98-116` asserts the SDK-local specifiers and still forbids `@bakin/team`/router/`@/`; `tests/components/activity-feed.test.tsx` green; `plugins/chat/components/chat-badge-provider.tsx` untouched. **Mock inventory for the new hook (P5):** the hooks barrel re-exports `useAgentIdentity` from `@bakin/team/hooks/use-agent-store`, so every narrow `mock.module('@bakin/team/hooks/use-agent-store')` (5 files: `tests/components/models-page.test.tsx:45`, `tests/plugins/workflows/node-config-drawer.test.tsx:48`, `tests/plugins/schedule/schedule-page.test.tsx:164`, `tests/plugins/schedule/schedule-search-degraded.test.tsx`, `tests/plugins/memory/memory-shell-engine-down.test.tsx`) spreads the real module or supplies `useAgentIdentity` explicitly (fake-agent tests control the identity they render), and the ~40 narrow `mock.module('@makinbakin/sdk/hooks')` files are grepped for any that load the toast wrapper — those spread the real module. The parity test is `tests/sdk/conversation-reply-toast.test.tsx` (overridden display name ⇒ avatar override, raw headline).
- Verify: `bun run typecheck && bun test tests/sdk/conversation-reply-toast.test.tsx tests/ui/architecture tests/components/activity-feed.test.tsx tests/components/models-page.test.tsx tests/plugins/chat tests/plugins/workflows/node-config-drawer.test.tsx tests/plugins/schedule tests/plugins/memory --isolate && bun run ui:legacy-styles:check && bun run ui:public-api:check`.
- Files: as listed. Size: M.

### Task 3.4: Drawer → ui; shims deleted (D3.6, C2, P4)
- Acceptance: `packages/ui/src/patterns/drawer.tsx` exported from `@bakin/ui` root; `packages/sdk/src/ui/index.ts:16-17` re-exports from `@bakin/ui`; `src/components/drawer.tsx` + `src/components/ui/*` (7) deleted; `packages/host/src/providers/Providers.tsx:3` → `@bakin/ui`; the six architecture suites updated per D3.6 (identity assertions kept, shim reads → `existsSync === false`); `tests/components/drawer.test.tsx` and the 10 RTL suites that `mock.module('@/components/ui/...')`/import the Drawer re-pathed (spread-the-real-module rule); `ui:census:generate` run and committed; `design-system/exceptions.json:92,116` re-pathed from `src/components/drawer.tsx` to `packages/ui/src/patterns/drawer.tsx` with the allowance and rationale intact (the exception existence check at `scripts/ui/conformance.ts:166` and the stale-allowance check at `check-legacy-styles.ts:460` both pass) **(P4)**; the private-ui boundary test green (Drawer's deps are all ui-internal).
- Verify: `bun run typecheck && bun test tests/ui/architecture tests/components/drawer.test.tsx tests/plugins/team tests/plugins/workflows/node-config-drawer.test.tsx tests/plugins/schedule/schedule-page.test.tsx tests/components/kanban-dnd.test.tsx --isolate && bun run ui:public-api:check && bun run ui:census:check && bun run ui:legacy-styles:check && bun run ui:conformance --quick`.
- Files: as listed. Size: M.

### Task 3.5: Teeth (D3.7, D3.8)
- Acceptance: `tests/architecture/sdk-app-boundary.test.ts` with the allowlist {`hooks/index.ts` (groups 1–3, issue #809b), `conversation/use-conversation-thread.ts` (#809b), `conversation/use-conversation-attention.tsx` (#809b)} and the deleted-path assertions; `scripts/check-cycles.ts` stale-checks tolerated entries and the stale `use-query-state` entry is deleted; `bun run check:cycles` reports `0 tolerated` with no stale entry.
- Verify: `bun test tests/architecture/sdk-app-boundary.test.ts --isolate && bun run check:cycles`.
- Files: the test, `scripts/check-cycles.ts`. Size: S.

### Task 3.6: Docs (D3.10)
- Acceptance: `conversation-kit.md:18-21,74`, `repo-architecture.md` map, CLAUDE.md Conversation Kit + Runtime Capabilities pointers, `shared-ui-patterns.md:38,368,379-380`.
- Verify: `bun run docs:check`.
- Files: the docs. Size: XS.

### Checkpoint PR 3
- [ ] Per-PR gate incl. `ui:conformance --full` (alone), `ui:performance` within tolerance (no regeneration), `build:assets-manifest` and the manifest committed if changed (D0.9); Codex ≥2; CI; squash-merge.
- [ ] **Bits compatibility proof (P10):** assemble the candidate SDK package the way `tests/scripts/build-sdk-package.test.ts:170` does (same builder, temp `outDir`), create an isolated consumer dir with `node_modules/@makinbakin/sdk` symlinked to it, copy in UNCHANGED Bits `plugins/{projects,messaging}/components/brainstorm-badge-provider.tsx` and `plugins/test-helpers.ts` with a minimal tsconfig, run `tsc --noEmit`; the command and result go in the PR body. (A one-off script in the scratchpad; not committed.)

---

## PR 4 — #809b the 19 app hooks (`refactor/809-sdk-hooks`)

| # | Commit | Revert set |
|---|--------|------------|
| 4.1 | `refactor(core,sdk): map-audit-message and self-update-verify live in @bakin/core; host-state types in @makinbakin/sdk/types` | chain: 4.4 → 4.3 → 4.1 |
| 4.2 | `refactor(sdk): browser-notify is SDK plumbing — host verbs on sdk/internal, sendBrowserNotification on sdk/hooks` | chain: 4.4 → 4.3 → 4.2 |
| 4.3 | `refactor(sdk): the 19 Bakin-wide hooks are SDK files; the barrel re-exports plugin-sourced hooks only` | chain: 4.4 → 4.3 |
| 4.4 | `test(architecture),docs: the sdk-app allowlist is plugin hooks only; hook homes in the knowledge docs` | tip |

Chain (P9): 4.3 imports the homes 4.1 and 4.2 created; 4.4 asserts the paths 4.3 deleted.

### Task 4.1: Pure helpers + types (D4.2 part 1)
- Acceptance: `packages/core/src/events/audit-message.ts` (from `src/lib/map-audit-message.ts`; consumers `packages/host/src/api/activity.ts`, `plugins/team/lib/timeline.ts`, the two hooks, `tests/lib/map-audit-message.test.ts`), `packages/core/src/install-core/self-update-verify.ts` (consumers `src/core/updates/self-update-cli.ts`, `src/cli/self-update-verify.ts`, the hook, its test), `packages/sdk/src/types/host-state.ts` (from `src/types/index.ts`, exported from `@makinbakin/sdk/types`; consumers of `@/types`/`../../src/types` repointed); old files deleted.
- Verify: `bun run typecheck && bun test tests/lib tests/core/updates tests/cli/self-update-verify.test.ts --isolate`.
- Files: as listed. Size: M.

### Task 4.2: browser-notify (D4.2 part 2, C4, R8)
- Acceptance: `packages/sdk/src/internal/browser-notify.ts`; `@makinbakin/sdk/internal` exports the six host verbs; `@makinbakin/sdk/hooks` exports `sendBrowserNotification`; host consumers (`main.tsx:11`, `notification-toggle.tsx:5-10`, the two attention providers), `src/hooks/use-sse.ts:8` (still at its old home until 4.3 — repointed here so no commit imports a deleted path), `packages/sdk/src/conversation/use-conversation-attention.tsx:19`, `plugins/spend/components/spend-badge-provider.tsx` + the workflows plugin repointed; `plugins/spend/lib/browser-notify.ts` deleted and its mock at `tests/plugins/spend/badge-provider.test.tsx:55` re-pathed to the SDK module (spy preserved); `tests/lib/browser-notify.test.ts:26` moves to `tests/sdk/internal/browser-notify.test.ts` with its imports repointed; `no-hard-navigation.test.ts:65,184` and `eslint.config.mjs:291` re-pathed with the fallback rationale; `mock.module('@/lib/browser-notify')` ×2 in tests re-pathed **(P3)**.
- Verify: `bun run typecheck && bun run lint && bun test tests/architecture/no-hard-navigation.test.ts tests/sdk/internal tests/host tests/plugins/spend tests/hooks tests/components/use-sse*.test.tsx --isolate`.
- Files: as listed. Size: S.

### Task 4.3: The 19 hooks (D4.1, D4.3, C3)
- Acceptance: `packages/sdk/src/hooks/use-*.ts` (19) with `use-nav-badge.ts` importing `../register`; barrel groups 1 → `./use-*`, header rewritten; `src/hooks/` deleted; every reference re-pathed from the grep inventory (`@/hooks/*` ×~60 imports, `src/hooks/*` relative ×~25, `mock.module('@/hooks/...')` ×~40 — spread-the-real-module where the SDK graph imports the mocked module); `packages/sdk/src/conversation/{use-conversation-thread,use-conversation-attention}` import `../hooks/*`; pins: `no-hard-navigation.test.ts:33,98,188`, `operations-runtime-switch.test.ts:37,71`, `navigation-entrypoint.test.ts:47-48`, `conversation-renderers.test.ts:100,106,116`, `system-feedback.test.ts:43`, `eslint.config.mjs` `use-sse` entry.
- Verify: `bun run typecheck && bun run lint && bun run check:cycles && bun run test` (the whole suite — the mock inventory is the risk) `&& bun run ui:public-api:check`.
- Files: as listed. Size: L (mechanical).

### Task 4.4: Teeth + docs (D4.4, D4.5)
- Acceptance: `sdk-app-boundary.test.ts` allowlist = `hooks/index.ts` groups 2–3 only; `check-cycles.ts` `key()`/`TOLERATED_CYCLES` deleted if unused; `repo-architecture.md`, `operations.md:36`, `search-system.md:393`, `style-guide.md` if it names `src/hooks`; SDK reference docs via `docs:generate`.
- Verify: `bun test tests/architecture/sdk-app-boundary.test.ts --isolate && bun run check:cycles && bun run docs:check`.
- Files: as listed. Size: S.

### Checkpoint PR 4
- [ ] Per-PR gate incl. `ui:conformance --full` (alone), `ui:performance` within tolerance, manifest per D0.9; the PR 3 Bits compatibility proof repeated (P10); Codex ≥2; CI; squash-merge; #809 closed with evidence.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| The shim's setImmediate drain changes behaviour in a fake-timer test that relied on depth 4 | Med | full suite on BOTH binaries at 1.2; focused shim tests pin the contract |
| Acceptance matrix finds a fifth delta | Med | D1.8 exactly (P12): no PR; the evidence file + the re-dated `dependency-sweeps.md` row land on `main` as a docs commit; #965 gets the comment; PRs 2–4 proceed on 1.3.13 |
| CI on 1.4.3 flakes differently under GitHub load | Med | shard 2 ×3 locally + amd64 container; rerun-failed-job-first for a single-test flake, bisect method for a repeat |
| `bun install` under 1.4.3 rewrites the lock widely | Low | lock diff reviewed in the commit; `--frozen-lockfile` on CI proves it |
| antfly rollback order regresses the existing 705-line suite | Med | suite unchanged + exact substrings; seam-injected cases cover each branch |
| ui now in `type-single-home` scan exposes other duplicated names | Low | resolved in 3.1 (sanction or move), never excluded |
| A narrow `mock.module` of a moved hook turns into an ESM link error | High | spread-the-real-module rule; full suite in 4.3's verify |
| `ui:performance` moves above tolerance in PR 3/4 | Low | pure moves — explain any rise, never regenerate (D0.8) |
| Two full suites run concurrently by accident (matrix + suite) | High | matrix legs and suites are sequential; conformance `--full` runs alone |
| Mark's 3737 dev loop rewrites `styles.css`/the manifest mid-PR | Low | restore before commits; D0.9 for the manifest |

## Parallelization
None across PRs (sequential by design). Within PR 1, Codex review of 1.1–1.4 can overlap the acceptance matrix only if the checkout is frozen — so it does not: matrix first, then review. Within PRs 3–4, Codex review of commit N overlaps building N+1 only when they touch disjoint files.

## Open Questions
None blocking. Residuals are in the spec.
