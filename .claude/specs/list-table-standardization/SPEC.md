# List/table standardization — #806

## Status and objective

Design direction agreed with the user on 2026-09-19; spec approved in the
subsequent conversation checkpoint. [PLAN.md](PLAN.md) was subsequently approved
for the audit and Storybook-only comparison sequence. Subsequent review approved
the three families, compact independent actions, and shared section-header
treatment. On 2026-09-20 the user approved the six refreshed desktop/mobile
recipe screenshots, including the Details chevron, for baseline acceptance.
This foundation does not authorize bulk consumer migration or complete the
fleet audit. Evidence and outstanding work live in [AUDIT.md](AUDIT.md).

Reduce the decisions authors must make when presenting collections across the
host, core plugins, and official Bits. Audit actual usage, establish the ruling
from that evidence, and then migrate in reviewed slices. The previous shorthand
“record → table; thing you open → list; event → timeline” is not the ruling:
records can be browsed, tables can open details, and timestamps do not by
themselves justify a timeline.

## Agreed direction

- **Data table (2026-09-21 ruling):** `DataTable` is the default for record
  collections when meaningful visual previews do not justify cards. It is not
  limited to comparison-only screens. Wide and narrow views use one column
  model, with sorting and actions available at both widths.
- **Card list:** a deliberate choice when visual previews or richer content
  materially help browsing. Assets are a strong default-card case; branding is
  a candidate to review. Neither makes every embedded list in that plugin a card list.
- **Standard rows:** divider-separated rows are a deliberate choice for compact
  supporting/embedded lists or a specific interaction need, not the default
  alternative to cards. This supersedes the earlier rows-first ruling.
- Card stack versus card grid is layout, not another generic component family.
- Keep calendars, kanban, timelines, navigation, and pickers as specialized
  interactions. Do not flatten them into the generic list API.
- Borrow proven anatomy and interaction conventions from established frameworks,
  as with the badge refinement; do not install a new framework or copy all its variants.
- Make surface-specific decisions as the audit progresses, not a fleet-wide blind replacement.

## Standard contract

### Standard rows

Use the existing `ListRows` / `ListRow` foundation. One consistent anatomy:
optional leading identity/media; primary title; optional description and
metadata; status; independent trailing actions. Content remains domain-owned.
Dividers separate peers without an individual rounded border around every row.
Use the existing `md` page and `sm` compact rhythms, not plugin-specific padding
scales. Group headings, selection, expansion, and actions are capabilities of
the same list, not new visual families.

Existing `separated` also paints top/bottom borders. The approved grouped recipe
uses `border-y-0` to avoid extra lines around section headings; internal dividers
remain. `ListRowGroup headerVariant="section"` owns the flush, subtly filled
heading with a neutral rail; `headerTone` permits semantic color and
`headingLevel` follows document hierarchy. Plain compact groups stay unchanged.
Pin and Details use compact independent controls, with a down/up disclosure
chevron and optional record-specific overflow menu.
Do not silently switch the global default or delete `bordered`/`plain` APIs.
Decide their compatibility path after auditing explicit and implicit consumers.
Plain structural/supporting lists may remain justified without being another
top-level collection choice.

### Cards and tables

Compose existing `Card`, `CardMedia`, and `Grid` for card lists. Establish a
canonical collection recipe before proposing any new `CardList` export.
Text-only titles, status badges, progress, and timestamps do not automatically
earn a card. Keep meaningful media and rich object previews where they help.

Keep `DataTable` as the default tabular pattern and `Table*` as a reviewed
escape hatch. Aligned list fields are acceptable for independently labelled
controls or metadata; column-wise comparison needs real table semantics.
Do not add an all-purpose collection engine combining forms, tables, cards,
virtualization, navigation, and remote data fetching.

### Narrow containers and touch

- Reflow by available container width, including drawers and rails, not device labels alone.
- Standard rows keep identity and status readable; metadata and controls may
  wrap below. Essential information must not become tooltip-only.
- Card collections normally become one column when narrow; retain useful media.
- Comparison tables keep semantic headers and bounded horizontal scrolling when
  needed. Do not force every table into tall stacks of label/value pairs.
- Browsing-oriented tables may use the existing narrow-list mode, with the same
  order, selection, primary action, secondary actions, and pagination.
- A collapsing sortable table must retain a usable sort control and visible
  current order. Do not independently fork wide/narrow sort state.
- Actions cannot depend only on hover. Verify touch and keyboard access,
  independent nested controls, focus visibility, and focus after layout changes.
