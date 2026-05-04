# PLAN — Agent Packages

**Companion to:** [SPEC.md](SPEC.md)
**Status:** Draft for review
**Owner:** @markhayden
**Single user:** Roscoe's machine. No backwards compatibility. Priority: reduce tech debt.

---

## How to read this document

- **Phases (A–G)** are the dependency-ordered chunks. Earlier phases must merge before later ones start.
- **Tasks** within a phase can usually parallelize (call-outs noted). Each task lists files touched, acceptance criteria, dependencies, complexity (S/M/L), and the commit boundary it belongs to.
- **Commit strategy** at the bottom defines what each checkpoint commit looks like, what tests must pass before commit, and what the rollback path is if the next phase reveals a regression.
- **Cross-cutting concerns** (audit events, search indexing, embedded assets, settings) are called out separately so we don't bury them inside a task and forget.
- **Risk hot-spots** call out the places where parallel/in-flight work conflicts, where rollback is hard, or where tests are likely to be flaky.

The spec's 12-step migration sequence has been re-grouped into 7 phases with finer task granularity. The grouping reflects what *can* commit-as-one without breaking the build, not the spec's narrative ordering.

---

## Dependency Graph

```text
                            ┌────────────────────────┐
                            │ A. Schemas + Helpers   │
                            │  (manifest, lockfile,  │
                            │   markers, blocks)     │
                            └──────────┬─────────────┘
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                ┌────────────────┐ ┌─────────────┐ ┌──────────────────┐
                │ B. Pixel as    │ │ C. Workflow │ │ D. Doctor block  │
                │  reference pkg │ │  source     │ │  helper refactor │
                │  (in agents/)  │ │  registry   │ │  (lift from      │
                └────────┬───────┘ │  ext.       │ │   doctor.ts)     │
                         │         └──────┬──────┘ └────────┬─────────┘
                         │                │                 │
                         └────────┬───────┴─────────────────┘
                                  ▼
                       ┌────────────────────────┐
                       │ E. Installer +         │
                       │  Projector (E2E vs     │
                       │  real Pixel pkg)       │
                       └──────────┬─────────────┘
                                  │
                ┌─────────────────┼──────────────────┐
                ▼                 ▼                  ▼
        ┌────────────┐    ┌──────────────┐   ┌─────────────┐
        │ F. CLI +   │    │ G. Agent     │   │ H. Composition│
        │  REST API  │    │  backfill    │   │  (skill-pack, │
        │  + onboard │    │  (8 agents)  │   │   workflow-pk │
        │  agent-    │    │              │   │   lesson-pk   │
        │  assets    │    │              │   │   transitive) │
        └─────┬──────┘    └──────┬───────┘   └──────┬────────┘
              │                  │                  │
              └────────┬─────────┴──────────────────┘
                       ▼
            ┌──────────────────────┐
            │ I. Teams UI +        │
            │  curated browser +   │
            │  doctor checks       │
            └──────────┬───────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ J. Docs + final pass │
            └──────────────────────┘
```

**Read:** Phase A unblocks B, C, D in parallel. B+C+D feed E. E unblocks F, G, H in parallel (F and G have a soft conflict — see risks). F+G+H feed I. I feeds J.

---

## Cross-cutting concerns (must land somewhere — calling out now so they don't get lost)

### CC-1 — Audit event taxonomy (new)

`appendAudit(contentDir, event, agent, data, channel)` is the existing surface. **New event names** to add (all in phase E or F depending on entry point):

| Event | Channel | Phase | Data shape |
|-------|---------|-------|------------|
| `agent_pkg.installed` | `cli` or `rest` | E | `{ packageId, version, source, ref, commitSha, agentId, state }` |
| `agent_pkg.adopted` | `cli` or `rest` | E | `{ packageId, agentId, lessonsEnabled }` |
| `agent_pkg.removed` | `cli` or `rest` | E | `{ packageId, agentId, keepBlocks, deletedAgent }` |
| `agent_pkg.updated` | `cli` or `rest` | E | `{ packageId, fromVersion, toVersion, fromSha, toSha, refreshTemplate }` |
| `agent_pkg.lessons_enabled` | `cli` or `rest` | F | `{ packageId, agentId, lessonId }` |
| `agent_pkg.lessons_disabled` | `cli` or `rest` | F | `{ packageId, agentId, lessonId }` |
| `agent_pkg.drift_detected` | `system` | I | `{ packageId, projection, expectedSha, actualSha }` |
| `agent_pkg.drift_repaired` | `cli` or `system` | I | `{ packageId, projection, oldSha, newSha }` |
| `pkg.installed` | `cli` or `rest` | H | `{ packageId, kind, version, source, ref, commitSha, refCount }` |
| `pkg.removed` | `cli` or `rest` | H | `{ packageId, kind, version, lastDependent }` |

Audit events also trigger SSE broadcast and memory-plugin indexing per existing pipeline — no new wiring needed.

### CC-2 — Search indexing for lesson files

Lesson files are markdown with frontmatter. Existing `ctx.search.registerFileBackedContentType()` precedent in projects/workflows/assets/messaging plugins is the right pattern.

**Decision:** V1 indexes lesson files under a new content type `agent-lessons` registered by the team plugin (it already owns the agent surface). The watcher path is `~/.bakin/packages/agents/<id>/lessons/*.md`. Each row carries facets: `packageId`, `agentId`, `lessonId`, `tags[]`, `enabled` (bool — synced from lockfile on enable/disable).

Fits in phase F (alongside lesson enable/disable wiring). 80 lines including watcher hookup.

### CC-3 — Settings additions

New optional settings (under `settings.agentPackages.*`):

```jsonc
{
  "agentPackages": {
    "transientFetchTimeoutMs": 30000,         // git clone timeout
    "maxTransitiveDeps": 5,                   // confirm prompt threshold
    "maxTransitiveSizeMb": 25,                // confirm prompt threshold
    "doctorIntervalMs": 1800000               // 30 min — drift sweep cadence
  }
}
```

Defaults are fine for V1 — most users never touch these. Lands in phase A alongside the schemas.

### CC-4 — Embedded assets manifest

`packages/host/src/data/curated-agents.json` is a **new directory** for the binary. `scripts/generate-embedded-assets.ts` walks specific roots (`packages/host/dist/`, `packages/host/public/`, `plugins/<id>/dist/`) — needs one new walk root for `packages/host/src/data/` mapping to `/api/curated/`.

**Critical exclusion:** `agents/<id>/` directories must NOT be embedded into the binary (per spec — no core agents bundled). The walk script must explicitly not include `agents/`. We'll grep for any accidental inclusion as a verification step.

Lands in phase I (curated browser).

### CC-5 — Doctor cadence + plugin-style health check

Doctor already runs `runDiagnostics()` in `src/core/doctor.ts` on a timer + on-demand. Agent-package drift checks plug in as one new function returning `DiagnosticResult[]`, called from the same orchestrator. No new timer.

Lands in phase I.

### CC-6 — Test isolation rule (mandatory)

Update `CLAUDE.md` testing section in phase J: every test in this feature **must** mock both `content-dir` and `openclaw-home`. P0 violation severity. Tests/setup helpers land in phase A so every later phase has them available.

### CC-7 — Server startup ordering

Workflow source registry currently loads in this order at startup:
1. Plugin registry activates plugins; plugins call `ctx.registerWorkflow()` → `registerPluginDefinition()`.
2. User definitions loaded from `~/.bakin/workflows/definitions/` → `registerUserDefinition()`.

**New step (phase C):** before #2, load lockfile-listed agent packages and call `registerAgentPackageDefinition()` for each contribution. Order: `agent-package` < `user` (user wins on collision; agent-package wins over plugin to allow override of plugin-shipped workflows). Same precedence rule extends to skill-loader.

Bug-prone if forgotten — added to phase C acceptance criteria explicitly.

---

## Risk Hot-Spots

### R-1 — Lifting `checkManagedBlock` out of `src/core/doctor.ts`

