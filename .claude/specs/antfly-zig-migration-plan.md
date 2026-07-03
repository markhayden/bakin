# Antfly Zig Migration — Plan

**Status:** Draft — pending approval
**Spec:** `.claude/specs/antfly-zig-migration.md` (approved 2026-06-05)
**Branch:** `feat/antfly-zig-migration` (PR → `main`)

## Pre-flight findings (resolves spec §11)

Verified against the Antfly repo + installed SDK before planning:

1. **Provider naming changed:** `termite` → `antfly` in embedder + reranker configs (enum: `antfly|ollama|gemini|vertex|openai|openrouter|bedrock|cohere|mock`; rerankers: `antfly|ollama|cohere|vertex`). Touches settings defaults + table-create + reranker request in `search.ts`.
2. **Query strategy routing changed:** new `QueryRequest` has **no strategy concept** — hybrid RRF is inferred when both `full_text_search` and `semantic_search` are present; `merge_config` tunes the merge. Bakin's `search.strategy` setting stays as-is and maps to which fields the adapter populates (`semantic_only` → only `semantic_search`, `full_text_only` → only `full_text_search`, `rrf` → both). `resolveStrategy`-based index gating is reworked accordingly.
3. **CJS patch obsolete:** new SDK tsup config sets `noExternal: ["openapi-fetch"]` — the interop bug Bakin patches is gone. Delete `patches/@antfly__sdk@0.0.14.patch`.
4. **Compatible surfaces:** client constructor (`{ baseUrl, auth }` + baseUrl auto-normalization), `tables.list/create/drop/batch/scan`, `indexes.*`, batch shapes (new fields additive), response hit/agg parsing, basic auth.
5. **Tarball size:** ~19.8 MB (Darwin arm64) → consent copy says "~20 MB".
6. **SDK vendoring recipe:** in `antfly/ts/packages/sdk` at tag `v0.2.0-rc.2`: build (tsup) → `npm pack` → commit tarball to `vendor/antfly-sdk-0.2.0-rc.2.tgz` → root `package.json`: `"@antfly/sdk": "file:vendor/antfly-sdk-0.2.0-rc.2.tgz"`.

## File decomposition strategy (added 2026-06-05)

Long files touched by this migration get decomposed as part of the work — but never refactor + behavior in one commit:

- **`search.ts` (727)** — pure-move split FIRST (A0), then protocol changes land as small diffs. Target layout under `packages/adapter-antfly/src/`: `defaults.ts` (settings merge + default config), `query-translation.ts` (SearchQuery → QueryRequest + response mapping), `search.ts` (adapter class, slimmed).
- **`setup.ts` (520)** — NOT pre-split: the brew code is deleted wholesale. B-phase writes new code directly into new files: `pin.ts` (version + checksums constant), `installer.ts` (download/verify/extract/version-check), `models.ts` (inference pull + verification), `legacy-cleanup.ts` (detection + consented removal). `setup.ts` shrinks to a thin composition layer preserving the `createAntflySearchSetup` factory contract.
- **`server.ts` (437)** — log-filtering rules extracted to `server-logs.ts` during A3; rest stays.
- **`cli/bakin.ts` (4,675)** — the real offender, but our diff there is ~0 lines. Explicitly OUT of scope; standalone follow-up spec (per-command module decomposition).

Rule: every split is a `refactor(adapter-antfly): …` commit with zero behavior change (suite green, no test edits beyond imports), so behavior commits stay readable and individually revertible.

## Dependency graph

```
A0 pure-move split of search.ts (refactor, zero behavior)
  └─ A1 vendor SDK tarball (inert)
       └─ A2 dep swap + protocol migration + settings defaults
       └─ A3 server.ts spawn/readyz/paths + health quick-win
            └─ B1 installer rewrite (download/checksum/verify, brew removal)
                 ├─ B2 models flow (inference pull, new root, degraded quick-win)
                 └─ B3 legacy detect + consented cleanup
                      └─ C1 live integration smoke on this machine (gated)
                           └─ D1 docs/knowledge sync
                                └─ D2 final sweep + PR
```

Adapter-before-installer is deliberate: new adapter + missing binary degrades gracefully to file-only; new binary + old adapter would break search mid-stream.

## Tasks

### Phase A — Protocol core

**A0. Pure-move split of search.ts (zero behavior change)**
- Extract `defaults.ts` (DEFAULT_SETTINGS, settings merge) and `query-translation.ts` (query building + response mapping) from `search.ts`; adapter class stays in `search.ts` importing both. `index.ts` exports unchanged. Test files only update imports if they reached into internals.
- **Accept:** full suite green with no assertion changes; `git diff --stat` shows moves, not rewrites.
- **Commit 1:** `refactor(adapter-antfly): split search.ts into defaults + query-translation modules`