- Existing filters and URL state remain intact. Full-screen mobile facets are
  related work in #759, not an implicitly approved expansion of this task.

## Audit and completion criteria

1. Reconcile collection findings with `design-system/census.json`, including
   composed/custom lists, not just direct component matches. Record owner,
   source, task/purpose, current pattern, proposed pattern, interactions, narrow
   behavior, states, and evidence status. Do not duplicate the census authority.
2. Classify each finding: keep; existing-pattern migration; reusable kit gap
   requiring approval; or already-recorded migration debt. New exceptions need
   separate approval and must not replace existing debt records.
3. Review representative wide/narrow surfaces and loading, initial-empty,
   no-results, error, busy, disabled, long-content, and expanded states.
4. Present the same representative content as standard rows, cards, and a table
   in Storybook, plus legitimate media-card examples. Demonstrate grouped and
   compact rows, nested actions, and both deliberate table narrow behaviors.
5. Approve the contract and exact visual changes before consumer migrations.
   Update public stories, docs, API inventory when needed, and selection
   guidance together; do not let draft guidance outrank executable stories.
6. Label the census through its maintained source/generator contract after
   inspecting that schema. Produce a prioritized migration backlog with
   unresolved judgments clearly marked, not a claim that every surface is fixed.

## Existing pattern anchors and structure

- `storybook/public/lists/list-rows.stories.tsx`: `ListVarieties`, `Grouped`,
  `InteractiveRows`, `DenseRows`, `Columns`, `LoadingPreview`.
- `storybook/public/lists/data-table.stories.tsx`: `NarrowRoles`,
  `SortedPagedDualRender`, `ActivatableRows`, `SelfSorting`.
- `storybook/public/primitives/card.stories.tsx`: `MediaCover`, `RowMedia`,
  `InteractiveCard`; `storybook/public/layout/grid.stories.tsx`: `AutoFill`.
- `storybook/public/recipes/filterable-table.stories.tsx`: `FilterableTable`.
- Implementations: `packages/ui/src/{patterns,primitives,layout}/`.
- Public contract: `@makinbakin/sdk/{patterns,ui,layout,navigation}`.
- Guidance: `.claude/knowledge/style-guide.md` and
  `docs/src/content/docs/extending/ui/overview.md`.
- Consumers: `packages/host/src/`, `plugins/`, sibling
  `bakin-bits-official/plugins/`. Tests: `tests/ui/`, `tests/plugins/`, Bits tests.

## Code style and boundaries

Bun 1.3.13, React 19, strict TypeScript, existing semantic tokens and focused SDK
imports. Start with composition using the current API, for example:

```tsx
import { ListRow, ListRows } from '@makinbakin/sdk/patterns'

<ListRows variant="separated" aria-label="Projects">
  {projects.map((project) => (
    <ListRow key={project.id}>{project.title}</ListRow>
  ))}
</ListRows>
```

- Always: distinguish agreed direction from proposed API/visual changes; preserve
  routing, semantics, actions, domain information, and user-owned changes.
- Ask first: new exports/tokens/archetypes, API removals, system exceptions,
  exact baseline updates, dependencies, or expansion into adjacent kit tickets.
- Never: mass-replace cards by plugin name, regenerate baselines to pass tests,
  alter production data, or bundle #805/#807/#808/#810/#811 cleanup into this audit.

## Verification and commands

Draft audit/spec: check references, source evidence, and `git diff --check`.
No runtime test result is implied by a source-only audit.

After approved implementation, use focused unit/story tests first and test
desktop, 320px containers, intermediate widths, 200% text, touch, keyboard,
long content, and every state listed above. Verify sort/action parity through
resize; avoid duplicate active controls in the two renders.

```sh
bun run ui:dev
bun test tests/ui/patterns/list-rows.test.tsx tests/ui/patterns/data-table.test.tsx --isolate
bun run ui:test:stories
bun run typecheck
bun run lint
bun run ui:conformance --quick
bun run ui:conformance --full
```

Run each changed client-bearing plugin's declared `bun run test:ui` fixture and
inspect its report. Official Bits conformance uses the compatibility-matrix
revision; this audit inspects current sibling main. Never silently repin the
matrix to reconcile those different purposes.

## Review checkpoint

The kit foundation, six recipe baselines, and two overview-caption baseline
updates are visually approved. Review and verification are recorded in
`AUDIT.md`; every full-conformance stage has passing evidence. The first real
consumer proof is Workflows, after the kit lands; remaining consumers follow in
bounded migrations. Mobile filters/sorting stay in #759, with sort-parity gates
on affected table migrations. No breaking default/API removal is approved.
