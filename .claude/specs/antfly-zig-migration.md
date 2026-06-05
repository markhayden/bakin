# Antfly Zig Migration — Spec

**Status:** Draft — pending approval
**Date:** 2026-06-05
**Owner:** Mark Hayden
**Related:** `.claude/knowledge/search-system.md`, `.claude/knowledge/adapter-architecture.md`, `packages/adapter-antfly/`

## 1. Objective

Replace the Homebrew-based Antfly install with direct binary download of the new Zig-based Antfly **v0.2.0-rc.2**, and upgrade `packages/adapter-antfly` to speak the new server protocol. Kill the brew/xcode onboarding failure mode entirely. No backwards compatibility — the old path is ripped out, with consented cleanup of legacy state.

**Target user:** a Bakin operator running `bakin onboard` on a fresh or previously-onboarded machine (macOS arm64, Linux x64/arm64). Search remains **optional** — declining or failing the install leaves Bakin fully functional in file-only mode (unchanged contract).

**Success =** `bakin onboard` installs Antfly with zero external toolchain (no brew, no xcode, no node, no python, no sudo), `bakin start` boots the new server, indexing + query + rerank + facets behave at parity, doctor is green, and all legacy v0.1.x state is detected and cleaned with consent.

## 2. Decisions (locked via interview, 2026-06-05)

| # | Decision | Choice |
|---|---|---|
| 1 | Distribution | **Direct tarball download by Bakin** from `releases.antfly.io`, SHA256-verified against published checksums. No npm/pipx/brew/install.sh. |
| 2 | Binary home | **`~/.antfly/bin/antfly`** (all Antfly artifacts under one root). `check()` validates `antfly --version` against the pin — wrong version ⇒ remediation "re-run `bakin install search`". `ANTFLY_PATH` env override kept. |
| 3 | SDK source | Mark asks Antfly devs to **publish new `@antfly/sdk` under `next`**; meanwhile we **vendor a locally-built tarball** from the `v0.2.0-rc.2` tag (`file:` dep). Swap to published version when live. |
| 4 | Legacy state | Installer **detects + offers optional, consented disk-reclaim**: old `~/.antfly/data` and `~/.termite/` are no longer used by Bakin at all (see decision 10) — deletion is housekeeping, not a prerequisite, default No, with an ALL-antfly-data warning. Stale default settings URLs auto-corrected (only when matching known old defaults — a deliberate non-default URL is never rewritten). Brew binary gets a printed `brew uninstall antfly` suggestion only. |
| 5 | Models | **Keep explicit `search-models` onboarding step** using `antfly inference pull`; verify at `~/.antfly/inference/models/`. Lazy HuggingFace download remains a natural fallback if skipped. |
| 6 | Version policy | **Pin `v0.2.0-rc.2` now.** Single constant (version + 3 platform SHA256s). Re-running `bakin install search` is the upgrade path. |
| 7 | Scope | **Parity + two quick wins** (below). No rerank-path rework. Other v0.2.0 features → §10 Future opportunities. |
| 8 | Quick wins | (a) **`/antfly/readyz`** + richer health detail in `antfly.availability`; (b) **models-missing = degraded** (search works, lazy-download on first use) instead of hard "missing". |
| 9 | File decomposition | Long adapter files touched by this work get split: `search.ts` via pure-move refactor first; `setup.ts` rewritten into `pin.ts`/`installer.ts`/`models.ts`/`legacy-cleanup.ts` with `setup.ts` as thin composition layer; `server.ts` log rules → `server-logs.ts`. Refactors and behavior changes never share a commit. `cli/bakin.ts` (4,675 lines, untouched here) = standalone follow-up. |
| 10 | **Private instance** | Bakin runs its **own antfly instance**: `--data-dir ~/.bakin/antfly/`, bound `127.0.0.1:3738` (health `3739`). Models stay shared at `~/.antfly/inference/models` (immutable artifacts). Binary stays at `~/.antfly/bin` (decision 2). A user's own antfly keeps `~/.antfly/data` + port 8080 — zero collision by construction. External/shared server = explicit opt-in by pointing `settings.url` elsewhere; in guest mode Bakin never spawns, never touches disk, and only owns `bakin_*` tables (API-level cleanup tooling documented, deferred). Future antfly upgrades and Bakin uninstall only ever touch Bakin-owned dirs. |

