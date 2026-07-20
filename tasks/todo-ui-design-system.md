# Browser UI Design System and Full-Surface Revamp — Task Checklist

Canonical documents:

- Spec: `.claude/specs/ui-design-system/SPEC.md`
- Plan: `.claude/specs/ui-design-system/PLAN.md`

Rule: check off a task only after its acceptance and verification clauses in
the plan pass. A checked production migration includes tests, fixture/story,
approved visual evidence, accessibility checks, census update, performance
comparison, and deletion of replaced styling/allowances.

## Phase 0 — Inventory and evidence

- [x] T1 Capture the reproducible pre-revamp baseline
- [x] T2 Define and generate the core UI census
- [x] T3 Include Bits and create the compatibility matrix
- [x] Checkpoint 0A: census truth reviewed
- [x] T4 Build the legacy-style ratchet
- [x] T5 Establish initial performance and dependency budgets
- [x] Checkpoint 0B: foundation audit reviewed

## Phase 1 — Catalog and browser verification

- [x] T6 Scaffold the React/Vite Storybook workbench
- [x] T7 Split public/internal audiences and deterministic fixtures
- [x] T8 Add canonical Playwright visual infrastructure
- [x] Checkpoint 1A: visual harness has teeth
- [x] T9 Add story accessibility and cross-browser behavior projects
- [x] T10a Integrate UI CI gates and failure artifacts
- [x] T10b Integrate the public catalog with docs deployment
- [x] Checkpoint 1B: workbench foundation green

## Phase 2 — Tokens and visual direction

- [x] T11 Implement DTCG token validation and generation core
- [x] T12 Emit CSS, Tailwind mappings, and TypeScript token metadata
- [x] T13 Generate token specimens and public reference docs
- [x] Checkpoint 2A: token pipeline deterministic
- [x] T14 Build and compare bundled typography specimens
- [x] T15 Build dense list/data direction alternatives
- [x] T16 Build detail/form direction alternatives
- [x] T17 Build conversation/workflow direction alternatives
- [x] T18 Approve and codify the visual direction
- [x] USER CHECKPOINT: visual direction approved

## Phase 3 — Private UI and focused SDK

- [x] T19 Establish the private `packages/ui` boundary
- [x] T20a Establish focused SDK UI entrypoints
- [x] T20b Establish the stylesheet/package artifact
- [x] T21 Migrate action and status primitives
- [x] T22 Migrate surface and content primitives
- [x] Checkpoint 3A: package boundary and first primitives green
- [x] T23 Migrate text-field primitives
- [x] T24 Migrate selection primitives
- [x] T25 Migrate modal and side-overlay primitives
- [x] T26 Migrate anchored overlays and command primitives
- [x] Checkpoint 3B: form and overlay primitive set green
- [x] T27a Build PageShell, Stack, and Inline
- [x] T27b Build Grid, Section, and BoundedOverflow
- [x] T28 Implement the canonical field/form composition
- [x] T29 Implement standardized system states and feedback
- [x] T30a Implement list and detail archetype recipes
- [x] T30b Implement settings and dashboard archetype recipes
- [x] T30c Implement conversation and inspector archetype recipes
- [x] T30d Implement workflow and action archetype recipes
- [ ] Checkpoint 3C: layout/forms/states/archetypes reviewed
- [x] T31 Migrate destructive, dirty, and confirmation patterns
- [x] T32a Migrate filters, segmented navigation, tabs, and sorting patterns
- [x] T32b Migrate status and metric patterns
- [ ] T33a Migrate chart data tables, palette, and sparkline
- [ ] T33b Migrate line, bar, and stacked charts
- [ ] T34a Migrate conversation model, folding, and time utilities
- [ ] T34b Migrate message, activity, and tool rendering
- [ ] T34c Migrate composer and attachments
- [ ] T34d Migrate conversation panel, stream, and drawer
- [ ] T35a Classify and migrate markdown and search patterns
- [ ] T35b Classify and migrate agent identity, filter, select, and status patterns
- [ ] T35c Classify and migrate asset, model, and color picker patterns
- [ ] T35d Classify and migrate settings and turn-output patterns
- [ ] T36 Prove focused entrypoints and freeze the migration API
- [ ] USER CHECKPOINT: public component and layout contract approved

## Phase 4 — Plugin UI contract

- [ ] T37 Inject page and per-slot plugin ownership roots
- [ ] T38 Implement plugin CSS containment validation
- [ ] T39 Make overlays and runtime CSS containment-safe
- [ ] Checkpoint 4A: isolation contract green
- [ ] T40 Build the deterministic plugin fixture host
- [ ] T41 Implement the plugin UI conformance command
- [ ] T42a Rebuild the Bakin reference plugin as an exemplar
- [ ] T42b Rebuild the Bits official template as an exemplar
- [ ] T43a Wire core plugin conformance CI
- [ ] T43b Wire Bits plugin conformance CI
- [ ] Checkpoint 4B: fresh plugin-author golden path passes