The block helper (lines 898-953) is in active use by 4 managed blocks (mission-control, hard-rules, dependency-pattern, media-delegation). Moving it to `packages/core/src/agent-packages/managed-blocks.ts` requires the existing 4 callers to keep working unchanged. **Mitigation:** dedicated regression test in phase D before any other extraction. Run `bakin doctor` against a clean OpenClaw fixture before and after the lift; assert byte-identical AGENTS.md output.

### R-2 — Soft conflict between phase F (CLI/REST) and phase G (agent backfill)

Phase G writes 8 packages into `agents/<id>/`. Phase F adds REST endpoints in `packages/host/src/api/agents/`. These touch overlapping paths only in the route registration table (in `server.ts` or the route catch-all). **Mitigation:** F adds the endpoints; G only adds files under `agents/<id>/`. They serialize at the file level. If parallelized, last commit to merge wins on `server.ts`-level changes — and since neither modifies `server.ts` directly (catch-all routes pick up new files automatically), no real conflict.

### R-3 — Existing OpenClaw agents detection on first install

When user runs `bakin agents install ./agents/pixel` against a machine that already has a hand-edited `~/.openclaw/workspaces/pixel/`, what happens? Spec says: detect existing → prompt adopt-vs-replace. **Risk:** the detection logic is the thinnest part of the install flow; getting it wrong destroys customization. **Mitigation:** dedicated "existing-agent-detection" test (phase E) before any backfill happens. When a hand-edited agent exists, default behavior: refuse install, instruct `--adopt` or `--replace`. Never silently overwrite.

### R-4 — Backfilling Roscoe's customizations

Each of the 8 agents has hand-edited workspace files on Roscoe's actual machine. Phase G needs to:
1. Snapshot `~/.openclaw/workspaces/<id>/` before any package writes.
2. Convert that snapshot into `agents/<id>/` package shape (extracting lessons from prose, generating manifest).
3. Test the install against a temp `OPENCLAW_HOME` round-trip.
4. ONLY write to real `~/.openclaw/` after Roscoe explicitly confirms.

**Mitigation:** phase G has a hard verification gate — Roscoe runs the installer against a temp OpenClaw home first, manually inspects the resulting `~/.openclaw/workspaces/pixel/`, then re-runs against real home. Backup `~/.openclaw/` to `~/.openclaw.bak.<date>/` before any phase-G commit.

### R-5 — OpenClaw skill cache

OpenClaw might not pick up new skills until session restart. **Unknown until tested.** Phase E acceptance criteria includes: install a skill, verify next OpenClaw session sees it. If session restart is required, surface that fact in CLI output (`Restart OpenClaw to load new skills`) — same pattern as plugin install (`Restart Bakin to load the plugin`).

### R-6 — Memory-plugin indexer + audit.jsonl growth

Every new audit event triggers indexing into `bakin_memory` table. Phase E adds 4 events per install; phase F adds 2 per lesson toggle. Volume should be fine but worth verifying — phase F manual test runs `bakin agents install` 10 times and confirms `bakin_memory` table doesn't bloat unreasonably.

### R-7 — `git clone --depth 1 --branch <ref>` semantics

`@ref` could be a branch, a tag, or a commit SHA. `--branch` flag accepts branches and tags but NOT commit SHAs. **Mitigation:** phase E source-fetcher handles both: try `--branch <ref>` first; on failure (commit SHA), `git clone` then `git checkout <ref>`. Test both paths.

### R-8 — Concurrent installs

Two `bakin agents install` invocations racing on the same lockfile. **V1 mitigation:** advisory lock file at `~/.bakin/packages/.lock`; second install errors out with `another install in progress`. Released on success/failure/process-exit. Trivial implementation, big footgun without it.

### R-9 — Plugin Registry order in server.ts

Server.ts boots plugin registry → workflow source registry already populated by plugins. Adding agent-package sources to the registry needs to happen AFTER plugin activation (so plugin sources land first) but BEFORE the first request hits. New `loadAgentPackageSources()` call slotted into `server.ts` boot sequence. Easy to forget — explicit acceptance criterion in phase C.

---

# Phased Tasks

Each task: files touched · dependencies · complexity · acceptance criteria · commit boundary.

---

## Phase A — Schemas, Helpers, Test Infrastructure

**Goal:** Pure types, validators, and helpers. No filesystem operations land in this phase. End state: every later phase imports from here without any ambiguity about manifest/lockfile/marker shapes.

**Parallelizable:** A-1, A-2, A-3, A-4, A-5 can all be done in parallel (no inter-task deps).

### A-1 — Manifest zod schema (`bakin-package.json`)

- **Files:**
  - NEW `packages/core/src/agent-packages/manifest.ts`
  - NEW `packages/core/src/agent-packages/types.ts`
  - NEW `tests/agent-packages/manifest.test.ts`
  - NEW `tests/fixtures/agent-packages/manifests/{agent,skill-pack,workflow-pack,lesson-pack}.json`
- **Deps:** none
- **Complexity:** M
- **Acceptance:**
  - Zod schema accepts all 4 kinds with kind-specific stanzas (`agent` and `install` only on `kind:"agent"`)
  - Zod refusal on missing required fields (`id`, `kind`, `version`, `name`, `bakin`)
  - Zod refusal on `id` not matching `/^[a-z0-9][a-z0-9-_]{0,39}$/i` (mirrors plugin install ID rule)
  - Zod refusal on `dependencies[].source` not matching local-path-or-`github:` pattern
  - Each kind has at least one valid + one invalid fixture; tests parse all and assert success/failure
  - Type exports: `Manifest`, `AgentManifest`, `SkillPackManifest`, `WorkflowPackManifest`, `LessonPackManifest`, `Dependency`
- **Commit boundary:** ❶ "feat(agent-pkg): manifest schema + types"

### A-2 — Lockfile schema + atomic read/write

- **Files:**
  - NEW `packages/core/src/agent-packages/lockfile.ts`
  - NEW `tests/agent-packages/lockfile.test.ts`
- **Deps:** none
- **Complexity:** M
- **Acceptance:**
  - Zod schema for `~/.bakin/packages/lock.json` matching SPEC.md format
  - `readLockfile(): Lockfile` (returns empty `{ version: 1, packages: {} }` if file missing)
  - `writeLockfile(lock: Lockfile): void` — atomic via tmp + rename
  - `addPackage(lock, entry)`, `removePackage(lock, id)`, `incrementRefCount(lock, id)`, `decrementRefCount(lock, id)` — pure functions
  - `getOrphanedPacks(lock): PackageEntry[]` — returns packs with refCount 0 (post-removal cleanup helper)
  - Tests verify atomic write doesn't corrupt on crash (write to tmp, kill, ensure original survives — simulate via tmp rename failure)
  - All file ops mock `getContentDir`
- **Commit boundary:** ❷ "feat(agent-pkg): lockfile schema + atomic IO"

### A-3 — Markers (`.installedBy` and `.userEdited`)

- **Files:**
  - NEW `packages/core/src/agent-packages/markers.ts`
  - NEW `tests/agent-packages/markers.test.ts`
- **Deps:** none
- **Complexity:** S
- **Acceptance:**
  - Sidecar format: `<targetfile>.installedBy` JSON `{ package, version, ref, commitSha, sha256, installedAt }` (zod-validated on read)
  - `writeInstalledBy(target, marker)`, `readInstalledBy(target): Marker | null`, `removeInstalledBy(target)`
  - `isUserEdited(target)`, `markUserEdited(target)`, `unmarkUserEdited(target)`
  - `computeFileSha(path): string` and `computeDirSha(path): string` (recursive Merkle-style for skill dirs)
  - Tests cover round-trip, malformed JSON returns null, sha consistency across rename
- **Commit boundary:** ❸ "feat(agent-pkg): provenance + user-edit markers"

### A-4 — Managed-block helper (lifted from doctor.ts)

