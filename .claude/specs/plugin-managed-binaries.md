# Spec — Plugin-managed binaries: Bakin installs tmux for the Terminal plugin

**Status:** DRAFT v2 (first review folded in: rollback, pin conflicts, service migration, consent callers, readiness predicate, Bits sequencing) — awaiting approval, then `/agent-skills:plan` (with commit strategy), `/agent-skills:build`, `/agent-skills:test`.
**Origin:** 2026-09-24 on margo — the Terminal plugin's page said "Install tmux with Homebrew before setting up Terminal." A non-technical operator has no Homebrew and no reason to learn it.
**Decisions (interview 2026-09-24):** D1 binaries are part of install consent · D2 readiness rides the existing `plugin-assets` component + doctor check, which gains a one-click repair · D3 always install the managed binary, resolve it first, a system binary is only the fallback · D4 Explore's card is unchanged; the consent dialog is the disclosure · D5 reproducible `workflow_dispatch` mirror build in Bits under `mirror/` tags · D6 the Terminal page points at Bakin's own repair · D7 a failed binary download fails the plugin install.
**Repos:** `markhayden/bakin` (core contract, installer, consent, readiness, docs) and `markhayden/bakin-bits-official` (tmux mirror workflow, Terminal 0.2.0).

---

## 1. Objective

A plugin can declare the binaries it needs, and Bakin owns their whole life: disclosed at install, downloaded and sha256-verified into `~/.bakin/bin`, recorded in the plugin lockfile, checked by the doctor with a one-click repair, removed with the plugin unless another owner still pins them. The first consumer is the Terminal plugin, whose tmux dependency currently ends at a banner telling the user to install Homebrew.

**Who:** the single operator, assumed non-technical. **Not** a shim layer: the Terminal plugin requires the Bakin release that understands the new manifest field; older hosts are refused by the compatibility gate.

### 1.1 Success criteria (testable)

| # | Criterion | Verified by |
|---|---|---|
| S1 | A `bakin-plugin.json` with `requires.bins` parses; a malformed entry (bad sha, http url, traversal member) is rejected with the field named. | unit: manifest parser |
| S1b | A bin with no build for the running platform fails at preflight — before consent and before any file or ledger mutation. | unit: preflight |
| S2 | Installing such a plugin shows the binary in the consent dialog (name, version, size hint, target dir) and the consent token binds the declared bins; changing a bin on upgrade re-asks. | unit: consent-gate; RTL: consent dialog |
| S3 | Install downloads through `installBinRequirement`, writes `~/.bakin/bin/<name>` + `.installedBy` (`package: "plugin:<id>"`), records `installedBins` in the plugin lockfile, and reports a `bins` stage in live install progress. | unit: install commit with a scripted fetch; progress events |
| S4 | A failed download aborts the install; nothing is written to the lockfile; retrying succeeds and skips already-pinned files. | unit: install commit |
| S5 | `bakin check plugin-assets` reports a missing or sha-drifted plugin binary; `bakin install plugin-assets` and the doctor's `install-plugin-assets` repair reinstall it; a healthy state reads "installed". | unit: plugin-assets component; health check + repair |
| S6 | Removing the plugin deletes its binaries unless a pack or another plugin still pins the same target; removing a pack likewise respects plugin ownership. | unit: remove sweep + pack uninstaller, both lockfiles |
| S7 | Upgrading a plugin that changes a bin's sha re-downloads; one that drops a bin removes it (S6 rule). | unit: upgrade-gate |
| S8 | The Terminal service resolves tmux from `~/.bakin/bin` before any other PATH entry; the LaunchAgent is written with that absolute path. | unit (Bits): terminal service |
| S9 | The Terminal page's not-ready state names Bakin's repair (Health → plugin assets, or `bakin install plugin-assets`) with a manual-install last line; no Homebrew instruction. | RTL (Bits): terminal page |
| S10 | The Bits mirror workflow, given `3.7c`, produces `tmux-3.7c-darwin-arm64.tar.gz` + `.sha256` + `LICENSE` + `BUILD.json`, ad-hoc signed, `tmux -V` passing, released under `mirror/tmux-v3.7c` and NOT marked latest; the plugin publish workflow does not run for that tag. | workflow run + `gh release view`; `releases/latest/download/whiskit-artifacts.json` still resolves |
| S11 | Terminal 0.2.0 declares the mirrored tmux with the real sha; on a fresh Mac with no Homebrew, install → consent → Set up service works with zero manual steps. | live: dev box or margo after upgrade |
| S12 | Bits contract test: every plugin `requires.bins` entry has an https URL, a 64-hex sha256, and a `mirror/` release URL when hosted in Bits. | unit (Bits) |
| S13 | A failed install (download error on the 2nd bin, or a build error after bins landed) leaves no plugin directory, no bin this install created, and no ledger entry. | unit: install commit |
| S14 | A failed upgrade restores the previous plugin directory, binaries, markers and ledger entry byte for byte. | unit: upgrade paths |
| S15 | A pin conflict (same bin name, different sha across a pack and a plugin) is refused at preflight with both owners named; identical pins share one file and both owners survive the other's removal. | unit: bin-owners + both installers |
| S16 | The Terminal service picks up a repaired binary without a restart, migrates an old-path LaunchAgent when no sessions are live, and refuses the migration with the live-session count otherwise. | unit (Bits) |
| S17 | Consent is required for a binary-only manifest with zero permissions; the CLI prints the download disclosure on install and upgrade; a declaration changed between preview and commit bounces to consent. | unit: consent-gate, CLI |

