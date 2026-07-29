# Storybook Refit — Audit, Reorganization, Naming, Coverage

Status: DRAFT — pending approval
Owner: Mark Hayden
Date: 2026-07-29
Companions: `storybook-refit-audit.md` (Phase 0 output), `storybook-refit-plan.md` (task breakdown, written after this spec is approved)

## 1. Objective

The design-system rework (feat/ui-design-system-foundation) built a real kit and a
governed Storybook, but the Storybook that emerged has three debts:

1. **Organization** — sections are inconsistent granularity (26 single-component
   Foundation files next to 13 multi-component "scene" files), one-off top-level
   sections (`Agents/`, `Search/`, `Choices/`, `Content/`, `States/`), and a
   `Foundation/` vs `Foundations/` split.
2. **Code examples** — no docs addon is installed. There are no props tables, no
   source panels, no copyable usage anywhere. Stories are wrapped in story-local
   scaffolding (`ChartStage`, `StoryHeader`) so source would be polluted even if
   it surfaced.
3. **Naming** — kit components and story entries are named after app areas
   (`WorkspacePage`, `AgentFilter`, `Search/Trust states`,
   `Choices/Asset, model, and color pickers`) instead of intent. Components meant
   to be global read as plugin-private.

This effort audits every public entry and kit export, then executes the fixes:
intent-based taxonomy and names, granular per-component entries with enforced
canonical usage examples, missing chart types, consolidated page/list archetypes
with variant props, a structural gate on future kit growth, and full app
conformance to the vetted patterns — ending with `migrations.json` at zero and
the frozen `@makinbakin/sdk/components` entrypoint deleted.

Target user: this machine's single operator and the agents (Claude Code, Codex)
that build UI against the public Storybook as executable contract.

## 2. Decisions (locked in interview, 2026-07-29)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Deliverable shape | Phase 0 produces a written audit report with per-entry verdicts; approved verdicts become the build plan. No build work before audit approval. |
| D2 | Rename depth | Full depth — SDK export names are audited and renamed, not just story titles. Call sites migrate mechanically. |
| D3 | Taxonomy | Component-per-entry under intent sections, plus an explicit `Recipes/` section for compositions (tree in §5). One-off sections dissolve. |
| D4 | Code examples | `@storybook/addon-docs` autodocs on every public entry + the CanonicalUsage rule (§7). Enforced by extending story-teeth. |
| D5 | Chart additions | Pie/Donut and Area/stacked-area join the kit. Heatmap and scatter are deferred (no consumer). |
| D6 | Page archetype count | The audit decides the final number by diffing the seven current archetypes; philosophy is fixed: few archetypes, variant props (width `standard|full`, header, tabs), extension gated. |
| D7 | App conformance | IN SCOPE — every list, page, and chart in host + 13 core plugins + official Bits conforms to a vetted pattern before this effort ends. |
| D8 | Test bar | Per-entry coverage gate: every public entry carries a play-function assertion, visual snapshot, declared `bakinCoverage` axes, and a11y-clean. Enforced via story-teeth. |
| D9 | Kit growth gate | Structural: a new public `packages/ui` export without story + canonical usage + coverage axes + `public-api.json` registration fails conformance. |
| D10 | Branch state | Checkpoint Codex's in-flight work (commit, gates green) before any audit/build work starts. |
| D11 | Git strategy | One branch (`feat/ui-design-system-foundation`), phase-boundary conventional commits as rollback checkpoints (§9). |
| D12 | Sanctioned domain vocabularies | Conversation and Agent identity keep domain names. Everything else (incl. Kanban) gets an intent verdict in the audit. |
| D13 | Official Bits | Lockstep — each phase includes matching bakin-bits-official changes; `compatibility.json` re-pins at each phase boundary. |
| D14 | Done bar | `migrations.json` has zero legacy-allowed entries; `@makinbakin/sdk/components` is deleted; ratchet guards the clean baseline. |
| D15 | `Bakin` prefix | Banned in component names (`BakinDrawer` → intent verdict). The package name carries the brand. |
| D16 | Artifact locations | This spec + audit report live in `.claude/specs/`; machine-readable verdict data (if gates need it) in `design-system/`. |

## 3. Commands

Existing gates (all must stay green at every phase boundary):

```sh
bun run ui:conformance --quick        # iteration
bun run ui:conformance --full         # phase-boundary gate
bun run ui:test:stories               # play tests (vitest, storybook project)
bun run ui:test:visual                # visual snapshots
bun run ui:snapshots:update           # intentional snapshot refresh after moves/renames
bun run ui:census:generate|check      # census after export renames
bun run ui:legacy-styles:generate|check  # migrations ledger ratchet
bun run ui:governance:check           # exceptions ledger
bun run typecheck && bun run lint && bun run test
```

New/extended by this effort:

