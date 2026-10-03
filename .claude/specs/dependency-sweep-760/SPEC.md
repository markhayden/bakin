# Spec: App dependency sweep (#760)

Status: APPROVED 2026-10-03 (interview complete; see PLAN.md for tasks)
Issue: https://github.com/markhayden/bakin/issues/760
Companion: `PLAN.md` (tasks + commit strategy, written after this spec is approved)
Research dossier: upstream breaking-change notes gathered 2026-10-03 (scratchpad
`dep-research.md`; the parts that matter are folded into §4 below)

## 1. Objective

Bring every dependency in this repo (root app workspace, `docs/` workspace,
`packages/adapter-pi`) to today's latest release, delete the dependencies nothing
imports, and leave behind a repeatable runbook so the next sweep is a procedure
rather than an archaeology project. Priority is tech-debt reduction: no shims, no
compatibility layers, no "keep the old import style because it still works".

**User:** the single operator of this machine (the live Bakin on 3737 runs the
Pi runtime from this checkout) and the compiled-binary box `margo`, which picks
these changes up at the next `v*` release.

**Success looks like:** `bun outdated` at root, `docs/`, and
`packages/adapter-pi` lists only the deliberately deferred items (§3.3), every CI
gate is green on `main`, 3737 has soaked each change set, and the knowledge base
explains the couplings that made this sweep non-trivial.

### Decisions already taken in the interview (2026-10-03)

| # | Decision | Chosen |
|---|---|---|
| D1 | Scope | Everything behind: root app deps, `docs/` workspace, Pi adapter SDK. bun stays 1.3.13. |
| D2 | Target versions | Latest as of the day each PR is cut. Nothing forced past a declared peer range. |
| D3 | Unused deps | Delete `nodemailer`, `@types/nodemailer`, `@tanstack/router-devtools` (root) and `zod`, `@xyflow/react` (docs). |
| D4 | PR shape | Sequential PRs, one at a time, each cut from `main` after the previous merges. One commit per package group inside a PR; squash merge = rollback unit on `main`. |
| D5 | Merge gate | Full local gate + CI green. **No manual sign-off needed for this stack** (operator, 2026-10-03). |
| D6 | Workspace | Dedicated git worktree; 3737 keeps serving `main`; after each merge: fast-forward this checkout, `bun install`, restart `bakin dev`. |
| D7 | TypeScript | 5.9.3 → **6.0.3** (own PR). TS 7 deferred: no compiler API until 7.1 (nine `scripts/ui/*` + `scripts/docs/lib/sdk-reference.ts` use it) and typescript-eslint caps at `<6.1`. |
| D8 | ESLint | 9 → **10.12** and **remove `eslint-plugin-react`** (registered, zero rules enabled, runtime-broken on ESLint 10, unmaintained). No replacement plugin. |
| D9 | zod | `~4.3.0` → `~4.6.5` (tilde kept: zod 4 brands schema types with the literal minor; SDK public types expose zod). ONE companion PR in `bakin-bits-official` moves zod/lucide/js-yaml/typescript/eslint/playwright/@types/bun in lockstep and advances its Bakin SDK ref. |
| D10 | Pi SDK | pi-ai + pi-coding-agent 0.85.1 → 1.0.1 in lockstep; LAST PR (13); merge on green, then a real chat turn + image generation against live 3737; revert PR immediately on failure. |
| D11 | Docs | New `.claude/knowledge/dependency-sweeps.md` + CLAUDE.md pointer + fix every doc a bump makes wrong. |
| D12 | Boundaries granted | File follow-up issues + close #760; restart 3737 after each merge; discard local drift in generated files / regenerate tracked artifacts; re-capture UI visual baselines after reviewing diffs. |

### Assumptions I am making (correct me in the review)

1. **Spec lives in `.claude/specs/dependency-sweep-760/`**, matching
   `test-suite-health/SPEC.md` + `PLAN.md`, not a root `SPEC.md`.