## 2. Contracts

### 2.1 `bakin-plugin.json` — `requires.bins`

Same schema as capability packs (`packages/core/src/agent-packages/manifest.ts` `BinRequirementSchema`), moved to a shared module both manifests import so there is ONE definition:

```json
"requires": {
  "bins": [{
    "name": "tmux",
    "version": "3.7c",
    "install": {
      "darwin-arm64": {
        "url": "https://github.com/markhayden/bakin-bits-official/releases/download/mirror/tmux-v3.7c/tmux-3.7c-darwin-arm64.tar.gz",
        "sha256": "<64 hex>",
        "archive": { "format": "tar.gz", "member": "tmux" }
      }
    },
    "verifyArgs": ["-V"]
  }]
}
```

- Parsed by the hand-written plugin manifest parser via the shared zod schema; errors are `PluginManifestError` naming the entry.
- A declared bin with no build for the running platform fails the install at **preflight, before consent and before any mutation** ("tmux has no build for linux-x64"). Note the Terminal plugin's `bakin` floor gates the HOST VERSION only; its macOS check happens at service setup, so this preflight is the first platform gate an installer hits. Intel Macs are therefore in scope: the mirror ships a universal macOS binary (§2.9) mapped to both `darwin-arm64` and `darwin-x64`, exactly as the ocrit pack does.
- Each platform download may carry an optional `sizeBytes` (the mirror workflow records it; the consent dialog shows it when present — that is the size hint's source).
- `PluginManifest` (SDK type) gains `requires?: { bins?: BinRequirement[] }`; docs `manifest.md` documents it.

### 2.2 Plugin lockfile — `installedBins`

`PluginLockEntry` gains `installedBins?: Array<{ name: string; sha256: string }>` (pinned sha, i.e. the archive/download sha the marker records). Authority for removal, like `installedSkills`. Written by install commit and by `installUpgradedPluginAssets`.

### 2.3 Marker identity

`~/.bakin/bin/<name>.installedBy` uses the existing `InstalledByMarker` with `package: "plugin:<id>"`, `version: <plugin version>`, `ref`/`commitSha` from the plugin's provenance (empty for local/artifact installs, as today), `sha256` = pinned download sha, `extractedSha256` for archives.

### 2.4 Shared ownership: one target, one pin

Both installers write `~/.bakin/bin/<name>`, so ownership is a contract, not a deletion rule:

- **Identical pins share.** A pack and a plugin declaring the same `name` with the same `sha256` (and, for archives, the same member) both own the target; either install is a no-op on the file and adds its owner.
- **Conflicting pins are rejected before mutation.** If any current owner pins a different sha, the install/upgrade/repair fails at preflight with both owners named ("tmux is pinned at sha A by pack `ocr`; `terminal` declares sha B"). Nothing is overwritten, so repairs can never alternate versions.
- **Deletion needs zero owners.** Removing a pack or a plugin deletes the file only when `binTargetOwners(target)` (reads BOTH lockfiles) is empty afterwards.
- **Serialized.** The ownership check and the write run under the existing install lock (`src/core/install-core/install-lock`), which plugin install/upgrade/remove acquire the same way pack install/uninstall already do; the plugin-assets repair acquires it too.

`src/core/plugins/bin-owners.ts` owns the helper and the conflict check; both installers call it.

### 2.5 Consent (D1) — through every caller

- **Gate:** `consent-gate.ts` binds `bins: [{ name, version, sha256 }]` into the token alongside permissions. A manifest that declares bins requires consent **even with zero permissions**; a declaration that differs between preview and commit bounces to `awaitingConsent` with a fresh token, exactly like permissions. `upgrade-gate.ts` treats an added or changed bin as a widening.
- **Response shape:** `awaitingConsent` responses carry `bins` next to `permissions`.
- **Explore:** `install-dialog.tsx` (which constructs the `ConsentRequest` from that response) passes `bins`; `consent-dialog.tsx` renders a "Downloads" section: `tmux 3.7c · 2.1 MB · sha256-pinned · into ~/.bakin/bin` (size omitted when the manifest has none).
- **CLI:** `bakin plugins install`/`upgrade` print the same disclosure through `src/core/cli/consent-prompt` before the prompt; `--yes` accepts it as it accepts permissions today, and the refusal message names the binaries.
- Tests: binary-only consent with zero permissions; CLI install and upgrade disclosure; changed declaration between preview and commit.

### 2.6 Install / upgrade / remove — atomic from the operator's view

- **Preflight (no mutation):** platform build present for every bin; no conflicting owner (§2.4); consent satisfied (§2.5).
- **Install commit** (`commit.ts`): stage → build → `installPluginBins` (per-bin download with `stage: 'bins'` progress) → lockfile write. **Any failure before the lockfile write removes the staged plugin directory and every bin this install created** (a bin that was already pinned identically by another owner is left alone), so a failed install leaves nothing the loader can discover at the next boot. Tests: failure on the SECOND of two bins; ledger has no entry; retry succeeds and skips the first bin.
- **Upgrade** (`upgrade.ts`, `upgrade-github.ts`, `upgrade-artifact.ts` → `installUpgradedPluginAssets`): the previous plugin directory, its bins and their markers are moved to a staging backup before the new code lands; bins for the new manifest install; the lockfile is written last. **Any failure restores the backup — previous code, binaries, markers and ledger entry all intact.** Bins the new manifest dropped are deleted only after the lockfile write and only with zero remaining owners. Tests: failure after the new code is in place restores the old plugin dir and old bin bytes; ledger unchanged.
- **Remove** (`remove.ts`): after skills, delete owned bins with zero remaining owners; audit `plugin.uninstall.bins`.
- `installManifestBins` loses its `kind === 'skill-pack'` gate; pack and plugin callers pass their own installer identity.

### 2.7 Readiness (D2)

`src/core/onboarding/plugin-assets.ts` scans bins as well as skills using the **installer's own verification predicate**, extracted from `installBinRequirement` into one exported function so the two can never disagree: a raw download is `installed` when the file's hash equals the pinned sha; an archive download when the marker's pin matches the manifest AND the file's hash equals the marker's `extractedSha256`. Anything else present is `drifted`; absent is `missing`. Regression: a binary whose bytes change with an untouched marker reports `drifted`. `install()` reinstalls missing/drifted through the bin installer. The report gains a `bins` section; the CLI output names them. The doctor's `plugin-assets` check gains repair action `install-plugin-assets` (deterministic: calls the component's `install()`), which fixes skills and bins alike.

### 2.8 Terminal plugin (Bits, D3/D6) — resolution, repair, migration

- **Resolution:** `terminalEnvironment().PATH` = `~/.bakin/bin`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, inherited PATH. `TerminalService` resolves tmux **per operation, not at construction** (today it caches `Bun.which` in the constructor, so a repair could never be picked up without a restart).
- **Migration policy:** `install()` no longer returns early just because a service is ready. It reads the existing LaunchAgent's program path; if it differs from the currently resolved tmux (an old Homebrew service, or a managed binary that moved), it migrates: with **no active sessions** it boots the old agent out, rewrites the plist with the new absolute path and boots it in; with **active sessions** it leaves the running service alone and reports "Terminal is running Homebrew's tmux; N live sessions. End them and press Set up service again to switch to Bakin's tmux." — never a silent restart that kills someone's shell. The page shows that state.
- **Not-ready copy (D6):** "Terminal needs tmux, which Bakin installs with this plugin. Open Health and run the plugin assets repair, or run `bakin install plugin-assets`. If this machine can't download it, install tmux manually and Bakin will use it."
- **Manifest:** version `0.2.0`, `bakin` floor = the Bakin release shipping this feature, `requires.bins` per §2.1.
- Tests (Bits): repair after a deleted binary is picked up without restart; migration with zero sessions rewrites the plist; migration with a live session is refused with the count.

### 2.9 Mirror build (Bits, D5)

`.github/workflows/mirror-tmux.yml`, `workflow_dispatch` input `version` (e.g. `3.7c`), two build legs (`macos-14` arm64, `macos-13` x64) plus a package leg:
1. Download `https://github.com/tmux/tmux/releases/download/<v>/tmux-<v>.tar.gz`; verify against a sha recorded in the workflow (bumped per version).
2. Build static libevent, ncurses (`--with-terminfo-dirs=/usr/share/terminfo:/opt/homebrew/share/terminfo`, wide-char) and utf8proc into a prefix; configure tmux `--enable-utf8proc` against them; `strip`; `codesign -s -` (ad-hoc); `./tmux -V` must print `tmux <v>`.
3. `lipo -create` the two slices into one universal binary; package `tmux-<v>-macos-universal.tar.gz` (`tmux`, `LICENSE` (ISC), `BUILD.json` {version, sourceSha256, runner images, flags, libevent/ncurses/utf8proc versions, archive sizeBytes}); emit `.sha256`. Both `darwin-arm64` and `darwin-x64` manifest keys point at this one asset (ocrit precedent).
4. `gh release create mirror/tmux-v<v> --latest=false --title "tmux <v> (binary mirror)"` with the notes naming the source and license. Refuses if the tag exists.
Guard: `publish.yml` gains a tag-filter exclusion for `mirror/**` (belt and braces; `*-v*` already does not match a `/`).

## 3. Tech stack

Bun 1.3.13, TypeScript strict, zod at boundaries, React 19 for the consent dialog (SDK `ui`/`patterns` kit only — `bakin-ui-conformance` applies to the dialog change), GitHub Actions macOS arm64 runner for the mirror.

## 4. Commands

```
Bakin:  bun run typecheck · bun run lint · bun run check:cycles · bun run test
        bun test tests/core/plugins tests/core/onboarding tests/plugins/explore tests/plugins/health --isolate
        bun run ui:conformance --quick        # consent dialog change
        bun run docs:check                    # manifest.md
Bits:   bun run typecheck && bun run test && bun run lint
        gh workflow run mirror-tmux.yml -f version=3.7c
        git tag -a terminal-v0.2.0 -m "…" && git push origin terminal-v0.2.0   (one tag at a time, RELEASE.md)
```

## 5. Project structure (files touched)

```
Bakin
  packages/core/src/plugins/bin-requirement.ts        NEW — shared BinRequirementSchema (+ platform keys), imported by both manifests
  packages/core/src/agent-packages/manifest.ts        import the shared schema
  packages/core/src/plugins/manifest.ts               parse `requires.bins`
  packages/sdk/src/types/manifest.ts                  PluginManifest.requires
  packages/core/src/plugins/lockfile.ts               installedBins
  src/core/agent-packages/bin-verify.ts               NEW — the ONE installed-binary verification predicate (installer + readiness)
  src/core/agent-packages/bin-installer.ts            drop the skill-pack gate; installPluginBins
  src/core/plugins/bin-owners.ts                      NEW — binTargetOwners() over both lockfiles
  src/core/agent-packages/uninstaller.ts              shared rule consults plugin owners
  packages/host/src/api/plugins/install/consent-gate.ts, commit.ts, validate-manifest.ts
  src/core/plugins/upgrade-gate.ts, upgrade-artifact.ts, upgrade-github.ts (call sites)
  packages/host/src/api/plugins/remove.ts
  src/core/onboarding/plugin-assets.ts                bins scan/install
  plugins/health/lib/system-checks/plugin-assets.ts   + install-plugin-assets repair; plugins/health/index.ts registration
  plugins/explore/components/consent-dialog.tsx       Downloads section
  plugins/explore/components/install-dialog.tsx       passes bins into ConsentRequest
  src/cli/commands/plugins.ts, src/core/cli/consent-prompt.ts   CLI disclosure on install/upgrade
  src/core/install-core/install-lock.ts (reuse)       serialization for plugin bin mutations
  docs/src/content/docs/extending/plugins/manifest.md
  .claude/knowledge/{plugin-system,plugin-lifecycle,capability-packs}.md, CLAUDE.md, CHANGELOG.md
  tests/…                                             see §7
Bits
  .github/workflows/mirror-tmux.yml                   NEW
  .github/workflows/publish.yml                       mirror/** exclusion
  plugins/terminal/{bakin-plugin.json,lib/service.ts,components/terminal-page.tsx,README.md,tests/}
  test/ (contract test for plugin requires.bins)      RELEASE.md § binary mirrors
```

## 6. Code style

Follow the existing installer: pure helpers, explicit errors naming the artifact, atomic commit, honest logs.

```ts
/** Every owner still pinning a bin target — packs (lock projections) and plugins (installedBins). */
export function binTargetOwners(target: string): BinOwner[] {
  const owners: BinOwner[] = []
  for (const [key, entry] of Object.entries(readPackageLockfile().packages)) {
    if (entry.projections?.some((p) => p.kind === 'bin' && p.target === target)) owners.push({ kind: 'package', id: key })
  }
  for (const [id, entry] of Object.entries(readPluginLockfile().plugins)) {
    if (entry.installedBins?.some((b) => join(getBakinPaths().bin, b.name) === target)) owners.push({ kind: 'plugin', id })
  }
  return owners
}
```

## 7. Testing strategy

bun test, `--isolate`, content-dir + OpenClaw home mocks in every fs test, scripted `fetch` for downloads (existing bin-installer test pattern), no network.

- `tests/core/plugins/manifest-requires-bins.test.ts` — S1.
- `tests/host/plugins/install-bins.test.ts` — S2 (token binding), S3, S4 (download failure leaves no lockfile entry, retry idempotent).
- `tests/core/plugins/bin-owners.test.ts` + extend `tests/plugins/lifecycle/*` — S6, S7.
- `tests/core/onboarding/plugin-assets.test.ts` — S5 (missing/drifted/installed, install path), `tests/plugins/health/*` — repair action.
- `tests/plugins/explore/consent-dialog.test.tsx` (RTL, act-disciplined) — S2 dialog.
- Bits: `plugins/terminal/tests/service.test.ts` — S8; terminal page RTL — S9; `test/plugin-bins-contract.test.ts` — S12.
- Live: S10 by running the workflow; S11 on the dev box (fresh `BAKIN_HOME` via the `verify` skill is NOT enough — the LaunchAgent needs a real GUI session, so this is a manual check on the dev Mac, then margo after the release).

## 8. Boundaries

- **Always:** reuse the bin installer and the shared downloader (never a fourth download path); keep ONE bin schema; mock content-dir in every fs test; run lint + typecheck + `check:cycles` before pushing; bump the Terminal plugin version and its Bakin floor in the same Bits PR; push Bits tags one at a time.
- **Ask first:** changing the consent token format beyond adding `bins`; any new CLI verb; marking a mirror release latest; touching margo (read-only until Mark says so).
- **Never:** install Homebrew or write outside `~/.bakin/bin`; mirror binaries whose license forbids redistribution (tmux is ISC); silently skip a declared bin; keep a compatibility path for hosts that predate `requires.bins`.

## 9. Sequencing across repos

1. **Bakin PR** (everything in §5 Bakin). Release rc.39.
2. **Bits PR 1 — bootstrap:** `mirror-tmux.yml` + the `publish.yml` `mirror/**` guard + RELEASE.md § binary mirrors. Merge to main first: GitHub only dispatches a `workflow_dispatch` workflow that exists on the default branch.
3. Run `mirror-tmux.yml` for 3.7c → verify the release (S10) → take the asset sha and size.
4. **Bits PR 2 — Terminal 0.2.0:** manifest with the real sha/size, service resolution + migration, page copy, contract test, README. Then `terminal-v0.2.0` tag.
5. **margo:** upgrade to rc.39, `bakin plugins upgrade terminal` (consent shows the download), Set up service migrates the Homebrew LaunchAgent when no sessions are live. Homebrew tmux becomes unused.

## 10. Open questions

None blocking. Deferred, not in scope: Linux/darwin-x64 builds (Terminal is macOS-only); showing requirements on Explore cards (D4); a generic "prerequisites" concept for tools Bakin cannot mirror (the pack `help`-link pattern stays for those).