- **Files:**
  - NEW `packages/core/src/agent-packages/managed-blocks.ts`
  - NEW `tests/agent-packages/managed-blocks.test.ts`
- **Deps:** none (refactor lands in phase D — this phase only ships the new helper)
- **Complexity:** S
- **Acceptance:**
  - `injectBlock(content, blockId, body): string` — adds or updates `<!-- bakin:<blockId>:start --> ... :end -->` markers
  - `extractBlock(content, blockId): string | null` — returns body or null
  - `removeBlock(content, blockId): string` — strips markers + body
  - `listBlocks(content): { blockId, body }[]` — discover all marker pairs
  - `hasBlock(content, blockId): boolean`
  - Tests cover: insert into empty file, update existing, remove, malformed (start without end → returns null + warning), nested marker rejection
  - Marker namespace convention documented in JSDoc: `bakin:lesson:<package-id>:<lesson-id>`, `bakin:lesson-catalog`, plus the doctor-owned ones (`bakin:mission-control` etc.)
- **Commit boundary:** ❹ "feat(agent-pkg): managed-block primitives"

### A-5 — Test infrastructure (helpers + mocks)

- **Files:**
  - NEW `tests/agent-packages/test-helpers.ts`
  - UPDATE `tests/setup.ts` (verify global mock surface)
- **Deps:** A-1, A-2, A-3, A-4 (helpers reference these)
- **Complexity:** M
- **Acceptance:**
  - `mockBakinAndOpenClawHomes(): { bakinDir, openClawDir, cleanup }` — sets up both temp dirs + auto-mocks `content-dir` (both paths) AND `openclaw-home`
  - `seedOpenClawAgent({ id, workspaceFiles?, identity? })` — pre-seeds `openclaw.json` + workspace dir
  - `installFixtureManifest({ kind, ... })` — copies a fixture package to a temp dir and returns the path
  - `assertProjectionExists({ target, expectedSha })` — checks both target file + sidecar
  - `assertNoLeakage(testDir)` — recursively scans for any path matching `/\.bakin\/(?!packages|agents)/` or `/\.openclaw/` outside testDir
  - Tests verifying these helpers themselves (helpers-of-helpers — quick sanity)
- **Commit boundary:** ❺ "test(agent-pkg): isolation harness + helpers"

### Phase A verification gate

- All 5 commits land green: `bun test tests/agent-packages/ --isolate`
- No new dependencies in `package.json`
- TypeCheck clean: `bun run typecheck` (or whatever the project uses)
- Total: ~5 commits, ~600 lines net (core lib + tests)

---

## Phase B — Pixel as Reference Package

**Goal:** Take Pixel's current hand-edited workspace and convert it into the `agents/pixel/` package shape. This is the canonical reference and forces the schemas (phase A) to match reality.

**Parallel with:** C, D (no shared files; serializes through phase E).

### B-1 — Snapshot existing Pixel workspace

- **Files:**
  - NEW `agents/pixel/.snapshot/` (gitignored backup of `~/.openclaw/workspaces/pixel/` at conversion time)
- **Deps:** Phase A complete
- **Complexity:** S (manual, careful)
- **Acceptance:**
  - One-shot script `scripts/migration/snapshot-agent.ts <agent-id>` that copies `~/.openclaw/workspaces/<id>/` to `agents/<id>/.snapshot/`
  - `.snapshot/` listed in `.gitignore`
  - Run for pixel; verify byte-identical copy
- **Commit boundary:** ❻ "chore(migration): snapshot script for agent extraction"

### B-2 — Convert Pixel snapshot to package shape

- **Files:**
  - NEW `agents/pixel/bakin-package.json`
  - NEW `agents/pixel/workspace/{SOUL,IDENTITY,AGENTS,TOOLS}.md` (cleaned from snapshot, lesson prose extracted)
  - NEW `agents/pixel/skills/image-generation/{SKILL.md,scripts/...}` (extracted from `~/.openclaw/skills/image-generation/` if present)
  - NEW `agents/pixel/workflow-skills/*.md` (lifted from any plugin-shipped Pixel-specific workflow-skills)
  - NEW `agents/pixel/workflows/*.yaml`
  - NEW `agents/pixel/lessons/{product-photography,editorial-photography,prompt-style-system}.md` (extracted from current SOUL.md prose)
  - NEW `agents/pixel/assets/{avatar.jpg,avatar-full.png}` (lifted from `~/.bakin/agents/pixel/`)
  - NEW `agents/pixel/README.md` — quickstart for the package
  - UPDATE `.gitignore` — exclude `agents/*/.snapshot/`
- **Deps:** B-1
- **Complexity:** L (manual extraction, careful)
- **Acceptance:**
  - Manifest validates against zod schema (phase A-1)
  - SOUL.md template includes the marker placeholders: `<!-- bakin:lesson-catalog:start --><!-- bakin:lesson-catalog:end -->` (empty until installed)
  - Each lesson file has frontmatter `{ title, tags, defaultEnabled }`
  - `manifest.contributions.lessons` paths match files on disk
  - `manifest.install.enableLessons` lists `prompt-style-system` (the always-on lesson)
  - `manifest.agent.allowedTools` and `allowedSkills` populated as documentation hints (V1 doc-only per spec)
  - Diff between snapshot SOUL.md and template SOUL.md is reviewable (lesson prose moved to files, template skeleton remains)
- **Commit boundary:** ❼ "feat(agents): pixel as reference package"

### Phase B verification gate

- `agents/pixel/bakin-package.json` parses against `manifest.ts` zod schema
- All `manifest.contributions.*` paths resolve to existing files
- Manual review by Roscoe of the conversion (signing off this is what Pixel should be)
- Total: 2 commits

---

## Phase C — Workflow Source Registry Extension

**Goal:** Extend the workflow source registry with an `agent-package` source kind. This is the cleanest way to integrate agent-package workflows + workflow-skills without faking a plugin id.

**Parallel with:** B, D (no shared files).

### C-1 — Source registry — add `agent-package` source kind

- **Files:**
  - UPDATE `plugins/workflows/lib/source-registry.ts`
  - UPDATE `tests/lib/plugin-registry.test.ts` (or new test file)
- **Deps:** Phase A
- **Complexity:** M
- **Acceptance:**
  - `DefinitionSource` type extended: `'plugin' | 'agent-package' | 'user'`
  - `SourceStore` gets a third map: `agentPackage: Map<string, { packageId, definition }>`
  - `registerAgentPackageDefinition(packageId, id, definition)` — symmetric to `registerPluginDefinition`. Throws on cross-package collision; same package can re-register (hot-reload).
  - `unregisterAgentPackageDefinitions(packageId)` — symmetric to plugin unregister
  - Precedence in `getDefinition()`: user > agent-package > plugin (decided in phase plan; user always wins; agent-package wins over plugin so packages can override)
  - `isReadOnly()` updated to recognize agent-package as read-only
  - `getSource()` returns the new tier
  - Tests: register agent-package def, plugin tries same id (no error — agent-package shadows), user shadows both
- **Commit boundary:** ❽ "feat(workflows): agent-package source kind in registry"

### C-2 — Skill loader — add agent-package tier

- **Files:**
  - UPDATE `plugins/workflows/lib/skill-loader.ts`
  - UPDATE `tests/lib/plugin-skill-loader.test.ts` (or skill-loader specific)
- **Deps:** C-1
- **Complexity:** S
- **Acceptance:**
  - Resolution order: in-memory plugin skills → in-memory agent-package skills → user files on disk → null
  - `registerAgentPackageSkill(packageId, name, skill)` and `unregisterAgentPackageSkills(packageId)` helpers
  - `listAllSkills()` includes the new tier with `source: 'agent-package'`
  - Tests: register agent-package skill, plugin tries same name (different package wins or errors? — match source-registry semantics; agent-package shadows plugin)
- **Commit boundary:** ❾ "feat(workflows): agent-package skill loader tier"

### C-3 — Server startup — load lockfile-listed packages