## 3. Background — what changed in Antfly v0.2.0

Verified against the Antfly source repo (`/Users/markhayden/go/src/github.com/antfly/antfly`, tag `v0.2.0-rc.2`):

- **Runtime:** complete Go→Zig rewrite. Single binary. Inference (ONNX Runtime) is **embedded in-process** in `antfly swarm` — no second process to supervise.
- **API paths:** `/api/v1/*` → `/db/v1/*` (database), `/ai/v1/*` (inference), `/auth/v1/*` (auth). Health: `GET /antfly/readyz`. Metrics: port 4200.
- **Spawn surface:** `antfly swarm --host 127.0.0.1 --port 8080 --data-dir <dir> --models-dir <dir> --health-port 4200`. The old `--metadata-api` flag and `ANTFLY_DATA_DIR` env are **gone**. Default bind is `127.0.0.1` (old: `0.0.0.0`).
- **Models:** `antfly termite pull` → `antfly inference pull <model-ref>`; storage `~/.termite/models/` → `~/.antfly/inference/models/{owner}/{name}/`; per-model `model_manifest.json`. Lazy download on first inference request. Same 3 models remain correct: `BAAI/bge-small-en-v1.5`, `openai/clip-vit-base-patch32`, `mixedbread-ai/mxbai-rerank-base-v1`.
- **Artifacts:** `https://releases.antfly.io/antfly/v0.2.0-rc.2/antfly_0.2.0-rc.2_{Darwin_arm64|Linux_x86_64|Linux_arm64}.tar.gz` + `antfly_zig_checksums.txt` (verified live). Tarball layout: `antfly/antfly` binary + `share/` + docs. Platform set exactly matches Bakin's build matrix. `latest/metadata.json` is stale (points at v0.1.1) — pin tags explicitly.
- **SDK:** in-repo `@antfly/sdk` targets `/db/v1` and adds an inference client (`embed`/`rerank`/`generate` via `/ai/v1`), but is **unpublished** (npm `latest` = old-protocol 0.0.14; package.json not yet bumped). `@antfly/cli@0.2.0-rc.2` *is* on the `next` dist-tag.
- **Data formats:** v0.1.x `~/.antfly/data` is **incompatible**. No migration tooling. Bakin's index is derived data — rebuild via `bakin reindex`.
- **License:** server ELv2 (download-to-user-machine is fine; we are not redistributing), SDK Apache-2.0.
- **Not relevant:** `go/pkg/operator/v0.0.17-rc.2` is the Kubernetes operator — Bakin doesn't use it.

## 4. Requirements

### 4.1 Installer (`packages/adapter-antfly/src/setup.ts` — rewrite)

- `ANTFLY_PIN` constant: `{ version: '0.2.0-rc.2', checksums: { 'darwin-arm64': '1eb09c…', 'linux-x64': 'f9c671…', 'linux-arm64': 'cfed5c…' } }` — single source of truth, re-verified at build time against `releases.antfly.io`.
- `installAntflyDependency()`:
  1. If pinned-version binary already at `~/.antfly/bin/antfly` → `noop`.
  2. Consent prompt (existing `askYesNo` pattern): "Download Antfly v0.2.0-rc.2 (~XX MB) from releases.antfly.io?"
  3. Download tarball for `process.platform`/`process.arch` to a temp file; compute SHA256; compare to pinned checksum; mismatch ⇒ `failed` with explicit message (delete temp file).
  4. Extract `antfly/antfly` → `~/.antfly/bin/antfly`, `chmod 755`. Atomic: extract to temp, rename into place.
  5. Verify by running `antfly --version` and matching the pin.
  6. Unsupported platform (e.g. darwin-x64) ⇒ `failed` with clear message (Antfly ships no darwin-x64 Zig build).