- story-teeth grows two checks: (a) CanonicalUsage-first rule per public entry,
  (b) per-entry coverage gate (play assertion + snapshot + `bakinCoverage` + a11y).
- conformance grows the kit-growth gate (D9).
- teeth verifiers (`ui:test:stories:teeth`, etc.) get cases proving the new checks bite.

## 4. Phase 0 — the audit (first deliverable)

`storybook-refit-audit.md`: a complete inventory with one verdict row per unit.

Units audited:

1. Every public + internal story entry (67 files): verdict = keep / retitle /
   move / split / merge / delete, with target taxonomy address.
2. Every public export of `@makinbakin/sdk/{ui,layout,patterns,charts,conversation,content,navigation}`
   (source: `design-system/public-api.json` + `packages/ui/src` + `packages/sdk/src`):
   verdict = keep name / rename (with proposed intent name per §6 rubric) /
   demote out of public kit / delete. Blast radius listed per rename (host,
   plugins, Bits, census, docs).
3. The seven page archetypes: rendered-output diff + consumer inventory →
   proposed minimal archetype set with variant-prop matrix (D6).
4. Every list surface in host + 13 plugins + Bits: which vetted list type it
   maps to, or a conform-verdict describing the change.
5. Every chart usage in the app: which kit chart it maps to; gaps that justify
   the Pie/Area additions; any usage the kit can't express (flagged, not
   silently extended).
6. Every entry's test posture against the D8 bar: has play assertions / snapshot /
   coverage axes / a11y — gap list.
7. Story scaffolding inventory (`ChartStage`, `StoryHeader`, …): which survive as
   Recipes-only helpers, which die under the CanonicalUsage rule.
8. `migrations.json` ledger: remaining debt per path, sized, mapped to a phase.

The audit renders verdicts; it changes no code. Mark reviews and approves/edits
verdicts; the approved audit + this spec drive `storybook-refit-plan.md`.

## 5. Target taxonomy (approved shape)

```
Foundations/     tokens, typography, color, iconography
Primitives/      button, input, badge, avatar, … (one file per component)
Overlays/        dialog, drawer, sheet, popover, tooltip
Forms/           fields, composition, settings-renderer
Layout/          page-shell, grid, section, overflow
Pages/           the surviving archetypes, each with variant-prop stories
Lists/           the vetted list types, each named + documented
Tables/          data table, sortable, exact-data
Charts/          line, bar, stacked, ranked, pie, area, sparkline, tooltip, explainer (one file per chart)
Conversation/    turns, composer, panel, timeline (sanctioned domain, D12)
Feedback/        system states, alerts, progress, skeletons
Navigation/      tabs, filters, command, page-navigator
Recipes/         full-page compositions proving assembly — never introducing new patterns
Internal/        direction studies, plugin containment (maintainer audience only)
```

The audit maps every existing entry into this tree; sections not listed here do
not exist afterward. Exact per-section membership is an audit output, not
guessed here.

## 6. Naming rubric (applies to SDK exports AND story titles)

1. Name the intent, not the app area. A component usable by any plugin must not
   carry a plugin's noun. (`WorkspacePage`, `AgentFilter`-style names get verdicts.)