- **Files:**
  - NEW `src/core/agent-packages/load-sources.ts` (lightweight; no fs side effects beyond reading lockfile)
  - UPDATE `server.ts` (one new call between plugin activation and user-source loading)
- **Deps:** C-1, C-2
- **Complexity:** S
- **Acceptance:**
  - On boot, after plugin activation, read `~/.bakin/packages/lock.json`, iterate packages with `kind: "agent" | "workflow-pack"` and call `registerAgentPackageDefinition()` per `contributions.workflows`. Same for `kind: "lesson-pack" | "agent"` for lesson files (registered with the search system later — phase F). Skills handled identically.
  - On startup with no lockfile: no-op, no error
  - On startup with malformed lockfile: log error, continue boot (do NOT crash)
  - Test verifies a fixture lockfile produces the expected source registry state
- **Commit boundary:** ❿ "feat(server): load agent-package sources at startup"

### Phase C verification gate

- Existing workflow tests still pass (regression check on plugin-registered + user-shadow flows)
- New agent-package source registry tests green
- Total: 3 commits

---

## Phase D — Doctor Managed-Block Helper Refactor

**Goal:** Lift `checkManagedBlock()` from `src/core/doctor.ts:898` to use the shared helper from phase A-4. Existing 4 managed blocks (mission-control, hard-rules, dependency-pattern, media-delegation) keep working byte-identically.

**Parallel with:** B, C (no shared files).

### D-1 — Refactor doctor's managed-block helper to use shared lib

- **Files:**
  - UPDATE `src/core/doctor.ts` (lines ~881-1099)
  - UPDATE existing doctor tests (if they exist) or NEW `tests/core/doctor-managed-blocks.test.ts`
- **Deps:** A-4 (managed-blocks helper)
- **Complexity:** M
- **Acceptance:**
  - `checkManagedBlock()` becomes a thin wrapper around `injectBlock()` / `extractBlock()` / `hasBlock()` from `packages/core/src/agent-packages/managed-blocks.ts`
  - Existing 4 `MANAGED_BLOCKS` defs unchanged; output byte-identical
  - **Regression test:** seed an OpenClaw home with empty AGENTS.md files for 2 agents; run `runDiagnostics()` with `autoFix: true`; capture all AGENTS.md output. Compare with pre-refactor output (saved as test fixture). Byte-equal.
  - Doctor still owns the 4 default block defs; only the marker insertion mechanics are shared
- **Commit boundary:** ⓫ "refactor(doctor): lift managed-block helper to shared lib"

### Phase D verification gate

- All existing doctor tests pass
- Byte-identical AGENTS.md output verified by regression test
- Total: 1 commit

---

## Phase E — Installer + Projector (the heart)

**Goal:** End-to-end install of `agents/pixel/` (local source) into a temp `OPENCLAW_HOME` + `BAKIN_HOME`. Pixel's workspace files seeded, skill projected, lesson catalog block injected, lockfile written.

**Parallel with:** none — every later phase needs this.

### E-1 — Source fetcher (local + github)

- **Files:**
  - NEW `src/core/agent-packages/source-fetcher.ts`
  - NEW `tests/agent-packages/source-fetcher.test.ts`
- **Deps:** Phase A
- **Complexity:** M
- **Acceptance:**
  - `fetchSource({ source, type, ref? }): Promise<{ stagingDir, commitSha }>` — clones to a staging temp dir
  - Local: `cpSync(sourcePath, stagingDir, { recursive: true, dereference: false })`. Reject paths outside `~` or cwd (mirrors `plugin-install.ts:54`).
  - GitHub: `git clone --depth 1 --branch <ref> <url> stagingDir` first; on fail (commit SHA), `git clone --depth 50 <url> stagingDir && git checkout <ref>`. Read `git rev-parse HEAD` for `commitSha`.
  - Bare names error: `fetchSource({ source: "pixel" })` → `Error: 'pixel' is not a valid source. Use github:user/repo[@ref] or a local path`
  - Validate manifest exists at `stagingDir/bakin-package.json` before returning; on fail, cleanup staging.
  - Tests: local fixture path, github mock (use a local bare git repo as fixture), bare-name error path
- **Commit boundary:** ⓬ "feat(agent-pkg): source fetcher (local + github)"

### E-2 — Existing-agent detection

- **Files:**
  - NEW `src/core/agent-packages/agent-state.ts`
  - NEW `tests/agent-packages/agent-state.test.ts`
- **Deps:** A-2 (lockfile)
- **Complexity:** S
- **Acceptance:**
  - `getAgentState(agentId): 'unmanaged' | 'adopted' | 'managed' | 'absent'` reads OpenClaw config + lockfile
    - `absent`: no entry in openclaw.json
    - `unmanaged`: in openclaw.json, no lockfile entry
    - `adopted`: in openclaw.json, lockfile entry with `state: 'adopted'`
    - `managed`: in openclaw.json, lockfile entry with `state: 'managed'`
  - `listAllAgentStates(): { agentId, state, packageId? }[]`
  - Mocks `openclaw-home` and `content-dir`
  - **Critical test:** existing-Pixel-on-machine scenario — agent in openclaw.json + no lockfile entry → `unmanaged` (not `absent`)
- **Commit boundary:** ⓭ "feat(agent-pkg): agent state detection (unmanaged/adopted/managed/absent)"

### E-3 — Projector (writes to ~/.openclaw/* and ~/.bakin/agents/*/)

- **Files:**
  - NEW `src/core/agent-packages/projector.ts`
  - NEW `tests/agent-packages/projector.test.ts`
- **Deps:** A-3, A-4, E-2
- **Complexity:** L
- **Acceptance:**
  - `projectPackage({ stagingDir, manifest, mode: 'fresh' | 'adopt' | 'update', existingProjections })`:
    - **Workspace files** (managed mode only): copy `workspace/*.md` to `{workspace}/<file>` (skipping if `.userEdited`); write `.installedBy` sidecar with sha
    - **Skills** (kind:"agent" → per-agent; kind:"skill-pack" → global): recursively copy `skills/<name>/` to projection target; write `.installedBy` sidecar in projection root
    - **Assets**: copy each `assets/<file>` to `~/.bakin/agents/<id>/<file>`; write sidecar
    - **Lesson markers** (always): inject empty `<!-- bakin:lesson-catalog -->` block + per-lesson blocks for `enabled` lessons into SOUL.md (using phase A-4 helper); record `lesson-marker` projections in lockfile entry
    - **Adopt mode**: skip workspace files, only inject markers
    - **Update mode**: skip files marked `.userEdited`; refresh non-edited workspace files only if `--refresh-template` flag passed; always update markers; always overwrite skills (drift policy)
    - Returns `{ projections: ProjectionEntry[], skipped: SkippedEntry[] }` for lockfile insertion
  - **Atomic** at the package level: any error mid-projection → rollback all writes from this projection (track them in a write-log, undo on failure)
  - Tests:
    - Fresh install of Pixel package: assert all expected files exist with correct sha + sidecars
    - Adopt mode: existing SOUL.md preserved, markers injected
    - User-edited file: skipped, sidecar untouched, no error
    - Mid-flight failure: rollback works (inject failure after 3 files, assert all 3 reverted)
- **Commit boundary:** ⓮ "feat(agent-pkg): projector with rollback"

### E-4 — Dependency resolver (for V1 — single level)

- **Files:**
  - NEW `src/core/agent-packages/dependency-resolver.ts`
  - NEW `tests/agent-packages/dependency-resolver.test.ts`
- **Deps:** E-1
- **Complexity:** M
- **Acceptance:**
  - `resolveDependencies(manifest): Promise<ResolvedDep[]>` — for each dep, fetch source (E-1), parse manifest, return shape needed by installer
  - **V1: single-level only**, no transitive resolution (those land in phase H)
  - Topological sort: leaves first
  - Cycle detection: error
  - Tests: empty deps, single dep, two deps
