# TODO — Plugin-managed binaries (spec v2, plan `tasks/plan-plugin-managed-binaries.md`)

## Phase A — Foundation (Bakin)
- [ ] T1: Shared `bin-requirement.ts`; plugin manifest parses `requires.bins`; SDK `PluginManifest.requires`; docs `manifest.md`
  - Acceptance: S1 (valid parses; bad sha / http url / traversal member / unknown platform key rejected naming the field); pack manifest imports the shared schema; `sizeBytes` optional.
  - Verify: `bun test tests/core/plugins/manifest-requires-bins.test.ts tests/core/agent-packages --isolate`; `bun run docs:check`
- [ ] T2: `bin-verify.ts` predicate; `bin-owners.ts` (owners over both lockfiles + conflict assertion); lockfile `installedBins`
  - Acceptance: raw file hash ≠ pin ⇒ not installed; archive: marker pin + extracted hash; bytes-changed regression; identical pins share; different pins conflict with both owners named.
  - Verify: `bun test tests/core/agent-packages/bin-verify.test.ts tests/core/plugins/bin-owners.test.ts --isolate`
- [ ] T2b: ONE atomic install lock (`~/.bakin/install.lock`, O_EXCL, stale reclaim, `assertLockHeld`); packs/plugins/repair acquire it as the OUTER operation; private lock paths retired
  - Verify: `bun test tests/core/install-core/install-lock.test.ts --isolate` (incl. two-process contention)
- [ ] T3: `installPluginBins` (marker `plugin:<id>`, `bins` progress stage, no skill-pack gate); conflict + lock assertions inside `installManifestBins` so installer/updater/sync are all covered; pack uninstall keeps files a plugin still owns
  - Verify: conflict test per pack writer (install, update, sync)
  - Verify: `bun test tests/core/agent-packages --isolate`
- [ ] Checkpoint A: tsc, lint, targeted tests green

## Phase B — Install path
- [ ] T4: consent gate binds bins (zero-permission manifests need consent; changed declaration bounces); CLI install/upgrade prompts print the download disclosure; `--yes` accepts
  - Verify: `bun test tests/host/plugins/consent-gate-bins.test.ts tests/plugins/lifecycle/consent-prompt-smoke.test.ts --isolate`
- [ ] T5: Explore `install-dialog` passes bins; `consent-dialog` Downloads section (name · version · size · target)
  - Verify: RTL test; `bun run ui:conformance --quick`
- [ ] T6: install commit transaction — preflight (platform + conflict) before consent; bins stage; sentinel; rollback removes dir + created bins on any failure incl. ledger write
  - Verify: `bun test tests/host/plugins/install-bins.test.ts --isolate` (2nd-bin failure, retry idempotent, ledger absent, sentinel gone after commit)
- [x] T6b: plugin install + upgrade run as install jobs (`startInstallJob`, stages stage/build/bins/ledger, `plugins.install_*` events); Explore install dialog uses the packages progress UI
  - Verify: REST-path test observes a `bins` stage event
- [x] Checkpoint B (injected failures only): isolated-server install of a fixture plugin (local http bin) — consent shows download; job stream shows `bins`; artifacts present; injected 2nd-bin failure leaves nothing. Review with Mark.

## Phase C — Upgrade and remove
- [x] T7a: `replace-transaction.ts` (sentinel → backup → place → build → assets+bins → ledger → commit; restore on failure) + `install-recovery.ts` (boot sweep before discovery; loader skips sentinel dirs) adopted by install `commit.ts` AND `upgrade.ts`, `upgrade-github.ts`, `upgrade-artifact.ts`
  - Verify: existing lifecycle tests + restore-on-failure per path + recovery from trees captured after 1st bin / after replacement / after ledger commit
- [x] T7b: upgrades install changed bins, drop undeclared ones (zero-owner rule); upgrade API is preview → token (manifestSha + permissions + bins) → commit; CLI/UI callers round-trip the token; `--yes` = preview then commit
  - Verify: preview A → source becomes B → accept A re-prompts with no mutation; `tests/plugins/lifecycle/upgrade-*.test.ts`
- [x] T8: remove deletes owned bins with zero remaining owners; audit `plugin.uninstall.bins`; snapshot manifest lists bins
  - Verify: `bun test tests/plugins/lifecycle/remove-smoke.test.ts --isolate`
- [x] Checkpoint C: lifecycle suite green; failed fixture upgrade restores everything; simulated-termination dir is invisible to the loader and cleaned at boot

## Phase D — Readiness
- [x] T9: plugin-assets scans/installs bins via the predicate + installer under the lock; CLI output; health check resolution becomes a `repair`; `install-plugin-assets` action registered
  - Verify: `bun test tests/core/onboarding/plugin-assets.test.ts tests/plugins/health --isolate`
- [ ] Checkpoint D: `bun run test`, typecheck, lint, check:cycles, docs:check, FULL `bun run ui:conformance`; explore `test:ui` report inspected (stories: overlays/dialog CanonicalUsage, feedback/alert CanonicalUsage)

## Phase E — Docs + PR
- [x] T10: knowledge docs (plugin-system, plugin-lifecycle, capability-packs), CLAUDE.md, CHANGELOG
- [ ] Bakin PR → Mark live test on 3737 → merge → rc.39

## Phase F — Bits PR 1 (bootstrap)
- [ ] T11: `mirror-tmux.yml` (`macos-14` + `macos-15-intel` slices each smoke-tested, lipo, `otool -L` no Homebrew libs, ad-hoc sign, `BUILD.json` with sizeBytes, `mirror/tmux-v<v>` not latest); `publish.yml` `!mirror/**`; RELEASE.md; workflow test
- [ ] Merge → run for 3.7c → verify S10 → record sha + sizeBytes

## Phase G — Bits PR 2 (Terminal 0.2.0)
- [ ] T12: service resolves per operation, `~/.bakin/bin` first; LaunchAgent migration (zero sessions: swap; live sessions: refuse with count)
  - Verify: `plugins/terminal/tests/service.test.ts`
- [ ] T13: manifest 0.2.0 + floor + `requires.bins` (real sha/size); page copy; README; `test/plugin-bins-contract.test.ts`; compatibility test
  - Verify: `bun run typecheck && bun run test && bun run lint` (Bits)
- [ ] T13b: clean-machine gate — Bits `verify-tmux-mirror` job on both architectures (fresh HOME, sha-verified download, `tmux -V`, `otool -L`, detached-server smoke); dev Mac fresh `BAKIN_HOME` with Homebrew off PATH: install Terminal 0.2.0 → consent → Set up service → session opens
- [ ] `terminal-v0.2.0` tag → publish run green → catalog verified

## Phase H — Acceptance
- [ ] T14: margo — rc.39, `bakin plugins upgrade terminal`, Set up service; read-only verification of bin, marker, ledger, doctor, LaunchAgent path, live session