2. **zod gets its own PR** (not folded into the minor batch): 4.4/4.5/4.6 carry
   behavior changes (`z.iso.datetime()` requires seconds — 4 call sites;
   string lengths count code points; `z.undefined()` props become required keys;
   lazy error maps on `safeParse` — 96 call sites), and 134 files import zod.
3. **`@types/bun` stays on the 1.3.x line** (1.3.13) because the runtime is
   pinned there; types for a newer bun than the one that runs is a lie waiting
   to compile.
4. **happy-dom 20.11.1 → 20.14.5 is its own commit** inside PR 1 (one variable
   at a time — the bun × happy-dom 2×2 lesson from #755).
5. **Toolchain PRs (TS 6, ESLint 10) run right after the minor batch**, so every
   later PR is gated by the final lint/typecheck toolchain and a diagnostic
   introduced by a later bump is attributable to that bump.
6. **Worktree path** `../bakin-wt-deps` (a sibling, so the stylesheet build's
   `../bakin-bits-official` `@source` path resolves). Branch names
   `chore/deps-NN-<topic>`; commit subjects `chore(deps): …` for manifest moves,
   `refactor(<scope>): …` for the code adaptations a bump forces.
7. **Vendor/plugin bundles and the embedded-assets manifest are regenerated and
   committed in every PR that moves a browser dependency** (react, base-ui,
   lucide, react-router, xyflow, dnd-kit, dagre, tailwind): chunk hashes change,
   and the tracked manifest must match or the embedded-assets architecture test
   fails.
8. **Lucide deprecated aliases are renamed to canonical names** in the lucide
   PR (9 aliases across ~58 files, e.g. `Trash2`→`Trash`, `AlertTriangle`→
   `TriangleAlert`). Aliases still exist in 1.51 but are debt.
9. **No release is cut in this initiative.** `margo` receives sharp 0.35 and
   Pi 1.0 at the next `v*` release; its media store self-heals (receipt
   `sharpVersion` mismatch → doctor → repair reinstall).

## 2. Current state (measured 2026-10-03)

- bun 1.3.13 (`.bun-version`), bakin `main` @ 7f3fed7db; live 3737 = `bakin dev`
  (pid 28606/28607) from this checkout; `settings.runtime.adapter = pi`.
- Root manifest has 41 dependencies + 36 devDependencies. `bun outdated` lists 47
  behind at root, 11 in `docs/`, 2 in `packages/adapter-pi`.
- Working tree has one uncommitted, build-produced change to
  `packages/host/src/api/_embedded-assets-static.ts` (vendor chunk-hash drift).
  It is discarded before the first fast-forward (D12).

### Blast radius per major (import sites)

| Package | Files | Notes |
|---|---|---|
| `lucide-react` | 130 (119 distinct icons) | 9 icons via deprecated aliases; 11 icon names used as strings in `curated-catalog.json`; workflows `channel-icon.tsx` holds an explicit map |
| `@base-ui/react` | 20, all `packages/ui/src` | 20 sub-modules; `packages/ui/package.json` pins `^1.3.0` too |
| `js-yaml` | 14 (8 use the default import) | plus `@types/js-yaml` |
| `@dnd-kit/*` | 3 (`plugins/tasks/components/`) | `feedback: 'clone'` on `useSortable` (moved in 0.4) |
| `@dagrejs/dagre` | 1 (`plugins/workflows/lib/dagre-layout.ts`) | |
| `sharp` | 9 + `pin-data.ts` + 7 test literals of `0.34.5` | compile external; store installer |
| `ink` | 23 (47 import sites) | `render-to-string.tsx` reads `process.stdout.columns` (fine: it is `process`, not ink's stdout) |
| `typescript` (API) | 9 scripts | reason TS 7 is deferred |
| `eslint-plugin-react` | 1 (config only) | zero rules enabled |
| pi SDK | 9 files, 4 entry points | `bun-static-modules.ts` workaround; `codex-images.ts` uses provider id `openai-codex` |

## 3. Scope

### 3.1 In scope — the PR sequence

Each PR is cut from `main` after the previous one merges. Versions are "latest on
the day the PR is cut"; the numbers below are today's.

| PR | Branch | Contents | Code changes expected |
|---|---|---|---|
| 1 | `chore/deps-01-housekeeping-and-minors` | **Commit a:** remove `nodemailer`, `@types/nodemailer`, `@tanstack/router-devtools`. **Commit b:** `@happy-dom/global-registrator` 20.14.5. **Commit c:** minor/patch batch — `@modelcontextprotocol/sdk` 1.32.0, `@tanstack/react-router` 1.170.41, `@xyflow/react` 12.12.0, `ajv` 8.20.0, `cron-parser` 5.10.1, `discord-api-types` 0.38.56, `shadcn` 4.21.1, `tailwind-merge` 3.7.0, `zustand` 5.0.15, `tailwindcss`/`@tailwindcss/cli`/`@tailwindcss/postcss` 4.3.3, `postcss` 8.5.28, `@testing-library/react` 16.3.3, `@testing-library/user-event` 14.6.7, `axe-core` 4.13.0, `@fontsource/*` 5.3.0. **Commit d:** regenerated vendor bundles + embedded-assets manifest + any ratchet JSON. | MCP SDK 1.32 same-origin redirect policy (check any HTTP client transport use); react-router patch-labelled internal removals (`RouterState.isTransitioning/loadedAt/statusCode`, `RouteMatch.globalNotFound`, Link `data-transitioning`) — grep before bumping; Link options now cached by value. SDK peer range `^1.168.23` stays (two tests pin it). |
| 2 | `chore/deps-02-zod-4.6` | `zod` `~4.3.0` → `~4.6.5` (root + `packages/*` that declare it). | Audit the 4 `z.iso.datetime()` sites for seconds-less inputs; `z.record` key semantics (29 sites); `safeParse` lazy error maps (96 sites — only matters where config is swapped between parse and read). Published-SDK test still asserts `pkg.dependencies.zod`. |
| 3 | `chore/deps-03-typescript-6` | `typescript` 6.0.3. | 6.0 hard errors: our tsconfig already has `esModuleInterop: true`, no `baseUrl`, `moduleResolution: bundler`, explicit `types: ["bun"]`; expect real diagnostics from stricter defaults, fix them properly (no `// @ts-expect-error` carpets). Storybook docgen + the 9 compiler-API scripts must still run. |
| 4 | `chore/deps-04-eslint-10` | `eslint` 10.12.0, `typescript-eslint` 8.71.0, `@eslint/js` (already 10); **remove `eslint-plugin-react`**, its `settings.react` block and the two `off` rules. | ESLint 10: per-file config lookup, JSX identifiers now tracked (no-unused-vars may fire on JSX-only imports — fix, don't silence), `eslint:recommended` adds rules (we already `off` `no-useless-assignment`/`preserve-caught-error`; `no-unassigned-vars` is new). Custom rule already uses `context.sourceCode`. `tests/eslint/*.test.mjs` uses `new Linter({ configType: 'flat' })` — still valid. |
| 5 | `chore/deps-05-react-19.3-ink-8` | **Commit a:** `react`/`react-dom`/`@types/react`/`@types/react-dom` 19.3.0 (root + `docs/`; SDK peers `^19.0.0` unchanged). **Commit b:** `ink` 8.0.0 (`@inkjs/ui` 2.0.0 stays; peer `ink >=5`). **Commit c:** regenerated vendor bundles/manifest. | React 19.3: no breaking changes; watch act-gate for transition timing shifts. ink 8: `minWidth/maxWidth` numbers only, `useStdout().stdout.columns` untyped (we read `process.stdout.columns` — fine), `useInput` drops control sequences. The yoga TDZ is bun 1.3.14's bug, unchanged by ink 8. Run `tests/cli/readonly-logs.test.ts --isolate` first (Ink smoke), then the suite. |
| 6 | `chore/deps-06-base-ui-1.8` | `@base-ui/react` 1.8.0 in root AND `packages/ui/package.json`. | Only OTP Field breaking changes (unused). Observable: Dialog/Popover ignore outside clicks from presses that began before open; Menu submenus hover-open; Form focuses first invalid field; Select/Menu a11y tree changes. **UI pass:** `ui:conformance --full`, `ui:test:visual`, review every baseline diff image for the 16 Dialog / 5 Popover / 5 DropdownMenu / 15 Select / 22 Tooltip / 2 Sheet / 3 Command surfaces, re-capture (D12). `vitest.config.ts` `optimizeDeps.include` lists three base-ui subpaths — keep. |
| 7 | `chore/deps-07-lucide-1` | `lucide-react` 1.51.0. **Commit a:** bump. **Commit b:** rename the 9 deprecated aliases to canonical names. **Commit c:** regenerated bundles/manifest/baselines. | 1.0: brand icons removed (we use none), `aria-hidden="true"` default on every icon (audit icons that carry meaning without text → add `aria-label`; the a11y stories + axe will tell), `absoluteStrokeWidth`→`nonScalingStroke`, `createLucideIcon` data-object signature. Redrawn glyphs (`CircleCheck`, `CircleQuestionMark`) → baseline diffs. String icon names in `curated-catalog.json` (11) and `channel-icon.tsx` map verified against the 1.x export list. |
| 8 | `chore/deps-08-dagre-dndkit-jsyaml` | **Commit a:** `@dagrejs/dagre` 3.1.1. **Commit b:** `@dnd-kit/{abstract,dom,helpers,react}` 0.5.0. **Commit c:** `js-yaml` 5.4.2 + remove `@types/js-yaml`. | dagre 3: `type: module`, bundled types, `Graph<G,N,E>` generics, `layout(g, opts)` unchanged. dnd-kit 0.4: `feedback` option → `plugins: (defaults) => [...defaults, Feedback.configure({ feedback: 'clone' })]` in `task-card.tsx`; `DragDropEvents` type split (grep). js-yaml 5: **no default export** — convert the 8 `import yaml from 'js-yaml'` files to named imports; `load('')` now throws (guard empty files where we parse optional frontmatter/YAML); default schema is CORE (YAML 1.2): `<<` merge keys and `!!timestamp` no longer parse — grep workflow YAML, plugin manifests, package sources for both; `DEFAULT_SCHEMA`/`Type` removed. |
| 9 | `chore/deps-09-sharp-0.35` | `sharp` 0.35.5 + regenerated `pin-data.ts` (libvips 1.2.4 → 1.3.4) + the 7 test literals. | Runbook `.claude/knowledge/media-pipeline.md § Pin-bump`: `bun scripts/generate-media-pin.ts --sharp-version 0.35.5`; `tests/integration/media/compiled-sharp-store.test.ts --isolate` on darwin + confirm linux leg in CI. 0.35: `failOnError`→`failOn`, `format.jp2k`→`jp2`, `limitInputChannels` default 5, AVIF quality mapping changed (thumbnail bytes may shift — check thumb-size assertions), TS named ESM exports (0.35.2). Then `bakin install media` on this box after the 3737 restart (doctor would do it anyway). |
| 10 | `chore/deps-10-vite-8-vitest-5-storybook-10.6` | `vite` 8.3.2, `vitest` 5.0.3, `@vitest/browser-playwright` 5.0.3 (exact-locked to vitest), `storybook` + `@storybook/{react-vite,addon-a11y,addon-docs,addon-vitest}` 10.6.1 (first 10.x admitting vitest 5). | Vitest 5: `clearMocks` default true, strict browser locators, `toHaveTextContent` strict, reports move under `.vitest/`, JUnit reporter writes files (our config already sets `outputFile`), `vi.mock` top-level only. Vite 8: `rollupOptions`→`rolldownOptions` in `.storybook/main.ts` `viteFinal` if used; CJS interop dev==build. Storybook 10.6 MIGRATION: MCP tool renames, `@storybook/csf-plugin` removed. The runner scripts (`scripts/ui/run-*.ts`, `build-storybook.ts`) are re-verified; `ui:test:stories` shards in `ui-visual.yml` must stay green. |
| 11 | `chore/deps-11-playwright-1.63` | `playwright` 1.63.0 + canonical image `mcr.microsoft.com/playwright:v1.63.0-noble` in `scripts/ui/canonical-playwright.mjs`, `.github/workflows/ui-visual.yml` (×5), `tests/ui/architecture/visual-harness.test.ts`; 319 snapshots re-rendered inside the new image. | Own PR: a Chromium bump re-renders every snapshot, so it must not share a diff with vitest 5 semantics. SDK optional peer `^1.60.0` unchanged. The workflow edit is strictly required by the bump (allowed). |
| 12 | `chore/deps-12-docs-astro-7` | `docs/`: `astro` 7.3.5, `@astrojs/react` 7.0.0, `@astrojs/starlight` 0.42.5, `@fontsource/*` 5.3.0, `react`/`react-dom` 19.3.0; **remove `zod` and `@xyflow/react`**; add `@astrojs/markdown-remark` ^7.3 only if we move to the `processor` form. | Astro 6: `entry.slug`→`entry.id` (`PageSidebar.astro:23`), content layer already uses `docsLoader()`. Astro 7: Rust compiler only (strict HTML — unclosed tags error), `compressHTML: 'jsx'` whitespace semantics, `markdown.rehypePlugins` deprecated → `processor: unified({ rehypePlugins })` from `@astrojs/markdown-remark`. Starlight 0.38–0.42: our six overrides (Head, SkipLink, Header, PageTitle, PageSidebar, Footer) are not named in breaking notes; mobile-menu markup/attrs changed (check `docs.css`); `tagline` removed; `autogenerate` must be wrapped in `items`. Gate: `bun run docs:check` + `docs:build:combined`, and `docs:validate:routes`. |
| 13 | `chore/deps-13-pi-sdk-1.0` | `packages/adapter-pi`: `@earendil-works/pi-coding-agent` 1.0.1 (exact) + `@earendil-works/pi-ai` ^1.0.1 — lockstep. | 0.87: `SessionManager` canonical (any `session.agent.state.messages` assignment → `SessionManager.inMemory(...)`/`refreshContext()`), `ContextEditEntry` in `SessionEntry` union (exhaustive switches), `shouldStopAfterTurn` removed. 0.99: images API unified (`createImagesModels` etc. removed — `images.ts`/`codex-images.ts` call the ChatGPT backend directly; verify nothing imports the removed types), `ModelRegistry` now carries non-chat `type`s (filter chat models in eligibility/routing), OpenAI Codex provider relabelled "(legacy)" — id `openai-codex` must still resolve for `codexImageAuth()` and `bun-static-modules.ts`; `builtin:*` extensions and `--no-extensions` semantics vs `settings.runtime.settings.piExtensions`. 1.0: fullscreen TUI default (dev rig `/login` path), shrinkwrap removed. Gate adds `tests/integration/pi/*`, `tests/adapter-pi/compiled-oauth-static.test.ts` (+ its teeth fixture), `bun run build`. **Post-merge:** restart 3737, one real chat turn, one image generation, Health page clear of Pi findings. |
| 14 | bits: `chore/deps-sweep-companion` | In `bakin-bits-official`: `zod ~4.6.5`, `lucide-react ^1.51.0` (+ alias renames), `js-yaml ^5.4.2` (+ named imports, drop `@types/js-yaml`), `typescript ^6.0.3`, `eslint ^10` / `@eslint/js ^10` / `typescript-eslint ^8.71`, `playwright 1.63.0`, `@types/bun ^1.3.13`, `@happy-dom/global-registrator ^20.14`; advance the pinned Bakin SDK ref to the merged `main`; bump each touched plugin manifest patch version (memory: bits-plugin-version-bumps). | Bits CI stays red on the SDK-smoke leg until the next `v*` release publishes the SDK (known pattern). |

Then: file follow-up issues (§3.3), close #760. (13 Bakin PRs + the Bits companion; the plan splits playwright out of the browser-toolchain PR because it re-renders every snapshot.) with a summary table of what moved.

### 3.2 Per-PR gate (the merge bar, D5)

Run in this order, one suite at a time (never two full suites concurrently):

```bash
bun install                      # lockfile regenerated; commit bun.lock
bun run typecheck
bun run lint
bun run check:cycles
bun run lint:home-bypasses
bun run test                     # full suite; zero act warnings; completeness
bun run build:host               # css + vendors + host shell
bun run ui:conformance --quick   # --full for PRs 5, 6, 7, 10
bun run build                    # PRs 5, 9, 13 (compile externals: react/ink, sharp, pi)
bun run docs:check               # PR 12 (and any PR that touches docs/ or SDK d.ts)
```

Then push, open the PR with the gate output summarized, wait for CI (Checks, 3
test shards, stamped shards, completeness, UI visuals when impacted) to go green,
squash-merge. Post-merge: fast-forward this checkout, `bun install`, restart
`bakin dev` on 3737, verify `GET /api/plugins/manifest` and that no stray
process holds 3737/3738.

### 3.3 Out of scope / deferred (each gets a follow-up issue)

- **bun** stays 1.3.13 (issue #760 is explicit). Upstream fixed the TDZ bug in
  bun 1.4.0; the follow-up issue is "re-run the isolation matrix on 1.4.x".
- **TypeScript 7** — blocked until 7.1 ships a compiler API and typescript-eslint
  widens `<6.1.0`.
- **React lint coverage** (`@eslint-react/eslint-plugin`) — a separate decision
  about *adding* rules, not a bump.
- **`@types/bun` 1.4.x** — follows the bun repin.
- Anything else `bun outdated` reveals after the sweep that needs product
  decisions.

## 4. Tech stack and version matrix

Runtime/bundler/test runner: bun 1.3.13 (pinned). React 19.3. TypeScript 6.0.3.
ESLint 10. Vite 8 / Vitest 5 / Storybook 10.6 for the browser UI contract.
Astro 7 / Starlight 0.42 for the docs site. zod 4.6 (tilde). Pi SDK 1.0.1.

Hard couplings (these are the reasons the PRs are ordered as they are):

| Coupling | Rule |
|---|---|
| `ink` ↔ `react` | ink 8 requires react ≥19.3.0 (react first, same PR) |
| `react-dom` ↔ `react` | react-dom 19.3 peers react ^19.3 (bump four packages together incl. `@types/*`) |
| `zod` minor ↔ Bits plugins ↔ published SDK | one minor everywhere; tilde pin; Bits companion PR |
| `pi-ai` ↔ `pi-coding-agent` | lockstep; two pi-ai copies break the static-modules OAuth registration |
| `sharp` devDep ↔ `pin-data.ts` | regenerate the pin whenever the devDep moves |
| `@vitest/browser-playwright` ↔ `vitest` | exact version lock |
| `@storybook/addon-vitest` ≥10.6.1 ↔ `vitest` 5 | 10.6.0 does not admit vitest 5 |
| `@astrojs/starlight` 0.42 ↔ `astro` ≥7.2.10 ↔ `@astrojs/react` 7 ↔ vite 8 | docs PR moves them together |
| `@types/bun` ↔ `.bun-version` | same minor line |
| `typescript` <6.1 ↔ `typescript-eslint` 8.71 | TS 7 deferred |

## 5. Commands

```bash
# work
git worktree add ../bakin-wt-deps -b chore/deps-01-housekeeping-and-minors main
cd ../bakin-wt-deps && bun install
bun outdated                         # root; also: (cd docs && bun outdated); (cd packages/adapter-pi && bun outdated)

# gate (see §3.2 for order and per-PR extras)
bun run typecheck && bun run lint && bun run check:cycles && bun run lint:home-bypasses
bun run test
bun run build:host && bun run ui:conformance --quick
bun run build                        # compile-external PRs
bun run docs:check                   # docs PR

# targeted
bun test tests/cli/readonly-logs.test.ts --isolate                     # Ink smoke (PR 5)
bun test tests/integration/media/compiled-sharp-store.test.ts --isolate # sharp (PR 9)
bun test tests/integration/pi tests/adapter-pi --isolate                # Pi (PR 12)
bun scripts/generate-media-pin.ts --sharp-version 0.35.5               # PR 9
bun run ui:test:visual && bun run ui:baseline:capture                   # after reviewing diffs (PRs 6, 7)

# ship
gh pr create --fill  # body links this spec section; gate output summarized
gh pr checks --watch && gh pr merge --squash --delete-branch

# post-merge on this checkout (3737)
git checkout -- packages/host/src/api/_embedded-assets-static.ts   # once, first time
git pull --ff-only && bun install
kill $(lsof -t -i :3737); cd $REPO && nohup bakin dev > ~/.bakin/logs/dev.out 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3737/api/plugins/manifest
```

## 6. Project structure (what this sweep touches)

```
package.json, bun.lock                 → root manifests (PRs 1–10)
packages/ui/package.json               → @base-ui/react pin (PR 6)
packages/sdk/package.json              → peer ranges (unchanged unless forced)
packages/adapter-pi/package.json       → Pi SDK (PR 13)
docs/package.json, docs/astro.config.mjs, docs/src/components/*.astro → PR 12
packages/core/src/media/pin-data.ts    → regenerated (PR 9)
packages/host/public/vendor/*, packages/host/src/api/_embedded-assets-static.ts → regenerated per browser-dep PR
design-system/{baseline,performance.json,public-api.json,…} → regenerated only when a bump legitimately moves them
eslint.config.mjs                      → PR 4
plugins/tasks/components/task-card.tsx → dnd-kit Feedback plugin (PR 8)
plugins/workflows/lib/dagre-layout.ts  → dagre 3 types (PR 8)
8 js-yaml default-import files         → named imports (PR 8)
~58 files                              → lucide alias renames (PR 7)
.claude/knowledge/dependency-sweeps.md → NEW (PR 1 creates it; later PRs append)
.claude/knowledge/{test-suite-health,tasks-plugin,workflows-plugin,media-pipeline,pi-adapter}.md, CLAUDE.md → targeted updates
```

## 7. Code style for this work

- Manifest ranges follow the repo's existing intent: caret by default, **tilde for
  zod** (minor branding), **exact** where already exact and deliberate (`react`,
  `postcss`, `remark-parse`, `unified`, storybook/vitest stack, pi-coding-agent).
- A bump that forces a code change gets the *idiomatic new form*, not the
  smallest diff:

```ts
// js-yaml 5 — before
import yaml from 'js-yaml'
const doc = yaml.load(text)
// after
import { load as loadYaml } from 'js-yaml'
const doc = loadYaml(text)          // and guard: load('') now throws

// dnd-kit 0.5 — before
useSortable({ id, feedback: 'clone', ... })
// after
import { Feedback } from '@dnd-kit/dom'
useSortable({ id, plugins: (defaults) => [...defaults, Feedback.configure({ feedback: 'clone' })], ... })

// lucide 1 — before
import { Trash2, AlertTriangle } from 'lucide-react'
// after
import { Trash, TriangleAlert } from 'lucide-react'
```

- No `// @ts-expect-error`, `eslint-disable`, or `overrides` in `package.json`
  to get past a bump. If a dependency cannot move cleanly, it is deferred with an
  issue (D2).
- Commits: `chore(deps): bump @base-ui/react to 1.8.0`, `refactor(tasks): move
  dnd-kit feedback to the Feedback plugin (0.4 API)`, `docs(knowledge): …`.

## 8. Testing strategy

- **The suite is the gate** (post-#757): zero act warnings enforced, completeness
  check, 8.5k tests / 0 skip. A dependency that starts scheduling un-acted
  updates FAILS; fix by wrapping the interaction in `act()`, never by deleting
  the assertion or widening a timeout.
- **Toolchain bumps are one variable at a time** (happy-dom own commit; react
  before ink; the Ink smoke file before the suite).
- **UI PRs add the visual contract:** `ui:conformance --full`, `ui:test:visual`,
  baseline diff review, a11y stories (lucide's `aria-hidden` default).
- **Compile-external PRs add `bun run build`** and their compile-and-run teeth
  tests (sharp store, Pi static OAuth modules).
- **Pi PR adds a live post-merge check** (chat turn + image gen on 3737).
- **No new test infrastructure.** Where a bump changes a behavior we rely on
  (e.g. js-yaml `load('')`, dnd-kit feedback), an existing test must cover it or
  one is added at the call site's test file.

## 9. Boundaries

**Always**
- Work in the worktree; never `bun install` in this checkout while 3737 runs
  except in the post-merge restart step.
- Run the full gate (§3.2) before pushing; one suite at a time.
- One PR in flight at a time; cut the next branch from merged `main`.
- Regenerate tracked generated artifacts with their scripts (never hand-edit
  `_embedded-assets-static.ts`, `pin-data.ts`, baselines).
- Commit `bun.lock` with every manifest change; CI runs `--frozen-lockfile`.
- Append the coupling/blocker learned in each PR to
  `.claude/knowledge/dependency-sweeps.md` in that PR.
- Verify ports 3737/3738 are clean and the manifest endpoint answers after every
  3737 restart.

**Ask first**
- Forcing a dependency past its declared peer range (`overrides`).
- Any change to `.bun-version` or `.github/workflows/*` beyond what a bump
  strictly requires (e.g. a node version floor for vitest/astro).
- Deleting or rewriting an existing test to make a bump pass.
- Changing SDK peer ranges in `packages/sdk/package.json` (they are published).
- Touching `~/.pi`, `~/.bakin/settings.json`, or anything on `margo`.
- Cutting a release.

**Never**
- Bump bun in this initiative.
- Add compatibility shims, dual import styles, or re-export aliases to keep old
  call sites compiling.
- Commit `generated-version.ts` after a build (memory: build-mutates-generated-version).
- Run two full suites concurrently.
- Merge with a red or incomplete CI run, or with the local gate skipped.

## 10. Success criteria

1. `bun outdated` in root, `docs/`, `packages/adapter-pi` shows only §3.3 items.
2. `nodemailer`, `@types/nodemailer`, `@tanstack/router-devtools`,
   `eslint-plugin-react`, `@types/js-yaml`, docs `zod`/`@xyflow/react` are gone
   from the manifests and the lockfile.
3. No `import yaml from 'js-yaml'`, no lucide deprecated alias, no `feedback:`
   option on `useSortable` remains in the repo.
4. Every PR merged with: local gate green, CI green (Checks + 3+3 shards +
   completeness + UI visuals when impacted), zero act warnings, zero skipped
   tests added.
5. 3737 restarted after each merge; after PR 12, one real Pi chat turn and one
   image generation succeeded on 3737 and the Health page shows no Pi findings.
6. `tests/integration/media/compiled-sharp-store.test.ts` green on darwin and
   the linux CI leg with the 0.35.5 pin; `tests/adapter-pi/compiled-oauth-static`
   (incl. teeth) green on 1.0.1.
7. `.claude/knowledge/dependency-sweeps.md` exists with: order, gate, coupling
   ledger, peer-blocked ledger, the unused-dep audit script; CLAUDE.md points to
   it; tasks-plugin / workflows-plugin / pi-adapter / media-pipeline /
   test-suite-health docs are correct for the new versions.
8. Bits companion PR open (or merged) with the SDK ref advanced; follow-up
   issues filed for TS 7, bun 1.4 matrix, React lint coverage; #760 closed with
   the moved-versions table.

## 11. Open questions

None blocking. Items the review should confirm are the nine assumptions in §1.
Two things only the work can answer, recorded here so they are not forgotten:

- Whether `openai-codex` still resolves as a provider id in pi-ai 1.0.1 (the
  CHANGELOG says "renamed (legacy)" — label or id?). If the id changed,
  `codex-images.ts` and the static-modules registration follow it; the live
  image-gen check in PR 12 is the proof.
- Whether Astro 7's `compressHTML: 'jsx'` changes rendered whitespace in our
  Starlight overrides; `docs:build:combined` + a visual look at the built site
  decides whether to pin `compressHTML: true`.
