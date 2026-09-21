# Execution plan — list/table standardization (#806)

Status: kit foundation reviewed and verified, including six new recipe baselines
and two separately approved caption-baseline updates. Workflows is the first planned consumer proof after the
kit checkpoint, not part of this foundation slice. The foundation landed in #879;
the Workflows proof is now implemented on `refactor/workflow-list-806` for local
review in Imitation Crab. After reviewing rows and grouped tables, the user
approved one sortable DataTable with a Source column/filter, unified search,
and 20-row pagination. The shared search focus-ring repair was explicitly
approved and the plugin fixture now passes. The user approved the real-app
presentation and the four subsequent kit baseline updates. Full conformance
passed on 2026-09-20; the implementation is submitted in Bakin #885, with
host-dependent filter consumers in Bits #106. CI and human review remain before
merge. Projects is the next proposed bounded collection migration after shipment.
Scope: [SPEC.md](SPEC.md). Evidence: [AUDIT.md](AUDIT.md).

## Delivery shape

Finish the audit before declaring the ruling complete. Then establish the
visual/interaction contract in Storybook, prove it on one core consumer, and
migrate the remaining approved surfaces in small follow-ups. Do not combine
the entire host/core/Bits conversion into one PR.

Dependency order: census-linked audit → browser evidence → Storybook comparison
→ visual/contract approval → kit refinement → one core migration → Bits and
remaining migrations. Mobile sorting can be investigated during the audit,
but any behavior change needs its own focused implementation slice.

## Architectural choices

- Reuse `ListRows`/`ListRow`, `Card`/`CardMedia`/`Grid`, and `DataTable`.
  No new collection mega-component, dependency, export, or token is planned.
- Begin with `variant="separated"` explicitly. Keep current global defaults
  and compatibility variants until the visual decision and impact review.
- Prefer a documented shared row composition before proposing new anatomy
  exports. If composition leaves genuine repeated behavior/layout logic,
  explain that concrete gap for approval before expanding the API.
- Annotate existing census IDs in the audit. Do not change the census's
  surface-classification meaning or hand-edit generated output.
- MUI's list/card/table separation informs the model; shadcn's Item informs
  anatomy. Bakin retains its own tokens, routing, state and interaction contracts.

## Work packages

### 1. Complete census-linked source audit

- Acceptance: every census entry has a reviewed outcome, including aliases,
  no-collection, specialized-only, and shared/template surfaces. Multiple
  collections within one page get separate source/symbol findings.
- Inspect indirect wrappers, custom repeated markup, and state branches;
  record purpose, current/recommended family, controls, narrow behavior,
  migration classification and unresolved decisions.
- Verification: compare matrix IDs against the canonical census, check source
  references exist, and reconcile known allowances with `migrations.json`.
  Coverage is complete only when there are no unexplained census omissions.
- Files: `AUDIT.md` (split into a linked appendix only if needed).
- Dependencies: none. Scope: documentation, 1–2 files.

### 2. Collect representative browser evidence

- Acceptance: inspect main pages, compact rails and drawers at wide, narrow,
  intermediate and 200%-text sizes; distinguish source findings from observed
  failures. Include core and official Bits through their supported fixtures.
- Priorities: projects/workflows row candidates; assets/brand media cases;
  Chat rail and Health expansion; Task log/Schedule/Messaging collapsing tables.
  Check loading, empty, no-results, error, busy, disabled and long content.
- Verification: reproduce or dismiss sort-control and touch-action risks;
  record exact fixture/story, environment, width, result and evidence location.
  No production mutations or visual-baseline updates.
- Files: `AUDIT.md`; evidence referenced from local test reports.
- Dependencies: source findings from package 1. Scope: evidence, 1–2 files.

### Checkpoint A — audit/ruling

Review unresolved pattern choices. Confirm which cases need only existing
composition and which reveal a reusable kit gap. Do not turn “uses a Card” into
automatic proof of misuse. Keep branding/assets media decisions distinct from
attachment/document lists within those plugins.

### 3. Build a Storybook-only collection comparison

- Acceptance: the same representative text-first objects appear as standard
  rows, cards and a table; separate asset/brand examples show where cards help.
  Include wide/narrow composition, compact/grouped/selected/expanded rows,
  long labels and independent trailing actions without changing app consumers.
- Use existing public APIs and supported layout primitives. Keep new helpers
  in Storybook support rather than silently publishing a new kit component.
- Verification: story play assertions for semantics, primary/nested actions,
  selection and narrow layout; quick conformance and canonical browser/visual
  evidence. Request exact approval before accepting new/changed baselines.
- Likely files: a new public recipe story, its small support fixture, existing
  list story if needed, and the canonical visual scenario registration.
- Dependencies: checkpoint A. Scope: 3–4 files per slice; split the comparison
  and interaction stress cases if they exceed that scope.

### Checkpoint B — visual/contract approval