- `checkAntflyDependency()`: resolve binary (`ANTFLY_PATH` → `~/.antfly/bin/antfly`), run `--version`, compare to pin. States: `ok` / `missing` / `wrong-version (error + remediation)`.
- **Legacy detection + optional disk-reclaim** (new, runs inside install flow after binary verify):
  - Detect: `~/.termite/` exists; old `~/.antfly/data` exists; settings URL matching a known old default; brew antfly on old candidate paths.
  - The private instance (decision 10) means none of these block anything — cleanup is housekeeping. Per-item consent to delete `~/.termite` and `~/.antfly/data` (default No; ALL-antfly-data warning — other projects' tables may live there; decliners pointed at upstream backup/restore). Settings URL auto-corrected to `http://localhost:3738` **only when matching a known old default**; deliberate non-default URLs never rewritten. Brew binary: print `brew uninstall antfly` suggestion, never execute.
- Remove entirely: `findBrew()`, `BREW_*` constants, xcode error handling, brew spawn path.

### 4.2 Models (`setup.ts` models section — modify)

- `installTermiteModels` → `installInferenceModels`: spawn `antfly inference pull <model>` per missing model; verify under `~/.antfly/inference/models/{owner}/{name}/` via `model_manifest.json` + file presence (adapted to new layout).
- `termiteModelsRoot()` → `inferenceModelsRoot()` = `~/.antfly/inference/models` (rename across factory + consumers).
- Quick win (b): `checkInferenceModels()` reports missing models as **`degraded`-flavored ok/warn** ("models will lazy-download on first search; run `bakin install search-models` to prefetch"), not a hard failure.

### 4.3 Server supervision (`packages/adapter-antfly/src/server.ts` — modify)

- Spawn: `antfly swarm --host 127.0.0.1 --port <from settings url, default 3738> --health-port 3739 --data-dir ~/.bakin/antfly --models-dir ~/.antfly/inference/models`. Drop `ANTFLY_DATA_DIR` env and `--metadata-api`. Data dir resolved via `getBakinPaths()` (new `antfly` entry) so test isolation comes free with the BAKIN_HOME mocks.
- Spawn only when `settings.url` is the local default; a non-default URL = external/guest mode (connect, never spawn, never touch disk) — matches existing external-instance behavior.
- Health/readiness: `GET /antfly/readyz` (replaces `/api/v1/status`) for startup wait, external-instance detection, and stability rechecks.
- Binary candidates: `ANTFLY_PATH` → `~/.antfly/bin/antfly` only (brew paths removed).
- Log-parsing filters re-baselined against the Zig server's actual startup output.

### 4.4 Adapter client (`packages/adapter-antfly/src/search.ts` — modify)

- Vendored new SDK; baseUrl semantics change: settings default `url` → **`http://localhost:8080`** (SDK now owns `/db/v1` prefixing).
- Re-verify every client call against the new SDK surface (tables.list/create/drop/stats/getHealth/rebuildIndexes, documents.index/batchIndex/remove/batchRemove/transform, query, multiQuery, scan) — expectation: shape-compatible, fix drift where found.
- Embedder/reranker config (provider `termite` naming) updated to whatever the v0.2.0 table-schema expects (verify in antfly repo openapi; likely provider `antfly`).
- Quick win (a): `getHealthChecks()` enriches `antfly.availability` with readyz/version/model detail.
- Drop `patches/@antfly__sdk@0.0.14.patch` if the new SDK build doesn't need the openapi-fetch interop fix (verify; if still broken upstream, re-patch and tell Antfly devs).

### 4.5 Settings (`packages/core/src/settings.ts` — modify)

- Default `url`: `http://localhost:3738` (Bakin's private instance; no path suffix). Keep `enabled`, `auth`, `search.*`, `embedders`, `chunking` shape unless SDK schema forces changes (parity posture). Update provider names if required (§4.4).

### 4.6 Onboarding components (`src/core/onboarding/{search,search-models}.ts`)

- No structural change (they delegate via the factory). Wording flows from setup.ts. Consent prompts must name new sizes/sources accurately.

### 4.7 Recovery documentation

- New short doc (location: `docs/` content collection alongside existing using-docs) covering manual recovery for previously-onboarded machines: stop bakin → `bakin install search` (handles cleanup) → `bakin install search-models` → `bakin reindex` → `bakin check search`. Plus the fully-manual variant (`rm -rf ~/.antfly/data ~/.termite`, `brew uninstall antfly`).

### 4.8 Docs & knowledge sync (mandatory per kickoff)

- `.claude/knowledge/search-system.md` — install method, paths, ports, readyz, models root.
- `.claude/knowledge/adapter-architecture.md` — adapter ownership notes (`~/.termite` references removed, binary/install ownership).
- `docs/src/content/docs/using/essentials.md` — any brew/antfly install references.
- `README.md` / `CONTRIBUTING.md` — only if they mention antfly install specifics (verify).
- `CLAUDE.md` — Runtime Data Directory map gains `~/.bakin/antfly/` (private instance data dir); search/adapter bullets reviewed for drift.

## 5. Acceptance criteria

1. Fresh machine (no antfly anywhere): `bakin onboard` → consent → download+verify+install to `~/.antfly/bin` → `bakin check search` = ok, with **no brew/node/python/sudo involvement**.
2. Checksum mismatch ⇒ install fails loudly, no binary written, re-run safe.
3. Legacy machine (brew binary + `~/.termite` + old data): **new world boots healthy without any cleanup** (private data dir is fresh); installer offers optional disk-reclaim of the old dirs (default No, ALL-data warning), prints brew uninstall suggestion, auto-corrects settings URL only when it matches a known old default; `bakin start` + `bakin reindex` yields a healthy, populated index either way.
4. Wrong-version binary at `~/.antfly/bin` ⇒ `check` reports version drift with remediation; `install` replaces it.
5. `bakin start` boots `antfly swarm`, readiness via `/antfly/readyz`, indexing/query/facets/rerank at behavioral parity (existing adapter tests pass, updated for new protocol).
6. Models: explicit pull works (`bakin install search-models`); skipping it leaves search **functional** with degraded health note (lazy download).
7. Search disabled or install declined ⇒ file-only mode, zero antfly side effects (unchanged).
8. Full suite green via `bun run test`; zero references to brew/termite remain in src (grep-clean, excluding Bakin's own homebrew-tap distribution which is unrelated).
9. All §4.8 docs updated in the same effort.

## 6. Commands (operator surface — unchanged names, new behavior)

- `bakin onboard` / `bakin install search` / `bakin install search-models` / `bakin check search` / `bakin check search-models` / `bakin reindex` / `bakin doctor`.

## 7. Testing strategy

- TDD per task (agent-skills:test): failing test first for installer (download/checksum/extract/verify — fetch + spawn mocked), legacy detection/cleanup, version check, server spawn args + readyz polling, model layout verification, settings defaults.
- All tests mock content-dir (both facade paths) + OpenClaw home + logger + watcher per CLAUDE.md testing rules; antfly home interactions confined to temp dirs (`ANTFLY_PATH`, fake `~/.antfly` under testDir — installer/check code must take an injectable antfly-home root to stay testable, mirroring the content-dir pattern).
- No test downloads from the network; checksum fixtures use small synthetic tarballs.
- Existing `tests/core/onboarding/antfly.test.ts`, `tests/adapter-antfly/{server,search}.test.ts` rewritten for the new flow.

## 8. Boundaries

**Always:** consent prompts before downloads/deletions; checksum verification before executing anything downloaded; pin exact versions; keep search optional with silent file-only fallback; conventional commits; update knowledge docs with code.
**Ask first:** adopting any v0.2.0 feature beyond the two locked quick wins; changing settings schema shape beyond what the SDK forces; bumping the pin to a different Antfly version; publishing/PR actions.
**Never:** invoke brew (even for cleanup); fabricate checksums or model metadata; write to real `~/.antfly`/`~/.termite`/`~/.bakin` from tests; add a parallel stats system; silent data deletion.

## 9. External dependencies / asks

1. **Mark → Antfly devs:** publish new `@antfly/sdk` to npm under `next` (version-bumped to 0.2.0-rc.2), same as `@antfly/cli`. Until then we vendor a tarball built from the tag.
2. (Nice-to-have ask) keep `antfly_zig_checksums.txt` stable per release — our installer depends on it at pin-time (we bake checksums in; the file is how we obtain them when bumping).

## 10. Future opportunities (explicitly out of scope)

Ranked candidates for follow-up efforts: SDK inference client for rerank/embed paths (revisit once published SDK lands); backup/restore API instead of full reindex; transactions for atomic batch index; new inference modalities (OCR/transcription/entity recognition) for asset indexing; auth on the antfly port; `antfly agents` retrieval (overlaps Bakin's own orchestration — needs design thought).

## 11. Open items for the plan phase

- Verify exact v0.2.0 table-schema/embedder provider naming against the openapi spec before coding (§4.4).
- Verify the tarball download size for accurate consent copy.
- Confirm whether the openapi-fetch CJS patch is still needed against the new SDK build.
- Detailed commit strategy with rollback checkpoints (required in plan).