**A1. Vendor the new SDK (inert)**
- Build SDK from `v0.2.0-rc.2` tag in the antfly repo; `npm pack`; add `vendor/antfly-sdk-0.2.0-rc.2.tgz`. Add a `vendor/README.md` line documenting provenance (tag + build command) and the planned swap to the published `next` version.
- *No dependency change yet — tree behavior identical.*
- **Accept:** tarball present; `bun run test` green; `git status` otherwise clean.
- **Commit 2:** `chore(adapter-antfly): vendor @antfly/sdk built from v0.2.0-rc.2 tag`

**A2. Swap SDK + migrate adapter client protocol**
- `package.json`: `@antfly/sdk` → `file:` dep; delete patch + `patchedDependencies` entry; `bun install`.
- `defaults.ts`: provider defaults `termite`→`antfly` (embedders + reranker); baseUrl default (`http://localhost:3738`, no suffix — Bakin's private instance port, see A3). `query-translation.ts`: query building per finding 2; response/batch/scan verification against new types. `search.ts`: client construction; public `SearchAdapter` contract unchanged.
- `packages/core/src/settings.ts`: default `url` → `http://localhost:3738`; provider defaults `antfly`.
- Rewrite `tests/adapter-antfly/search.test.ts` expectations (request shapes, provider names).
- **Accept:** typecheck + full suite green; grep `termite` in `packages/core/src/settings.ts` + `packages/adapter-antfly/src/{defaults,query-translation,search}.ts` = 0 hits (setup.ts still pending, expected).
- **Commit 3:** `feat(adapter-antfly): speak antfly v0.2 protocol (db/v1 SDK, antfly provider, field-driven query strategy)`
- **Checkpoint α:** old-world install still nominally present but adapter now requires new server; on this machine search degrades to file-only until B1+C1. Suite green. Revert of commits 1-3 restores old world fully.

**A3. Server supervision for the Zig binary — private instance**
- `packages/adapter-antfly/src/server.ts`: spawn `antfly swarm --host 127.0.0.1 --port 3738 --health-port 3739 --data-dir ~/.bakin/antfly --models-dir ~/.antfly/inference/models` (drop `--metadata-api`, drop `ANTFLY_DATA_DIR` env). Port parsed from `settings.url`; **spawn only when url is the local default** — any other url = guest mode (connect, never spawn, never touch disk; existing external-instance behavior, now an explicit branch).
- `packages/core/src/content-dir.ts` (+ `src/core/content-dir.ts` facade): `getBakinPaths()` gains `antfly` entry → `~/.bakin/antfly/` — test isolation comes free with existing BAKIN_HOME mocks.
- Readiness + stability recheck via `GET /antfly/readyz`; binary candidates = `ANTFLY_PATH` → `~/.antfly/bin/antfly` (brew paths removed); expected-log filter rules extracted to new `server-logs.ts` and re-baselined (final pass in C1 against real output).
- Quick win (a): enrich `antfly.availability` health check (readyz result, binary version, models state placeholder until B2). In guest mode, a readyz-404/old-status-200 signature notes "server at <url> looks like pre-0.2 antfly".
- Update `tests/adapter-antfly/server.test.ts`.
- **Accept:** suite green; spawn-arg + readyz + guest-mode-no-spawn tests pass; no brew path strings in server.ts.
- **Commit 4:** `feat(adapter-antfly): private zig instance (own data dir + port, /antfly/readyz, richer availability health)`

### Phase B — Install + models + cleanup

Phase B retires `setup.ts` as a monolith: new code lands in new files (`pin.ts`, `installer.ts`, `models.ts`, `legacy-cleanup.ts`); `setup.ts` ends as a thin composition layer preserving the `createAntflySearchSetup` factory contract.

**B1. Direct-download installer (brew removal)**
- New `pin.ts`: `ANTFLY_PIN = { version: '0.2.0-rc.2', checksums: { 'darwin-arm64': '1eb09c…', 'linux-x64': 'f9c671…', 'linux-arm64': 'cfed5c…' } }` (full hashes; re-verify against `antfly_zig_checksums.txt` when writing the code).
- New `installer.ts` — `installAntflyDependency()`: noop if pinned version present → consent ("Download Antfly v0.2.0-rc.2 (~20 MB) from releases.antfly.io?") → download to temp → SHA256 verify (mismatch ⇒ `failed`, temp deleted) → extract `antfly/antfly` → atomic rename to `~/.antfly/bin/antfly`, chmod 755 → `antfly --version` verify. Unsupported platform (darwin-x64) ⇒ `failed` with clear copy. `checkAntflyDependency()`: binary resolve + `--version` vs pin; states ok / missing / wrong-version (with remediation).
- Antfly-home root must be injectable (mirror content-dir pattern) for test isolation.
- **Running-server handling:** if a Bakin-spawned antfly is running during install/upgrade, stop it before swapping the binary (or fail with "run `bakin stop` first") — never swap under a live process.
- Delete from `setup.ts`: `findBrew`, `BREW_*`, xcode error handling, brew spawn path. Rewrite `tests/core/onboarding/antfly.test.ts` (mock fetch + synthetic tarballs in temp dirs; cover happy path, checksum mismatch, wrong-version replace, unsupported platform, decline).
- **Accept:** suite green; grep `brew` under `packages/adapter-antfly/ src/core/onboarding/` = 0 hits; no network in tests.
- **Commit 5:** `feat(onboarding): install antfly via pinned checksum-verified direct download (rip out brew)`
- **Checkpoint β:** fresh-machine onboarding story complete end-to-end in code.

**B2. Models flow on the inference runtime**
- New `models.ts` (replaces models section of `setup.ts`): `installInferenceModels` spawning `antfly inference pull <model>`; verification against `~/.antfly/inference/models/{owner}/{name}/` (`model_manifest.json` + files); `termiteModelsRoot()`→`inferenceModelsRoot()` (ripple: `src/core/search-adapter-factory.ts`, `index.ts` exports, consumers).
- Quick win (b): missing models ⇒ warn-level "will lazy-download on first search; run `bakin install search-models` to prefetch" (not a failure); wire models state into the A3 health detail.
- Same 3 models. Update tests.
- **Accept:** suite green; grep `termite` repo-wide (src) = 0 hits except vendored SDK internals if any.
- **Commit 6:** `feat(onboarding): pull search models via antfly inference runtime; treat missing models as degraded`

**B3. Legacy state detection + optional disk-reclaim**
- New `legacy-cleanup.ts` (invoked from install flow post-verify): detect `~/.termite/`, old `~/.antfly/data`, brew binary at old candidate paths, stale settings URL.
- **The new world never needs the old dirs** (private instance under `~/.bakin/antfly/`) — cleanup is pure housekeeping: "Bakin no longer uses these locations; reclaim ~X MB?" Per-item consent, **default No**, with the ALL-antfly-data warning on `~/.antfly/data` (other projects' tables may live there; decliners pointed at upstream backup/restore).
- Settings URL auto-corrected to `http://localhost:3738` **only when it matches a known old default** (`http://localhost:8080/api/v1`, `http://0.0.0.0:8080/api/v1`); deliberate non-default URLs are never rewritten.
- Brew binary → printed `brew uninstall antfly` suggestion only. All findings summarized in install output.
- **Memory offsets:** bump `MEMORY_SCHEMA_VERSION` (plugins/memory/lib/memory-migration.ts) by 1 — the index moves to a fresh data dir, and without the bump the offset-based memory indexer would silently skip already-read bytes forever. The existing migration mechanism resets the table + clears offsets on first healthy boot.
- `setup.ts` is now the thin composition layer — verify it's down to factory wiring only.
- Tests: each detection + consent/decline path in temp dirs (decline ⇒ dirs untouched AND search still healthy); URL-correction guard (non-default urls untouched); memory-migration version bump covered by existing migration tests (verify).
- **Accept:** suite green; declining cleanup leaves dirs untouched; accepting removes only the targeted dirs; `setup.ts` < ~100 lines.
- **Commit 7:** `feat(onboarding): detect v0.1 antfly leftovers and clean up with consent`
- **Checkpoint γ:** code-complete. Everything after this is verification + docs.

### Phase C — Live verification (gated on Mark)

**C1. Real-machine smoke + drift fixes**
- On this machine, with Mark's go-ahead: `bakin install search` (real download), `bakin install search-models` (or skip one model to exercise degraded path), `bakin start`, `bakin reindex`, exercise query/facets/rerank via `bakin search` + a plugin page, `bakin check all`, `bakin doctor`.
- Expected drift to catch: real Zig startup log lines (filter re-baseline), readyz timing, real table-create acceptance of our schema, reranker behavior, legacy cleanup against the machine's actual brew/termite leftovers.
- Verify embedder-config hash change (termite→antfly) triggers the automatic index rebuild path; verify memory tier rows reappear post-migration (offsets reset working); confirm auth stays off by default on the live server.
- **Accept:** healthy doctor; populated index; parity behavior confirmed by Mark in the dashboard.
- **Commit 8:** `fix(adapter-antfly): re-baseline against live v0.2.0-rc.2 behavior` (only if drift found; else skipped)

### Phase D — Docs + final sweep

**D1. Docs/knowledge sync**
- `.claude/knowledge/search-system.md`, `.claude/knowledge/adapter-architecture.md` (install method, paths, ports, readyz, models root, termite removal); `docs/src/content/docs/using/essentials.md`; recovery doc (new, under `docs/src/content/docs/using/`): previously-onboarded-machine path + fully-manual path; `README.md`/`CONTRIBUTING.md` only if they reference antfly install (verify by grep).
- **Accept:** every §4.8 spec item addressed; no stale brew/termite/api-v1 references in docs (excluding Bakin's own homebrew-tap distribution docs).
- **Commit 9:** `docs(search): document zig-antfly install, recovery path, and updated architecture`

**D2. Final sweep + PR**
- Repo-wide grep audit (`brew.*antfly`, `termite`, `/api/v1`, `--metadata-api`, `ANTFLY_DATA_DIR`); run `.claude/skills/check-adapter-boundary.md` audit; full `bun run test`; `bun run build` sanity (embedded assets unaffected — verify nothing embeds antfly paths).
- Then per kickoff: `/agent-skills:test` coverage pass, `/agent-skills:review` five-axis review, PR.
- **Accept:** all green; PR body links spec + plan.
- **Commit 10 (if needed):** residue from sweep, otherwise none.

## Commit strategy (rollback checkpoints)

- One branch `feat/antfly-zig-migration`; **every commit leaves the full suite green** — each is a valid rollback point via `git revert` (no force pushes).
- Refactor commits (1, and the `server-logs.ts` extraction inside 4) are pure moves — zero behavior, zero assertion changes — so behavior diffs stay small and reviewable.
- Commits 1-4 are separable protocol steps; reverting 4→3→2→1 in order restores the brew world losslessly (nothing else touches those files in between).
- **Checkpoint α** (post-3): protocol switched, old install intact — rollback cost: trivial.
- **Checkpoint β** (post-5): new install path live — from here a rollback also implies re-installing the brew binary manually on any machine that ran the new installer (acceptable: this machine only).
- **Checkpoint γ** (post-7): code-complete before live smoke — the natural "pause point" if the live run surfaces something big; we can hold here without docs debt since docs land after verification.
- Live-smoke fixes are isolated in commit 8 so behavior re-baselining is auditable apart from the planned migration.
- No `git add -A` anywhere (build stamps a tracked version file — see memory); stage explicit paths.
- Squash-merge is NOT used — checkpoint granularity is the rollback mechanism.

## Risk register (added after plan review)

| Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| RC artifacts pruned from releases.antfly.io after stable v0.2.0 ships | Medium | Fresh installs fail until pin bump | Bump pin promptly when stable lands (one constant + checksums); ask devs about RC retention |
| Shared antfly instance: cleanup deletes another project's tables | **Designed out** — private instance; cleanup is optional housekeeping | User data loss | Bakin never needs the shared dir; deletion is opt-in, default No, ALL-data warning (B3) |
| Old v0.1 server already running on 8080 | **Designed out** — Bakin's instance lives on 3738 | — | No port contention; guest-mode old-server signature message kept for opt-in external urls (A3) |
| New SDK publish never lands → vendored tarball lingers | Low | Tech debt, manual sync on bumps | Mark's ask to devs; vendor README documents provenance + swap |
| Real Zig server behavior drifts from repo reading (logs, timing, schema acceptance) | Medium | C1 rework | Drift quarantined in commit 8; checkpoint γ pause point |
| Checksum trust is TOFU at pin time | Low | Supply chain | Pinning makes post-publish tampering detectable; signed releases = future ask |
| Memory tier silently missing rows after index wipe | Was high — now mitigated | Invisible data gap | `MEMORY_SCHEMA_VERSION` bump (B3) + C1 verification |
| HuggingFace unreachable during model pull | Low | Degraded search until retried | Quick win (b) makes this a degraded state, not a failure |

## Out of scope (re-affirmed)

Rerank-path rework, new v0.2.0 features beyond the two quick wins (spec §10), Bakin's own homebrew-tap distribution (unrelated to antfly), dockerized-rig changes (no antfly there), imitation-crab (mock search adapter untouched), **`cli/bakin.ts` decomposition** (4,675 lines, ~0 lines touched here — standalone follow-up spec for per-command module split).

## Task list

- [ ] A0 pure-move split of search.ts — commit 1
- [ ] A1 vendor SDK tarball — commit 2
- [ ] A2 SDK swap + protocol migration + settings — commit 3 — **checkpoint α**
- [ ] A3 server.ts zig supervision + server-logs.ts extraction + health quick-win — commit 4
- [ ] B1 direct-download installer (pin.ts + installer.ts), brew removal — commit 5 — **checkpoint β**
- [ ] B2 models.ts via inference runtime + degraded quick-win — commit 6
- [ ] B3 legacy-cleanup.ts + setup.ts down to composition layer — commit 7 — **checkpoint γ**
- [ ] C1 live smoke on this machine (gated on Mark) — commit 8 (conditional)
- [ ] D1 docs/knowledge/recovery sync — commit 9
- [ ] D2 final sweep, coverage pass, review, PR — commit 10 (conditional)