- **Commit boundary:** ⓯ "feat(agent-pkg): dependency resolver (single-level)"

### E-5 — Installer (orchestrator)

- **Files:**
  - NEW `src/core/agent-packages/installer.ts`
  - NEW `tests/agent-packages/installer.test.ts`
  - NEW `tests/agent-packages/installer-integration.test.ts` (against real `agents/pixel/`)
- **Deps:** A-2, A-3, E-1, E-2, E-3, E-4, runtime agent adapter
- **Complexity:** L
- **Acceptance:**
  - `installPackage({ source, type, mode: 'fresh' | 'adopt', adoptAgentId?, replace?, installAs? }): Promise<InstallResult>`:
    1. Acquire `~/.bakin/packages/.lock` (R-8 mitigation)
    2. Fetch source (E-1) → staging
    3. Validate manifest (A-1)
    4. Resolve dependencies (E-4)
    5. Pre-flight collision check against lockfile
    6. For `kind: "agent"` + `mode === 'fresh'`: call `runtime.agents.create()`; on `mode === 'adopt'`: verify agentId exists, set `--adopt`
    7. Project package + dependencies (E-3)
    8. Update lockfile entry with all projections + commitSha + dep ref-counts
    9. Append audit event (CC-1 — `agent_pkg.installed` or `agent_pkg.adopted`)
    10. Cleanup staging on success
    11. Release lock
  - On any failure: rollback projections (E-3), no lockfile mutation, no audit event, error message + cleanup staging
  - Integration test: install `./agents/pixel` end-to-end against temp homes; verify lockfile, projected files, audit entry written; re-install (idempotency check) → no-op
- **Commit boundary:** ⓰ "feat(agent-pkg): installer (fresh + adopt)"

### E-6 — Removal flow

- **Files:**
  - NEW `src/core/agent-packages/uninstaller.ts`
  - NEW `tests/agent-packages/uninstaller.test.ts`
- **Deps:** E-5
- **Complexity:** M
- **Acceptance:**
  - `removePackage({ packageId, keepBlocks?, deleteAgent? }): Promise<RemoveResult>`:
    1. Read lockfile entry
    2. For each projection: remove file (skipped if `.userEdited`); remove sidecar
    3. Remove managed blocks from SOUL.md (unless `keepBlocks`)
    4. Decrement dep ref-counts; if any drops to 0, recursively remove the dep
    5. If `deleteAgent`: call `removeAgent()` from openclaw-adapter
    6. Remove lockfile entry
    7. Append audit event
  - **Refuses** to remove if any dependent packages still ref-count it
  - Tests cover all 3 modes (default, keep-blocks, delete-agent), shared dep ref-counting
- **Commit boundary:** ⓱ "feat(agent-pkg): uninstaller with ref-counted dep cleanup"

### E-7 — Update flow

- **Files:**
  - NEW `src/core/agent-packages/updater.ts`
  - NEW `tests/agent-packages/updater.test.ts`
- **Deps:** E-5
- **Complexity:** M
- **Acceptance:**
  - `updatePackage({ packageId, refreshTemplate? }): Promise<UpdateResult>`:
    1. Read lockfile entry → fetch fresh source from same `source` + same `ref` (or new ref if user passes one — V1.5 perhaps; V1 only refreshes against the recorded ref to detect upstream tag movements)
    2. If new commitSha matches recorded: no-op (`already-up-to-date`)
    3. Otherwise: re-project (E-3 update mode) — workspace files only refreshed if `--refresh-template` flag, skills always re-projected, markers always rewritten
    4. Update lockfile commitSha + projections shas
    5. Append audit event `agent_pkg.updated`
  - **Does NOT touch** `defaultModel` or `dispatchableBy` in openclaw.json (per settled decision Q5)
  - Tests: same-sha no-op, sha mismatch updates, --refresh-template overwrites workspace files
- **Commit boundary:** ⓲ "feat(agent-pkg): update flow"

### Phase E verification gate

- **Manual smoke test (Roscoe):** `BAKIN_HOME=/tmp/bakin-smoke OPENCLAW_HOME=/tmp/openclaw-smoke bun run server.ts &`; then `bakin agents install ./agents/pixel`; verify resulting tree by hand
- All integration tests green
- Lockfile schema round-trips cleanly through install → update → remove
- **DO NOT run against real `~/.openclaw/`** until phase G readiness gate
- Total: 7 commits

---

## Phase F — CLI + REST API + Onboarding

**Goal:** User-visible commands and HTTP endpoints. After this phase, Roscoe can `bakin agents install ./agents/pixel` from a real terminal (against test homes) and see the result through Teams UI's existing API surface (UI rendering comes in phase I).

**Parallel with:** G, H (no shared files).

### F-1 — CLI subcommands

- **Files:**
  - UPDATE `cli/bakin.ts` (HTTP-client layer)
  - UPDATE `src/core/cli.ts` (binary dispatcher — delegate to `cli/bakin.ts` like `dev` already does)
- **Deps:** F-2 (REST API needs to exist first since CLI is HTTP-client)
- **Complexity:** M
- **Acceptance:**
  - `bakin agents install <source> [--adopt <agent-id>] [--install-as <id>] [--replace]`
  - `bakin agents list [--json]`
  - `bakin agents remove <id> [--keep-blocks] [--delete-agent]`
  - `bakin agents update [<id>] [--refresh-template]`
  - `bakin agents lessons list <agent-id>`
  - `bakin agents lessons enable <agent-id> <lesson-id>`
  - `bakin agents lessons disable <agent-id> <lesson-id>`
  - `bakin packages list [--json]`
  - `bakin packages install <source>` (kind inferred from manifest)
  - `bakin packages remove <id>` (refuses with refCount > 0)
  - `bakin packages update [<id>]`
  - `bakin agents --help` and `bakin packages --help` show full surface
  - Tests under `tests/cli/agents.test.ts` mock the HTTP layer via fetch interception
- **Commit boundary:** ⓳ "feat(cli): agents + packages subcommands"

### F-2 — REST handlers

