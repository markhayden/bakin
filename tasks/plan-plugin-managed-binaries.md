# Implementation Plan: Plugin-managed binaries (tmux for Terminal)

Spec: `.claude/specs/plugin-managed-binaries.md` (v2). Task list: `tasks/todo-plugin-managed-binaries.md`.

## Overview

Plugins declare binaries in `bakin-plugin.json` (`requires.bins`, the capability-pack schema); Bakin discloses them at consent, installs them sha256-verified into `~/.bakin/bin` as part of an atomic install/upgrade, records ownership in the plugin lockfile, reports drift through the existing `plugin-assets` surfaces with a one-click doctor repair, and removes them with the plugin unless another owner still pins the same file. Bits gains a reproducible tmux mirror build and Terminal 0.2.0 consumes it. Three repos-worth of work in two repos, four PRs, one release in between.

## Architecture decisions (beyond the spec's D1–D7)

- **ONE bin schema module.** `packages/core/src/plugins/bin-requirement.ts` owns `BinRequirementSchema`, `BinDownloadSchema` (+ optional `sizeBytes`) and `BIN_PLATFORM_KEYS`; the pack manifest and the plugin manifest both import it. No second copy.
- **ONE verification predicate.** `src/core/agent-packages/bin-verify.ts` exports `verifyInstalledBin(target, download, marker)`; `installBinRequirement`'s skip check and the plugin-assets scan both call it (spec §2.7, review point 5).
- **ONE install lock, atomic, owned by the outer operation.** Today packs lock `~/.bakin/packages/.lock` and artifact upgrades lock `~/.bakin/plugins/.install.lock`, so they never exclude each other, and `acquireLock` is check-then-write. `install-core/install-lock` becomes one path (`~/.bakin/install.lock`) acquired with `openSync(path, 'wx')` (O_EXCL — atomic across processes) plus pid/time contents and stale-holder reclaim. The OUTER operation acquires it — pack install/update/sync/remove, plugin install/upgrade/remove, the plugin-assets repair — and inner helpers (`installManifestBins`, `installPluginBins`, `bin-owners`) only `assertLockHeld()`. A two-process contention test spawns a child that holds the lock and asserts the parent is refused with the holder's pid.
- **Conflict checks live where every writer passes.** `installManifestBins` is the one function all three pack writers (`installer.ts`, `updater.ts`, `sync.ts` via `installManifestRequirements`) reach; the conflict assertion lives there, not in `installer.ts`, so update and sync cannot overwrite a plugin's pin. Each caller gets a conflict test.
- **Upgrade consent is a preview/commit round-trip like install.** `POST /api/plugins/upgrade` is `{pluginId, yes}` today and the CLI confirms with `yes: true` — nothing binds the confirmation to what was previewed. It becomes preview → `awaitingConsent` + token bound to (pluginId, manifestSha, permissions, bins) → commit `{pluginId, accepted: true, consentToken}`; `--yes` still runs preview then commit through the token. Test: preview sha A, change the source to sha B, accept A → re-prompt, no mutation.
- **Crash safety via a durable transaction sentinel, not just catch/rollback.** Backup + catch cannot help after process termination. The replace transaction writes `<pluginDir>/.bakin-install.json` `{startedAt, pid, createdBins[], backupDir?}` before the first mutation and removes it at commit. The loader skips any plugin dir carrying the sentinel (never discoverable), and a boot-time recovery (before plugin discovery) finishes the rollback: restore the backup if present, otherwise delete the dir and the listed created bins. Tests drive recovery from on-disk states captured after the first bin, after replacement, and after ledger commit.
- **Plugin install/upgrade are install jobs.** Packages already run as jobs (`startInstallJob`, `GET /api/install-jobs/:id`, `packages.install_*` events, #902). Plugin install and upgrade REST handlers adopt the same job runner with stages `stage`, `build`, `bins`, `ledger`; the Explore install dialog consumes the same progress UI. S3 is verified by an observable `bins` stage event through the REST path, not by the helper callback.
- **ONE ownership helper.** `src/core/plugins/bin-owners.ts`: `binTargetOwners(target)` over both lockfiles and `assertNoPinConflict(bins, self)`; pack installer/uninstaller and plugin install/upgrade/remove/repair all call it under the install lock (spec §2.4, review point 2).
- **ONE plugin-replace transaction.** Today `upgrade.ts`, `upgrade-github.ts` and `upgrade-artifact.ts` each do `rm → cp → build → assets → lockfile` by hand with no backup, and `commit.ts` does its own variant whose ledger write swallows errors. `src/core/plugins/replace-transaction.ts` implements backup → place → build → skills+bins → ledger → commit-backup, restoring on any failure, and all four paths adopt it. This is the review's point 1 and the biggest debt reduction in the change.
- **Ledger writes are never swallowed.** A failed ledger write is a failed install/upgrade and rolls back. (The margo orphan-lock incident was the mirror image of this.)
- **The doctor repair is the component.** `install-plugin-assets` is a registered repair action that calls `pluginAssetsComponent.install()` under the install lock; no second implementation.
- **Bits mirror builds each Mac slice natively** — `macos-14` (arm64) and `macos-15-intel` (x64) — runs the headless tmux smoke on each, then `lipo`s into one universal binary and asserts with `otool -L` that no `/opt/homebrew` or `/usr/local` library is referenced. `BUILD.json` records both runner images.

## Dependency graph

```
T1 shared bin schema + plugin manifest parse + SDK type + docs
 ├── T2 verify predicate + bin-owners/conflict + lockfile installedBins
 ├── T2b ONE atomic install lock (outer-acquired) — every writer on both sides
 │    ├── T3 installPluginBins (marker plugin:<id>, progress) + pack uninstaller consults plugin owners
 │    │    ├── T6 install commit transaction (preflight → consent → bins → ledger → rollback + sentinel)
 │    │    │    ├── T6b plugin install/upgrade as install jobs (REST progress, `bins` stage event)
 │    │    │    └── T7 replace-transaction (sentinel + boot recovery) adopted by install and the 3 upgrade paths; T7b bins + upgrade consent round-trip
 │    │    │         └── T8 remove sweep (zero-owner deletion)
 │    │    └── T9 plugin-assets bins scan/install + doctor repair
 │    └── (T9 also depends on T2 only)
 └── T4 consent gate + CLI disclosure ──► T5 Explore dialogs
T10 docs/changelog (after T1–T9)           → Bakin PR → rc.39
T11 Bits PR 1: mirror workflow + publish guard → merge → run → sha/size
T12 Terminal service resolution + migration (Bits PR 2)
T13 Terminal manifest/page/README/contract test (needs T11's sha) → terminal-v0.2.0
T14 margo acceptance (needs rc.39 + terminal-v0.2.0)
```

Parallelizable: T4/T5 with T2/T3; T11 with all of Bakin; T12 with T11.

## Phases, tasks, checkpoints

### Phase A — Foundation (Bakin, branch `feat/plugin-managed-binaries` in the main checkout so 3737 can serve it)

- **T1 Shared bin schema, plugin manifest `requires.bins`, SDK type, docs** — S1. Files: `packages/core/src/plugins/bin-requirement.ts` (new), `packages/core/src/agent-packages/manifest.ts`, `packages/core/src/plugins/manifest.ts`, `packages/sdk/src/types/manifest.ts`, `docs/src/content/docs/extending/plugins/manifest.md`; test `tests/core/plugins/manifest-requires-bins.test.ts`. Size M.
- **T2 Verification predicate, ownership helper, lockfile field** — S15 (helper level), regression for changed bytes. Files: `src/core/agent-packages/bin-verify.ts` (new), `src/core/plugins/bin-owners.ts` (new), `packages/core/src/plugins/lockfile.ts`, `src/core/agent-packages/bin-installer.ts` (skip check → predicate); tests `tests/core/agent-packages/bin-verify.test.ts`, `tests/core/plugins/bin-owners.test.ts`. Size M.
- **T2b ONE atomic install lock** — Files: `src/core/install-core/install-lock.ts` (O_EXCL acquire, single path, `assertLockHeld`), `src/core/agent-packages/install-lock.ts` (facade → single path), `src/core/plugins/upgrade-artifact.ts` (drop its private path), callers in `installer.ts`/`updater.ts`/`sync.ts`/`uninstaller.ts`; tests `tests/core/install-core/install-lock.test.ts` incl. a two-process contention case (`Bun.spawn` child holds the lock). Size M.
- **T3 Plugin bin install entry, conflict check in the shared writer, cross-owner pack uninstall** — Files: `src/core/agent-packages/bin-installer.ts` (`installPluginBins`; gate removed; identity passed by caller; `assertNoPinConflict` + `assertLockHeld` inside `installManifestBins`), `src/core/agent-packages/uninstaller.ts` (`withoutSharedArtifacts` consults `binTargetOwners`); tests extend `tests/core/agent-packages/{bin-installer,uninstaller,updater,sync}.test.ts` with a conflicting-pin case per writer. Size M.

**Checkpoint A:** `bun test tests/core/plugins tests/core/agent-packages --isolate`, tsc, lint green. Nothing user-visible changed yet; safe rollback point.

### Phase B — Install path (vertical: consent → preflight → commit → rollback)

- **T4 Consent gate + CLI disclosure** — S17 (gate + CLI). Files: `packages/host/src/api/plugins/install/consent-gate.ts`, `src/core/plugins/consent-token.ts` (bins in the payload), `src/core/cli/consent-prompt.ts`, `src/cli/commands/plugins.ts`; tests `tests/plugins/lifecycle/consent-prompt-smoke.test.ts` + new `tests/host/plugins/consent-gate-bins.test.ts`. Size M.
- **T5 Explore dialogs** — S2 (dialog). Files: `plugins/explore/components/install-dialog.tsx`, `plugins/explore/components/consent-dialog.tsx`; RTL test `tests/plugins/explore/consent-dialog-bins.test.tsx` (act-disciplined, `rtl-settle`). Run `bun run ui:conformance --quick`. Size S.
- **T6 Install commit transaction** — S1b, S4, S13. Files: `packages/host/src/api/plugins/install/validate-manifest.ts` (preflight: platform + conflict, before consent), `commit.ts` (transaction with sentinel: bins stage, rollback of dir + created bins on any failure incl. ledger write); test `tests/host/plugins/install-bins.test.ts` (scripted fetch; injected failure on the 2nd bin; retry idempotent; ledger absent after failure; sentinel absent after commit). Size M.
- **T6b Plugin install and upgrade as install jobs** — S3. Files: `packages/host/src/api/plugins/install.ts`, `packages/host/src/api/plugins/upgrade.ts` (adopt `startInstallJob`, stages `stage`/`build`/`bins`/`ledger`, `plugins.install_*` events), `packages/host/src/api/install-jobs.ts` (generic over job kinds if not already), `plugins/explore/components/install-dialog.tsx` (same progress UI as packages); test `tests/host/plugins/install-job-progress.test.ts` asserting a `bins` stage event through the REST path. Size M.

**Checkpoint B (scoped to injected failures):** install a fixture plugin declaring a bin served by a local http server through the REST route on an isolated server (`verify` skill); consent lists the download; the job stream shows the `bins` stage; `~/.bakin/bin/<name>` + marker + `installedBins` present. Then an injected download failure on the second bin → no plugin dir, no created bin, no ledger entry. Process-termination recovery is Checkpoint C's business (sentinel + boot recovery, T7a). Review with Mark before Phase C.

### Phase C — Upgrade and remove

- **T7a Replace transaction with sentinel + boot recovery, adopted by install AND the three upgrade paths** — S14, crash recovery. Files: `src/core/plugins/replace-transaction.ts` (new: sentinel, backup, place, build, assets+bins, ledger, commit; restore on failure), `src/core/plugins/install-recovery.ts` (new: boot-time sweep before plugin discovery; loader skips sentinel dirs), `packages/host/src/api/plugins/install/commit.ts` (adopts it — explicit), `src/core/plugins/upgrade.ts`, `upgrade-github.ts`, `upgrade-artifact.ts`, `src/core/plugin-registry.ts` (skip sentinel dirs); tests: restore-on-failure for each path; recovery from on-disk states captured after the first bin, after replacement, after ledger commit (no real kill: the test snapshots the tree at each step and runs recovery). Size L, but one concern; kept as one commit for atomic revert.
- **T7b Upgrades install/drop bins + upgrade consent round-trip** — S7, S17 (upgrade). Files: `upgrade-gate.ts` (`installUpgradedPluginAssets` → bins, `diffNewBins`), `packages/host/src/api/plugins/upgrade.ts` (preview/commit + token bound to manifestSha/permissions/bins; `UpgradeOptions`/result contracts), `src/cli/commands/plugins.ts` + `consent-prompt.ts` (token round-trip; `--yes` = preview then commit), the Team/Explore upgrade caller(s) found at build time; tests `upgrade-decline.test.ts` (preview A → source becomes B → accept A re-prompts, no mutation), `upgrade-flow.integration.test.ts`. Size M.
- **T8 Remove sweep** — S6. Files: `packages/host/src/api/plugins/remove.ts`, `src/core/plugins/uninstall-snapshot.ts` (record bins in the snapshot manifest; bytes not archived — re-downloadable); test `tests/plugins/lifecycle/remove-smoke.test.ts`. Size S.

**Checkpoint C:** lifecycle suite green; upgrade a fixture plugin whose new manifest fails the second bin → old code, old bin bytes, old ledger intact; a sentinel-bearing dir left by a simulated termination is invisible to the loader and cleaned by boot recovery.

### Phase D — Readiness

- **T9 plugin-assets bins + doctor repair** — S5. Files: `src/core/onboarding/plugin-assets.ts` (bins in `ScanReport`/`InstallReport`, scan via predicate, install under lock, lockfile sync), `plugins/health/lib/system-checks/plugin-assets.ts` (resolution → `repair`, action `install-plugin-assets`), `plugins/health/index.ts` (register action); tests `tests/core/onboarding/plugin-assets.test.ts`, `tests/plugins/health/plugin-assets-repair.test.ts`. Size M.

**Checkpoint D (full gate):** `bun run test`, `bun run typecheck`, `bun run lint`, `bun run check:cycles`, `bun run docs:check`, and the FULL `bun run ui:conformance` (the consent dialog is browser UI). UI conformance references for T5: `storybook/public/overlays/dialog.stories.tsx — CanonicalUsage` and `storybook/public/feedback/alert.stories.tsx — CanonicalUsage`; contract is SDK `/ui` + `/patterns`, no extension expected; run the affected-plugin `test:ui` for explore and inspect its report.

### Phase E — Docs and the Bakin PR

- **T10 Knowledge + CHANGELOG** — `.claude/knowledge/plugin-system.md` (manifest field, lifecycle: transaction + rollback), `plugin-lifecycle.md` (§3.1 `installedBins`, remove rule), `capability-packs.md` (shared ownership + conflict policy, ONE schema), `CLAUDE.md` (Plugin System paragraph), `CHANGELOG.md` Unreleased. README.md: not impacted (no prerequisites section). Size S.
- Open the PR; Mark live-tests on 3737; merge; release rc.39 (workflow_dispatch).

### Phase F — Bits PR 1: mirror bootstrap

- **T11 `mirror-tmux.yml` + publish guard + RELEASE.md** — S10. Files: `.github/workflows/mirror-tmux.yml` (new: `macos-14` + `macos-15-intel` build legs each running the headless smoke, a package leg that `lipo`s, checks `otool -L`, signs ad-hoc, writes `BUILD.json` with `sizeBytes`, releases `mirror/tmux-v<v>` not-latest), `.github/workflows/publish.yml` (`tags: ['*-v*', '!mirror/**']`), `RELEASE.md` (§ binary mirrors), `test/publish-workflow.test.ts` (guard pinned). Merge to main, run for `3.7c`, verify the release and that `releases/latest` still serves the plugin catalog. Record sha + size.

### Phase G — Bits PR 2: Terminal 0.2.0

- **T12 Service resolution + migration** — S8, S16. Files: `plugins/terminal/lib/service.ts` (per-operation resolve; PATH order; migration policy reading the plist's program path), `plugins/terminal/lib/processes.ts` / `index.ts` (session-count input to migration), `plugins/terminal/tests/service.test.ts`. Size M.
- **T13 Manifest, page copy, README, contract test** — S9, S12. Files: `plugins/terminal/bakin-plugin.json` (0.2.0, floor rc.39, `requires.bins` with the real sha/size), `components/terminal-page.tsx`, `README.md`, `test/plugin-bins-contract.test.ts` (new), `plugins/terminal/tests/compatibility.test.ts`. Size M.
- **T13b Clean-machine acceptance gate (before the tag)** — S11. (1) A Bits workflow job `verify-tmux-mirror` on `macos-14` and `macos-15-intel`: fresh `HOME`, download the mirrored tarball by its sha, `tmux -V`, `otool -L` shows no `/opt/homebrew` or `/usr/local` library, start a detached server + create a window + capture-pane. (2) On the dev Mac: a fresh `BAKIN_HOME`, Homebrew removed from PATH for the session, install Terminal 0.2.0 from the packed artifact → consent shows the download → Set up service → a session opens (LaunchAgent needs a GUI login, so this is manual). Only then `terminal-v0.2.0` per RELEASE.md.

### Phase H — Acceptance

- **T14 margo** — Mark runs: upgrade to rc.39, `bakin plugins upgrade terminal` (consent shows the download), Set up service (migrates the Homebrew LaunchAgent with zero live sessions). I verify read-only: `~/.bakin/bin/tmux` + marker, `installedBins`, `bakin check plugin-assets` OK, LaunchAgent program path = managed tmux, a session opens.

## Commit strategy (rollback checkpoints)

One commit per task, conventional scope, every commit leaves tsc/lint/targeted tests green. **Rollback means reverting the dependent suffix back to a checkpoint**, newest first (e.g. to return to Checkpoint A revert 9…4 in reverse order); reverting a foundation commit alone (T1 after T2–T9) breaks its consumers and is never the move. The checkpoints are the rollback targets:

| # | Commit | Rollback meaning |
|---|---|---|
| 1 | `feat(plugins): shared bin-requirement schema; manifests declare requires.bins` (T1) | pure contract; nothing consumes it |
| 2 | `feat(plugins): bin verification predicate, cross-lockfile bin owners, installedBins` (T2) | helpers only |
| 2b | `refactor(install): ONE atomic install lock, acquired by the outer operation` (T2b) | packs and plugins return to separate locks |
| 3 | `feat(plugins): plugin bin installer; pack removal respects plugin owners` (T3) | pack behavior returns to pack-only ownership |
| 4 | `feat(plugins): binaries are part of install consent (gate + CLI)` (T4) | consent returns to permissions-only |
| 5 | `feat(explore): consent dialog discloses downloads` (T5) | UI-only revert |
| 6 | `feat(plugins): install commit is a transaction — preflight, bins stage, full rollback` (T6) | install returns to today's partial rollback |
| 6b | `feat(plugins): install and upgrade run as install jobs with staged progress` (T6b) | REST returns to synchronous responses |
| 7a | `refactor(plugins): ONE replace transaction (sentinel + boot recovery) behind install and the three upgrade paths` | riskiest commit — isolated on purpose; revert restores per-path sequences |
| 7b | `feat(plugins): upgrades install/drop bins; upgrade consent is a token-bound preview/commit` | |
| 8 | `feat(plugins): remove deletes owned bins with zero remaining owners` (T8) | |
| 9 | `feat(health): plugin-assets covers binaries; one-click install-plugin-assets repair` (T9) | doctor returns to instructions-only |
| 10 | `docs: plugin-managed binaries` (T10) | |
| Bits 1 | `ci(mirror): reproducible tmux mirror build (arm64 + intel, universal); publish ignores mirror/ tags` (T11) | |
| Bits 2c | `ci(terminal): clean-machine verification of the mirrored tmux on both architectures` (T13b) | |
| Bits 2a | `fix(terminal): resolve tmux per operation, Bakin bin first; migrate old LaunchAgents safely` (T12) | |
| Bits 2b | `feat(terminal): 0.2.0 — Bakin installs tmux (requires.bins); repair-first copy` (T13) | |

Squash on merge is fine for the Bakin PR (the checkpoints exist in the PR history for review); Bits PRs are small enough to merge as-is.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Static ncurses on macOS: terminfo lookup or wide-char breaks inside tmux | High (unusable binary) | Workflow runs `tmux -V` AND a headless smoke: start a detached server, create a window, capture-pane; build ncurses with `--with-terminfo-dirs=/usr/share/terminfo:/opt/homebrew/share/terminfo --enable-widec` |
| No x64 runner image / lipo mismatch | Med | Cross-build the x64 slice on the arm64 runner (`-arch x86_64`), lipo, `file` asserts both slices; BUILD.json records the method |
| `replace-transaction` regresses an upgrade path | High | 7a is its own commit; existing lifecycle tests run against it before 7b; live upgrade of a fixture on the isolated server at Checkpoint C |
| Consent token payload change | Low (single user) | New field; tokens are minutes-lived; no compat path by decision |
| Repair runs while an install holds the lock | Low | Repair surfaces the lock holder's message; doctor re-runs later |
| Pin conflict blocks a legitimate upgrade (two owners share pin A, one wants B) | Low today (no pack pins tmux) | Error names both owners AND the recovery sequence: remove the owner that is not upgrading, upgrade, reinstall it (or upgrade both to a shared pin). Documented in plugin-lifecycle.md; there is no automatic re-pin. |
| Repair or install runs in two processes at once | Med | ONE O_EXCL lock; the second process is refused naming the holder's pid; contention test |
| GitHub `workflow_dispatch` needs the workflow on main first | Med (sequencing) | Bits PR 1 merges before the run (review point 6) |

## Open questions

None blocking. Deferred: Linux builds; Explore card requirement line; a "prerequisite" concept for tools Bakin cannot mirror.