## Phase 5 — Host surfaces

- [ ] T44a Migrate shell canvas and header
- [ ] T44b Migrate sidebar and navigation
- [ ] T45a Migrate global search
- [ ] T45b Migrate toasts and global overlays
- [ ] Checkpoint 5A: routing/navigation stability reverified
- [ ] T46a Migrate Settings
- [ ] T46b Migrate Runtime
- [ ] T47 Migrate landing, not-found, and plugin-failure surfaces
- [ ] Checkpoint 5B: every host-owned browser surface complete

## Phase 6 — Official surface migrations

- [ ] T48a Tasks page shell, filters, and views
- [ ] T48b Tasks metrics and log table
- [ ] T49a Tasks cards and columns
- [ ] T49b Tasks detail shell and modes
- [ ] T49c Tasks notes, run/output, and workflow panels
- [ ] Checkpoint 6A: Tasks proves the first operational archetype
- [ ] T50a Assets index, filters, and list/grid views
- [ ] T50b Assets folders and import
- [ ] T51a Assets detail, media, and versions
- [ ] T51b Assets edit, enrichment, and slots
- [ ] Checkpoint 6B: Assets proves the data/media archetype
- [ ] T52a Brands list, creation, and cards
- [ ] T52b Brands detail overview
- [ ] T53a Brands builder and docs
- [ ] T53b Brands brainstorm and task slot
- [ ] T54 Explore catalog, detail, install, and consent
- [ ] Checkpoint 6C: creation/catalog archetypes green
- [ ] T55a Schedule shell and list
- [ ] T55b Schedule calendars and events
- [ ] T56a Schedule job drawer and history
- [ ] T56b Schedule job form and controls
- [ ] T57a Team index and teams
- [ ] T57b Team forms, packages, and adoption
- [ ] T58a Agent overview, context, and heartbeat
- [ ] T58b Agent diagnostics, lessons, and editor
- [ ] Checkpoint 6D: scheduling/people archetypes green
- [ ] T59a Memory search and overview
- [ ] T59b Memory detail and cleanup
- [ ] T60a Models shell, agents, and available catalog
- [ ] T60b Models aliases, routing, and spend
- [ ] T61a Health overview shell, pulse, and alerts
- [ ] T61b Health overview operations, spend, context, and interactions
- [ ] T61c Health activity metrics and charts
- [ ] T61d Health activity rows, failures, and trends
- [ ] T62a Health agents
- [ ] T62b Health system inventory and search
- [ ] T62c Health watch, repair, badge, and intros
- [ ] Checkpoint 6E: search/catalog/diagnostics archetypes green
- [ ] T63 Chat list, rail, launcher, agent selection, and badges
- [ ] T64 Chat conversation, composer, streaming, and tool activity
- [ ] T65a Workflows list and creation
- [ ] T65b Workflows detail, drawers, and actions
- [ ] T66a Workflow canvas shell
- [ ] T66b Workflow palette and base node shell
- [ ] T66c Workflow action nodes
- [ ] T66d Workflow orchestration nodes
- [ ] T66e Workflow configuration and parallel editing
- [ ] Checkpoint 6F: conversation/workflow archetypes green
- [ ] T67a Bits Messaging navigation and plan list
- [ ] T67b Bits Messaging calendar, status, and badge
- [ ] T68a Bits Messaging workspace and deliverables
- [ ] T68b Bits Messaging brainstorm and quick post
- [ ] T69 Bits Projects list, cards, and creation
- [ ] T70 Bits Projects detail, checklist, and editor
- [ ] Checkpoint 6G: official Bits parity green
- [ ] T71a Audit all non-page slot/badge contributions; add owner children before fixes
- [ ] T72 Resolve shared-component and route census stragglers
- [ ] USER CHECKPOINT: complete official fleet approved for legacy deletion

## Phase 7 — Closeout and stable baseline

- [ ] T73 Complete manual accessibility and content review
- [ ] T74 Run the complete visual, browser, conformance, and performance audit
- [ ] T75a Delete the legacy public component barrel
- [ ] T75b Delete generic token aliases and superseded CSS
- [ ] T75c Delete duplicate components and helpers
- [ ] T75d Delete migration-only tooling and allowances
- [ ] Checkpoint 7A: clean contract, no shims or allowances
- [ ] T76a Publish the plugin-author style guide
- [ ] T76b Publish the generated SDK/token reference
- [ ] T76c Reconcile internal knowledge and migration notes
- [ ] T77 Cut and validate the coordinated stable UI SDK baseline
- [ ] T78 Reconcile performance tracking with issue #423
- [ ] Final checkpoint: all 15 specification success criteria pass