- **Files:**
  - NEW `packages/host/src/api/agents/install.ts` (POST)
  - NEW `packages/host/src/api/agents/list.ts` (GET — already may collide w/ team plugin's listAgents; namespace as `/api/agents/packages` if team owns `/api/agents`)
  - NEW `packages/host/src/api/agents/remove.ts` (DELETE [agentId])
  - NEW `packages/host/src/api/agents/update.ts` (POST)
  - NEW `packages/host/src/api/agents/adopt.ts` (POST)
  - NEW `packages/host/src/api/agents/lessons/list.ts` (GET)
  - NEW `packages/host/src/api/agents/lessons/toggle.ts` (POST)
  - NEW `packages/host/src/api/packages/{install,list,remove,update}.ts`
  - UPDATE `server.ts` route dispatch (the file is dispatch-by-file-tree style based on existing structure — verify)
  - NEW `tests/api/agents-install.test.ts`
- **Deps:** Phase E
- **Complexity:** L
- **Acceptance:**
  - All routes return JSON; bodies validated with zod (CC reuse)
  - `POST /api/agents/install` body: `{ source: string, type: 'local' | 'github', adopt?: string, replace?: boolean, installAs?: string }`
  - REST tests cover happy paths + zod refusal paths
  - **API path naming:** spec says `/api/plugins/team/packages/...` but that couples team plugin to the install surface. Land at top-level `/api/agents/...` and `/api/packages/...` instead (cleaner, doesn't bind to team plugin lifecycle). Update spec at end of phase.
- **Commit boundary:** ⓴ "feat(api): agents + packages routes"

### F-3 — Onboarding component (`agent-assets`)

- **Files:**
  - NEW `src/core/onboarding/agent-assets.ts`
  - UPDATE `src/core/onboarding/index.ts` (orchestrator — register new component)
  - NEW `tests/cli/install-agent-assets.test.ts`
- **Deps:** Phase E (specifically uninstaller + drift detection from doctor — but doctor checks land in phase I, so this component initially does nothing more than read the lockfile and report)
- **Complexity:** M
- **Acceptance:**
  - Mirrors `plugin-assets.ts` shape: `OnboardingComponent { name: 'agent-assets', check, install }`
  - `check()`: read lockfile, for each managed package iterate projections, return CheckResult with `{ totalAvailable, missing, drifted, installed, userEdited }`
  - `install()`: re-project missing files, repair drift (only if NOT user-edited)
  - `bakin check agent-assets` and `bakin install agent-assets` (delegated through `cli/bakin.ts` already by precedent — verify)
  - **Important:** drift detection logic shared with phase I doctor checks — don't duplicate; lift into a helper in phase I
- **Commit boundary:** ㉑ "feat(onboarding): agent-assets check + install component"

### F-4 — Lesson file indexing for search

- **Files:**
  - UPDATE `plugins/team/index.ts` (register new content type `agent-lessons`)
  - UPDATE `plugins/team/lib/...` (file-backed registration — uses existing helper)
  - NEW `tests/plugins/team-lesson-search.test.ts`
- **Deps:** F-2
- **Complexity:** S
- **Acceptance:**
  - Team plugin calls `ctx.search.registerFileBackedContentType({ contentType: 'agent-lessons', glob: '~/.bakin/packages/agents/*/lessons/*.md', extractFacets: { packageId, agentId, lessonId, tags, enabled } })`
  - Watcher auto-syncs on file changes
  - Enable/disable toggles in F-2 trigger `ctx.search.update()` to refresh `enabled` facet
  - Test: index 3 lesson files, query, verify all found; toggle one off, query with facet filter `enabled:true`, verify only 2
- **Commit boundary:** ㉒ "feat(team): lesson file search indexing"

### Phase F verification gate

- All CLI commands return correct exit codes
- REST routes pass integration tests
- `bakin check agent-assets` returns sensible report against test home
- Total: 4 commits

---

## Phase G — Agent Backfill (8 commits)

**Goal:** Convert remaining 7 agents (after Pixel) into packages. Each agent is one independent commit, so any single regression rolls back independently.

**Parallel with:** F, H (no shared files).

### G-0 — Pre-flight: backup real `~/.openclaw/`

- **Files:** none in repo
- **Deps:** Phase E green
- **Complexity:** S
- **Acceptance:**
  - Roscoe runs `cp -r ~/.openclaw ~/.openclaw.bak.$(date +%Y%m%d)` manually
  - Confirmed before any phase-G install touches real home
- **Commit boundary:** none — manual operational step

### G-1 through G-7 — Repackage Rolo, Jessica-fetcher, Scout, Zen, Nemo, Basil, Patch

Each follows the **same template** as phase B (snapshot → convert → validate against schema):

- **Files per agent:**
  - NEW `agents/<id>/.snapshot/` (gitignored)
  - NEW `agents/<id>/bakin-package.json`
  - NEW `agents/<id>/workspace/{SOUL,IDENTITY,AGENTS,TOOLS}.md`
  - NEW `agents/<id>/skills/<name>/SKILL.md` (only for agents with current skills; many won't have any)
  - NEW `agents/<id>/lessons/*.md` (extracted from current SOUL.md)
  - NEW `agents/<id>/assets/{avatar.jpg,...}` (lifted from `~/.bakin/agents/<id>/`)
  - NEW `agents/<id>/README.md`
- **Deps per agent:** G-0; previous G commits don't gate on each other
- **Complexity per agent:** M
- **Acceptance per agent:**
  - Manifest validates
  - Test install against TEMP `OPENCLAW_HOME` works (separately verified per agent before commit)
  - Roscoe manually inspects extracted lessons for accuracy
- **Commit boundary:** ㉓-㉙ — one commit per agent: "feat(agents): rolo as package", ..., "feat(agents): patch as package"

### G-8 — Real-machine adoption

- **Files:** none in repo
- **Deps:** All G-1 through G-7
- **Complexity:** L (operational)
- **Acceptance:**
  - For each agent in {pixel, rolo, jessica-fetcher, scout, zen, nemo, basil, patch}: run `bakin agents install ./agents/<id> --adopt <id>` against REAL `~/.openclaw/`
  - Verify each agent's existing customizations preserved
  - Verify `bakin agents list` shows all 8 as `adopted` (NOT `managed` — they were adopted, not freshly installed)
  - `bakin doctor` reports clean
  - Roscoe / main remain `unmanaged`
- **Commit boundary:** ㉚ "chore(migration): adopt 8 agents into package management"

### Phase G verification gate

- `~/.openclaw.bak.<date>` retained (rollback path)
- `bakin doctor` clean
- Each agent still functions via `bakin agents send <id> "test message"` (smoke test)
- Total: 8 commits

---

## Phase H — Composition (Standalone Packs + Transitive Deps)

**Goal:** Make `kind: "skill-pack" | "workflow-pack" | "lesson-pack"` first-class. Add transitive dependency resolution + ref-counting + `installAs` collision aliasing.

**Parallel with:** F, G (no shared files).

### H-1 — Standalone pack install (single-source)

- **Files:**
  - UPDATE `src/core/agent-packages/installer.ts` (handle non-agent kinds)
  - UPDATE `src/core/agent-packages/projector.ts` (skill-pack → global `~/.openclaw/skills/`; lesson-pack → just installs files at package source dir, no SOUL.md mutation; workflow-pack → registry only)
  - NEW `tests/agent-packages/standalone-packs.test.ts`
- **Deps:** Phase E
- **Complexity:** M
- **Acceptance:**
  - `bakin packages install <skill-pack-source>`: skills project to `~/.openclaw/skills/<name>/`; lockfile entry with `refCount: 0` (no agent depends on it yet)
  - `bakin packages install <workflow-pack-source>`: workflows registered in source registry (phase C); no fs projection beyond storing the package source
  - `bakin packages install <lesson-pack-source>`: lesson files indexed for search, made available via `bakin agents lessons enable <agent> <lesson>` from any agent
  - Tests cover each kind end-to-end
- **Commit boundary:** ㉛ "feat(agent-pkg): standalone skill-pack/workflow-pack/lesson-pack install"

### H-2 — Transitive dependency resolution

- **Files:**
  - UPDATE `src/core/agent-packages/dependency-resolver.ts` (recursive)
  - NEW `tests/agent-packages/transitive-deps.test.ts`
- **Deps:** H-1
- **Complexity:** M
- **Acceptance:**
  - Recursively fetch + parse manifests; build dep graph
  - Cycle detection (error if cycle)
  - Topological sort
  - Confirm prompt at >5 packages or >25 MB total (CC-3 settings)
  - Tests: 3-deep dep chain installs correctly
- **Commit boundary:** ㉜ "feat(agent-pkg): transitive dependency resolution"

### H-3 — Ref-counting on dep removal

- **Files:**
  - UPDATE `src/core/agent-packages/uninstaller.ts`
  - UPDATE `tests/agent-packages/uninstaller.test.ts`
- **Deps:** H-1
- **Complexity:** S
- **Acceptance:**
  - Remove agent A that depends on skill-pack X (refCount 1) → X also removed
  - Remove agent A that depends on skill-pack X (refCount 2 — A and B) → X kept, refCount → 1
  - `bakin packages remove X` with refCount 1 → refused with `still required by [B]`
  - Tests cover each scenario
- **Commit boundary:** ㉝ "feat(agent-pkg): ref-counted dep cleanup"

### H-4 — Collision aliasing (`installAs`)

- **Files:**
  - UPDATE `src/core/agent-packages/installer.ts` (resolve installAs from manifest deps + CLI flag)
  - UPDATE `src/core/agent-packages/projector.ts` (use resolved id for projection target)
  - NEW `tests/agent-packages/collision.test.ts`
- **Deps:** H-1
- **Complexity:** M
- **Acceptance:**
  - Same skill name + same sha → no-op
  - Same skill name + different sha → refuse install (clear error)
  - Resolved via `dependencies[].installAs: "alt-image-generation"` in manifest → project under alt name
  - Resolved via CLI `--install-as <id>` for top-level package collision
  - `--replace` flag overrides + warns
  - Tests: each scenario
- **Commit boundary:** ㉞ "feat(agent-pkg): installAs collision aliasing"

### Phase H verification gate

- All composition tests green
- Real-machine smoke test (manual): install Pixel package with a fake `bakin-skills-visual` dep; verify lockfile shows nested deps + correct refCounts
- Total: 4 commits

---

## Phase I — Teams UI + Doctor Drift Checks + Curated Catalog

**Goal:** Visible UI surface for the whole feature. Doctor reports drift. Curated browser shows recommendations.

**Parallel with:** none (last major feature phase).

### I-1 — Doctor drift checks

- **Files:**
  - NEW `src/core/agent-packages/doctor-checks.ts`
  - UPDATE `src/core/doctor.ts` (call new check function)
  - NEW `tests/core/doctor-agent-pkg.test.ts`
- **Deps:** Phase E (uses projector's drift detection helpers — share via shared lib)
- **Complexity:** M
- **Acceptance:**
  - `checkAgentPackages(): Promise<DiagnosticResult[]>`:
    - For each lockfile package, iterate projections, recompute sha, compare with sidecar
    - Drift → `warn` with `autoFixable: true` (unless `.userEdited`)
    - Missing projection → `warn`
    - Broken markers → `error`
    - Lockfile says X projection exists, fs says it doesn't → `warn`
    - Template-update-available (commitSha differs from latest source) → `warn` not autoFixable
  - Doctor `--fix` repairs drift via projector (E-3 update mode)
  - Tests: simulate each failure mode
- **Commit boundary:** ㉟ "feat(doctor): agent-package drift checks"

### I-2 — Teams UI components

- **Files:**
  - NEW `plugins/team/components/package-state-badge.tsx`
  - NEW `plugins/team/components/adopt-dialog.tsx`
  - NEW `plugins/team/components/lesson-toggle-list.tsx`
  - NEW `plugins/team/components/curated-browser.tsx`
  - UPDATE `plugins/team/components/team-grid.tsx` (badges)
  - UPDATE `plugins/team/components/agent-detail.tsx` (adopt + lessons tabs)
  - NEW `plugins/team/components/install-dialog.tsx` (entry point — local path or github URL)
- **Deps:** F-2
- **Complexity:** L
- **Acceptance:**
  - Team grid shows state badge per agent (`unmanaged` gray, `adopted` blue, `managed` green, `drifted` yellow, `update-available` orange)
  - Click on `unmanaged` agent → "Adopt with package" button opens adopt dialog
  - Adopt dialog: source input (URL or path), package preview (manifest summary), confirm
  - Agent detail page: "Lessons" tab with toggle list (each lesson w/ title, tags, enabled toggle)
  - "Install agent" button on team page opens install dialog (local path or github URL)
  - "Browse curated" button opens curated-browser (reads `/api/curated`)
  - All UI updates via SSE hooks (existing pattern) — lesson toggle invalidates the toggle list query
- **Commit boundary:** ㊱ "feat(team): package state UI + adopt + lessons"

### I-3 — Curated catalog

- **Files:**
  - NEW `packages/host/src/data/curated-agents.json`
  - NEW `packages/host/src/api/curated/list.ts` (GET /api/curated)
  - UPDATE `scripts/generate-embedded-assets.ts` (walk `packages/host/src/data/`, EXCLUDE `agents/`)
  - UPDATE `tests/scripts/generate-embedded-assets.test.ts` (verify exclusion)
  - NEW `tests/api/curated.test.ts`
- **Deps:** I-2 (UI consumer)
- **Complexity:** S
- **Acceptance:**
  - `curated-agents.json` initial entries: Pixel, Rolo, Jessica (when Roscoe's repos go live, point at github URLs; otherwise leave as TODO entries)
  - Schema in `curated-agents.json`:
    ```json
    [
      { "id": "pixel", "name": "Pixel", "source": "github:madeinwyo/bakin-agent-pixel", "description": "Creative image and design agent", "tags": ["creative"], "icon": "/api/curated/icons/pixel.png" }
    ]
    ```
  - GET /api/curated returns the list
  - Embedded assets builder picks up `curated-agents.json` and explicitly does NOT bundle `agents/` (verified by test)
- **Commit boundary:** ㊲ "feat(team): curated agent catalog"

### Phase I verification gate

- Manual UI smoke: install Pixel package via UI → state changes to `managed` → toggle a lesson → SOUL.md updates
- `bakin doctor` reports drift after manually mutating a projected file
- Total: 3 commits

---

## Phase J — Documentation + Final Pass

**Goal:** Documentation accurate, tests clean, ready for first user.

### J-1 — Update CLAUDE.md

- **Files:**
  - UPDATE `CLAUDE.md` (Architecture section: add agent-packages primitive; Plugin System section: add agent packages distinction; Key Patterns section: add Agent Package Pattern; Code Conventions: extend test isolation rule; Reference: add link to agent-packages-authoring.md)
- **Deps:** all earlier phases
- **Complexity:** M
- **Acceptance:**
  - CLAUDE.md accurately describes the new primitive
  - Test isolation rule explicitly mentions OpenClaw home mocking
  - The CLI surface section lists all new agent + packages commands
- **Commit boundary:** ㊳ "docs(claude): agent-packages primitive"

### J-2 — `.claude/knowledge/` updates

- **Files:**
  - UPDATE `.claude/knowledge/agent-system.md` (full overhaul)
  - NEW `.claude/knowledge/agent-packages.md` (deep dive)
  - UPDATE `.claude/knowledge/team-plugin.md` (UI surface additions)
  - UPDATE `.claude/knowledge/repo-architecture.md` (new directories)
  - UPDATE `.claude/knowledge/storage-model.md` (lockfile + ~/.bakin/packages)
- **Deps:** J-1
- **Complexity:** L
- **Acceptance:**
  - `.claude/knowledge/agent-packages.md` covers manifest, lockfile, projection, three states, doctor checks, and migration story
  - Cross-links to `plugin-system.md`, `workflows-plugin.md`, `team-plugin.md`
- **Commit boundary:** ㊴ "docs(agent-packages): deep reference"

### J-3 — Author walkthrough doc

- **Files:**
  - NEW `docs/agent-packages-authoring.md`
- **Deps:** J-2
- **Complexity:** M
- **Acceptance:**
  - Hands-on walkthrough mirroring `docs/plugin-authoring.md` style
  - Covers: package shape, manifest fields, lesson file frontmatter, marker semantics, dependencies, installAs, testing locally with `bakin agents install ./my-agent`, publishing to GitHub
- **Commit boundary:** ㊵ "docs: agent-packages authoring guide"

### J-4 — Final test pass + manual smoke

- **Files:** none (test execution only)
- **Deps:** all
- **Complexity:** M
- **Acceptance:**
  - `bun test --isolate` clean across whole repo (not just new tests)
  - `bun run build` clean (vendors → plugins → host shell → compile)
  - Roscoe's manual smoke: install all 8 agents fresh against tmp homes; remove all 8; confirm tmp homes empty (no stranded files)
  - Doctor sweep on real machine clean (`~/.openclaw/` and `~/.bakin/`)
  - **Verification step:** grep entire codebase for hardcoded `~/.openclaw/` or `~/.bakin/` outside CLAUDE.md/SPEC.md/PLAN.md/docs/ → must return zero hits
- **Commit boundary:** ㊶ "test(agent-pkg): final test pass + smoke" (probably an empty commit if no fixes needed; otherwise documents fix-ups)

---

# Commit Strategy

## Principles

1. **Every commit leaves the repo green.** `bun test --isolate` passes, `bun run build` passes, dev server boots cleanly. No "WIP" commits.
2. **Every commit is independently revertable.** No commit reaches into a future commit's territory. Phase A schemas don't reference phase E paths; phase E imports phase A but doesn't pre-shape itself for phase H composition.
3. **Squash within phase, but not across phases.** If a single task in phase A spans 3 days of incremental polishing, those local commits get squashed before merge — but A-1 stays separate from A-2 because reverting A-1 alone needs to be possible.
4. **Conventional commits with scope.** Project convention: `feat(agent-pkg): manifest schema + types`, `refactor(doctor): lift managed-block helper`, `feat(team): package state UI`, etc.
5. **Tag rollback boundaries.** Tag the tip of each phase: `agent-pkg-phase-a`, `agent-pkg-phase-b`, ..., `agent-pkg-phase-j`. If phase H reveals a regression in E that's hard to fix forward, we revert to `agent-pkg-phase-g`.
6. **Snapshot before destructive operations.** Phase G-0 backs up `~/.openclaw/` to `~/.openclaw.bak.<date>/`. The backup gets retained until phase J-4 completes.

## Commit Numbering

| # | Phase | Commit message (paraphrased) | Touches |
|---|-------|------------------------------|---------|
| ❶ | A-1 | feat(agent-pkg): manifest schema + types | core lib + tests |
| ❷ | A-2 | feat(agent-pkg): lockfile schema + atomic IO | core lib + tests |
| ❸ | A-3 | feat(agent-pkg): provenance + user-edit markers | core lib + tests |
| ❹ | A-4 | feat(agent-pkg): managed-block primitives | core lib + tests |
| ❺ | A-5 | test(agent-pkg): isolation harness + helpers | tests |
| ❻ | B-1 | chore(migration): snapshot script for agent extraction | scripts |
| ❼ | B-2 | feat(agents): pixel as reference package | agents/pixel/ |
| ❽ | C-1 | feat(workflows): agent-package source kind in registry | plugins/workflows + tests |
| ❾ | C-2 | feat(workflows): agent-package skill loader tier | plugins/workflows + tests |
| ❿ | C-3 | feat(server): load agent-package sources at startup | server.ts + core |
| ⓫ | D-1 | refactor(doctor): lift managed-block helper to shared lib | src/core/doctor.ts |
| ⓬ | E-1 | feat(agent-pkg): source fetcher (local + github) | core + tests |
| ⓭ | E-2 | feat(agent-pkg): agent state detection | core + tests |
| ⓮ | E-3 | feat(agent-pkg): projector with rollback | core + tests |
| ⓯ | E-4 | feat(agent-pkg): dependency resolver (single-level) | core + tests |
| ⓰ | E-5 | feat(agent-pkg): installer (fresh + adopt) | core + tests + integration |
| ⓱ | E-6 | feat(agent-pkg): uninstaller with ref-counted dep cleanup | core + tests |
| ⓲ | E-7 | feat(agent-pkg): update flow | core + tests |
| ⓳ | F-1 | feat(cli): agents + packages subcommands | cli + core/cli + tests |
| ⓴ | F-2 | feat(api): agents + packages routes | api + tests |
| ㉑ | F-3 | feat(onboarding): agent-assets check + install component | onboarding + tests |
| ㉒ | F-4 | feat(team): lesson file search indexing | team plugin + tests |
| ㉓-㉙ | G-1..7 | feat(agents): rolo/jessica/scout/zen/nemo/basil/patch as package | agents/<id>/ — 7 commits |
| ㉚ | G-8 | chore(migration): adopt 8 agents into package management | none in repo (operational) |
| ㉛ | H-1 | feat(agent-pkg): standalone skill-pack/workflow-pack/lesson-pack install | core + tests |
| ㉜ | H-2 | feat(agent-pkg): transitive dependency resolution | core + tests |
| ㉝ | H-3 | feat(agent-pkg): ref-counted dep cleanup | core + tests |
| ㉞ | H-4 | feat(agent-pkg): installAs collision aliasing | core + tests |
| ㉟ | I-1 | feat(doctor): agent-package drift checks | core + doctor + tests |
| ㊱ | I-2 | feat(team): package state UI + adopt + lessons | team plugin |
| ㊲ | I-3 | feat(team): curated agent catalog | host data + api + scripts + tests |
| ㊳ | J-1 | docs(claude): agent-packages primitive | CLAUDE.md |
| ㊴ | J-2 | docs(agent-packages): deep reference | .claude/knowledge/ |
| ㊵ | J-3 | docs: agent-packages authoring guide | docs/ |
| ㊶ | J-4 | test(agent-pkg): final test pass + smoke | (empty / fix-ups) |

**Total: ~42 commits** across 10 working phases (A–J).

## Per-commit checklist (gate before push)

Before any of the above commits land:

1. **Tests pass:** `bun test <touched-test-paths> --isolate`
2. **Full suite still passes:** `bun test --isolate`
3. **Build clean:** `bun run build` (or whatever the project's full-build target is)
4. **TypeCheck clean:** if a `tsc --noEmit` step exists, it passes
5. **Manual sanity:** for any phase that touches the dev server, `bun run dev` boots without crashing
6. **No stray ~/.openclaw/ or ~/.bakin/ writes** (grep the diff for hardcoded paths)
7. **Audit message** (commit body) explains *why*, not just *what*

## Tag-based rollback path

If phase X reveals a regression in phase X-1 that's hard to forward-fix:

```bash
# Find the tag at end of phase X-2 (last known-good)
git tag -l 'agent-pkg-phase-*'

# Reset to that tag — will need explicit user confirmation per CLAUDE.md
# (this is destructive; ask before running)
```

The 8 backfilled-agent commits (㉓-㉙) are individually revertable: if Pixel-package install works but Rolo's package has malformed lesson frontmatter, `git revert <Rolo's commit hash>` and the rest stays.

---

# Settled Build-Phase Decisions

All previously-open questions resolved:

1. **Skill projection scope rule** (settled):
   - **Agent-package skills** (bundled OR via `dependencies.skills`) → workspace-specific at `{workspace}/skills/<name>/`
   - **Standalone `kind: "skill-pack"` skills** → global at `~/.openclaw/skills/<name>/`
   - **Plugin-shipped skills** → global (unchanged)
   - Phase E-3 projector implements this; phase H-1 standalone install path uses the global branch.
2. **Transitive deps confirmation** — One y/N per `bakin agents install` invocation. CLI displays the full dep tree; user confirms once at the agent-package install boundary, never per individual dep. Phase H-2.
3. **API paths** — `/api/agents/...` and `/api/packages/...` at top level. SPEC.md updated to match. Phase F-2.
4. **No binary embedding of agent packages** — `agents/<id>/` directories stay out of the binary. User-installed agent packages live in `~/.bakin/packages/agents/<id>/` and update without a binary rebuild. Phase I-3 verifies via embedded-assets test.
5. **Standalone pack patterns** — Skill-pack ships globally (matches plugin pattern). Workflow-pack ships into source registry only. Lesson-pack indexes for search and is attachable to any agent via `bakin agents lessons enable`. Phase H-1.

---

# Verification Gates Summary

| Gate | When | What passes |
|------|------|-------------|
| Phase A | After ❺ | `bun test tests/agent-packages/` |
| Phase B | After ❼ | manifest validates, manual review of conversion |
| Phase C | After ❿ | workflow tests pass, source registry has new tier |
| Phase D | After ⓫ | doctor regression test byte-equal |
| Phase E | After ⓲ | install Pixel against tmp homes works E2E |
| Phase F | After ㉒ | CLI + REST work, UI ready for phase I |
| Phase G | After ㉚ | all 8 agents adopted on real machine, doctor clean |
| Phase H | After ㉞ | composition tests pass |
| Phase I | After ㊲ | UI smoke + doctor drift detected manually |
| Phase J | After ㊶ | full repo green, no hardcoded paths, docs accurate |

The gate between G and H deserves particular care — that's the last point to roll back to a snapshot of `~/.openclaw/` before backfill.

---

**End of plan.**