2. Sanctioned domain vocabularies: **Conversation** (single-engine kit, #703)
   and **Agent identity** (avatar/presence/assignment — agents are a permanent
   Bakin primitive). These keep domain names.
3. `Bakin` prefix banned in component names (D15).
4. Generic UI-pattern nouns (accordion, drawer, sheet, command) are intent names —
   allowed. "Kanban" is NOT pre-sanctioned; the audit renders its verdict.
5. Story entry = component name or plain intent phrase; sections are plural
   nouns; one style for the whole tree (audit proposes exact casing rules as
   part of the report, applied uniformly).
6. Single-consumer components don't belong in the public kit — demote to the
   consumer or justify in the audit.

## 7. Code-example contract

- `@storybook/addon-docs` installed; autodocs tag on every public entry →
  props table from TS types + per-story source panels.
- **CanonicalUsage rule:** the first story of every public entry is named
  `CanonicalUsage`, is minimal and copy-pasteable, imports ONLY from
  `@makinbakin/sdk/*`, and uses zero story-local helpers. Scaffolded showcase
  stories are allowed after it.
- Recipes/ and Internal/ entries are exempt from CanonicalUsage (they are
  compositions by definition) but not from the coverage gate.
- Enforced by story-teeth (D4); a teeth-verifier case proves the check bites.

## 8. Project structure impact

- `storybook/public/**` restructured to mirror §5 sections; `storybook/internal/**`
  keeps direction studies + containment.
- `packages/ui/src/**` files/dirs follow renamed components (kebab-case files).
- `packages/sdk/src/*` entrypoint re-exports updated; `@makinbakin/sdk/components`
  deleted at the end (D14).
- `design-system/{census,public-api,migrations,compatibility}.json` regenerated
  at each phase boundary — never hand-edited.
- `.claude/skills/bakin-ui-conformance/SKILL.md` updated wherever it names
  sections, entries, or component names that change.
- Docs updated in the same phase as the change they describe:
  `docs/src/content/docs/extending/ui/overview.md`, `design-system/README.md`,
  CLAUDE.md ("Shared browser UI" + chart-kit bullets), and
  `.claude/knowledge/{design-system,shared-ui-patterns,ui-patterns,style-guide,conversation-kit}.md`
  as impacted. README.md if impacted.

## 9. Phases + commit strategy (D10, D11)

One branch, conventional commits, each phase boundary = gates green + ledgers
regenerated + docs current = rollback checkpoint.

| Phase | Content | Checkpoint commit(s) |
|-------|---------|----------------------|
| P0a | Checkpoint Codex's in-flight tree: run full gates, commit as-is work | `feat(ui): checkpoint design-system foundation work` |
| P0b | Audit report written, reviewed, approved; plan written via /agent-skills:plan | `docs(specs): storybook refit spec + audit` |
| P1 | addon-docs + autodocs + CanonicalUsage/coverage/kit-growth teeth (checks land BEFORE the reorg so the reorg is graded by them) | `feat(storybook): docs addon + canonical-usage and coverage gates` |
| P2 | Taxonomy reorg: move/split/merge/retitle stories to §5 tree; de-scaffold into CanonicalUsage-first entries; snapshot refresh | `refactor(storybook): intent-based taxonomy` (one commit per section if large) |
| P3 | SDK renames + demotions + mechanical call-site migration (host, plugins, Bits lockstep, compat re-pin) | `refactor(sdk)!: intent-based component names` — one commit per rename cluster |
| P4 | Chart kit growth: Pie/Donut, Area (+ their entries, coverage, dataviz-consistent palette/table/keyboard treatment) | `feat(charts): pie and area charts` |
| P5 | Page archetype consolidation + list-type canon per approved audit verdicts (variant props; delete absorbed archetypes) | `refactor(patterns)!: consolidated page archetypes` / `feat(patterns): vetted list types` |
| P6..n | App conformance, one commit per plugin/surface, Bits in lockstep; migrations.json ratchets down each commit | `refactor(<plugin>): conform to vetted patterns` |
| P-final | Delete `@makinbakin/sdk/components`, zero the ledger, final regenerate of all evidence, docs/knowledge sweep | `feat(sdk)!: remove frozen components entrypoint` |

Rollback: every phase boundary is revertable in isolation because gates were
green before and after; renames (P3) cluster commits so a single bad rename
reverts without dragging the taxonomy work with it.

## 10. Testing strategy

- D8 per-entry coverage gate is the floor (play assertion + snapshot +
  `bakinCoverage` axes + a11y) — enforced, not aspirational.
- New chart components additionally get unit tests for scale/geometry math where
  it's pure (`tests/components/`), following existing chart test conventions.
- Every new/changed check ships a teeth case proving it fails on violation.
- Full suite (`bun run test`), typecheck, lint, `ui:conformance --full` at every
  phase boundary; `ui:test:visual` + intentional snapshot updates on every move.
- App conformance phases (P6+) verify per-surface via the isolated rig
  (`/verify` skill) when behavior, not just style, changes.

## 11. Boundaries

**Always:**
- Load `bakin-ui-conformance` skill before UI changes (CLAUDE.md CRITICAL rule).
- Regenerate (never hand-edit) census/migrations/performance/public-api evidence.
- Keep Bits in lockstep and re-pin `compatibility.json` at phase boundaries.
- Update knowledge/docs in the same phase as the change.
- Tests mock content-dir + OpenClaw home per CLAUDE.md testing rules.

**Ask first:**
- Any deviation from the approved taxonomy tree or an audit verdict discovered
  mid-build (new information → back to Mark, not silent drift).
- Adding any chart type beyond Pie/Area.
- Any exception-ledger entry (deviation from vetted patterns during P6 conformance).
- Deleting a component the audit didn't already sentence.

**Never:**
- Backwards-compat shims, re-export aliases, or deprecation stubs — renames are
  hard cuts (single-user machine).
- New top-level Storybook sections outside §5.
- Story-local scaffolding in a CanonicalUsage story.
- Parallel pattern/chart systems; extension without the D9 gate.
- Hand-rolled chart libraries replaced by dependencies — the kit stays dependency-free.

## 12. Open items the audit must answer (not guessed in this spec)

1. Final page-archetype set + variant-prop matrix (D6).
2. The canonical list-type set and the Lists/ vs Tables/ boundary.
3. Kanban's name/home.
4. Per-export rename table with blast radii.
5. Exact story-title casing rules.
6. Whether `Foundations/iconography` is real work (no icon story exists today) or drops from the tree.
7. Sizing of P6 conformance work per plugin (drives P6 commit slicing).