Review the comparison before a global default or consumer change. Decide
divider edges, spacing, title/metadata hierarchy, action placement and card
exceptions. Any proposed new public anatomy or mobile-sort API needs a concrete
mismatch explanation and explicit approval, not just approval of this plan.

### 4. Refine the kit and publish the ruling

Deliver independently verifiable slices, not one cross-cutting rewrite:

1. **Row contract:** approved default/treatment changes, relevant row tests and
   stories. Preserve compatible explicit variants until their retirement is
   separately justified. Inspect all four implicit default consumers first.
2. **Narrow interactions:** mobile filters and sorting stay in #759 (expanded
   to include sorting and migration guardrails). Unaffected kit/Workflows work
   can proceed; table migrations that lose mobile sorting remain gated on
   #759 or a separately reviewed parity fix. Preserve filter → sort → page
   ordering and shared URL state; no per-plugin mobile data pipeline.
3. **Guidance:** update style guide and public UI overview to match accepted
   stories; record compatibility and migration guidance. API inventory changes
   only if an API change is actually approved.

Each slice: at most about five files; focused tests, quick conformance, then
full conformance for the merge-ready kit checkpoint. Likely paths are the
relevant pattern implementation, its test/story, and the guidance files named
in the spec. Do not couple unrelated table slot naming (#810) to this work.

### 5. Prove one core migration

- Candidate: Workflows' top-level collection, subject to checkpoint A/B.
  Keep Assets and Branding galleries intact; do not migrate all core pages yet.
- Acceptance: use the user-approved unified DataTable with Source classification
  and filtering instead of separate groups; preserve search, pagination,
  assignments, step/feature information, URL state and opening behavior. Update
  the relevant mock/fixture to show realistic long content.
- Verification: focused workflow tests, client-bearing plugin UI fixture,
  keyboard/touch/wide/narrow review, quick/full conformance as appropriate for
  a merge-ready migration. Record any reduced style debt without broadening it.
- Files: workflow page, row/card consumer as required, focused tests, fixture;
  split if more than five files need material changes.
- Dependencies: accepted kit checkpoint. Scope: one consumer, 3–5 files.

### Checkpoint C — real app proof

User reviews the actual core list. Correct the shared pattern if real content
exposes a reusable problem; don't paper over it with plugin-specific layout.

### 6. Prioritize and ship follow-up migrations

- Start with Bits Projects and Messaging text-first collections, then remaining
  approved core candidates. Each consumer gets its own bounded task/acceptance
  criteria derived from the audit, not blanket authorization from this plan.
- Preserve sparse previews and media galleries, specialized navigation/pickers,
  timelines/boards/calendars, and independently labelled repeated form controls.
- Verify changed mocks and interactions, SDK/package compatibility and each
  repository's required tests. A new SDK capability requires an explicit
  release/consumer dependency sequence before Bits adoption.
- Keep the census-linked audit current: keep, pending, migrated or deliberately
  specialized, with evidence and follow-up references. Migration completion is
  distinct from completion of #806's audit/ruling deliverable.
- Dependencies: checkpoint C. Scope: separate 2–5-file slices, planned and
  approved per surface; no cross-repository bulk change.

## Risks and safeguards

| Risk | Safeguard |
| --- | --- |
| Reduced visual variety also removes useful information | Same-data comparison and per-surface information/action inventory |
| Default change silently restyles implicit consumers | Inventory four implicit usages, explicit compatibility decision, before/after review |
| Narrow layout loses sorting or secondary actions | State-parity, touch and keyboard tests across resize before migration |
| Cosmetic standardization invents another abstraction | Start from supported composition; approve a concrete API gap before expansion |
| Census annotations become a competing surface registry | Reference existing stable IDs; do not copy scanner-owned ownership/routes |
| Current Bits differs from pinned verification inputs | Audit current main; verify against explicit compatibility inputs; never silently repin |
| A large PR hides regressions | Kit review, one-core proof, then independent consumer slices |

## Verification now versus later

The census-linked triage now covers all 102 IDs; this is not full state coverage.
Representative live-app and kit-story browser checks are recorded in `AUDIT.md`.
The three-story comparison covers same-data alternatives, row interactions and
illustrative brand previews. Detailed asset previews, async states, compact
rails/drawers and official Bits fixture coverage remain follow-up audit work.

Focused story tests, quick conformance, lint and the public build have passed.
The six refreshed canonical recipe screenshots were approved on 2026-09-20
after review in Finder; two existing caption baselines were separately approved.
Every full-conformance stage has passing evidence after the targeted visual
correction, and code review is complete. See `AUDIT.md` for exact run boundaries
and the remaining fleet-audit limitations.

The approved kit slice promotes section headers into ListRowGroup with a
neutral default and optional semantic tone, preserving existing plain rail
headings. Triple-dot menu examples cover rows, cards and tables using existing
menu primitives; Details shows its disclosure state with a chevron. Only the
six reviewed recipe baselines and two caption updates are approved. Unreviewed extensions and bulk app
migration remain outside this approval.
