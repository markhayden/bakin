# Main Navigation Redesign — Story, Sections, and Responsive Sidebar

Reorganize Bakin's primary navigation into a product story that is easier to scan in expanded, collapsed, and mobile layouts. This is a coordinated change across the Bakin shell and the owned `bakin-bits-official` plugin manifests. Single-user machine; priority is a clean contract and reduced tech debt — no compatibility shims or user-configurable navigation.

## Objective

The current sidebar is a single ordered stream of destinations. It mixes primary work, planning, creation, system administration, discovery, and settings without explaining how the pieces relate. Nested plugin pages are also inconsistently reachable when the desktop rail is collapsed, and the entire sidebar scrolls as one region so bottom utilities are not reliably pinned.

This pass makes the sidebar tell a clear story:

1. Start or resume work with **Chat** and **Tasks**.
2. Move from intention to execution in **Plan & Automate**.
3. Produce material in **Create**.
4. Understand and manage the system in **Operations**.
5. Find personally installed capabilities in **Mix-ins**.
6. Discover more capabilities through **Make Bakin Yours**.

The redesigned navigation must remain useful when expanded, collapsed to the 52px desktop rail, or opened as the full mobile drawer. Tasks remains the default `/` destination.

## Settled Product Model

### Full expanded layout

```text
Chat                         MessageSquare
Tasks                        CheckSquare

PLAN & AUTOMATE
  Projects                   FolderKanban
  Schedule                   CalendarClock
  Workflows                  Workflow

CREATE
  Branding                   Paintbrush
  Assets                     FolderOpen
  Messaging                  Megaphone
    Calendar                 CalendarDays
    Plans                    ClipboardList
    Brainstorm               Lightbulb

OPERATIONS
  Health                     HeartPulse
  Team                       Users
  Models                     Cpu
  Memory                     Brain

MIX-INS                      (only when non-empty)
  <unplaced custom plugins>  declared icon or Puzzle fallback

Make Bakin Yours             branded promotional tile → /explore
Runtime                      ServerCog
Settings                     Settings
```

### Three-region shell

The same three regions apply to expanded desktop, collapsed desktop, and the mobile drawer:

1. **Fixed primary region:** Chat and Tasks.
2. **Scrollable navigation region:** Plan & Automate, Create, Operations, and Mix-ins.
3. **Fixed utility region:** Make Bakin Yours, Runtime, and Settings.

The desktop `<aside>` itself must no longer be the scroll container. The middle region owns vertical scrolling and `min-height: 0`; the primary and utility regions remain visible.

### Section behavior

- Section labels are text-only, non-interactive, and non-collapsible.
- Empty sections do not render. In a standard installation the three defined sections contain official entries; Mix-ins appears only when at least one item falls back to it.
- Chat and Tasks are reserved host-recognized primary destinations. Plugins cannot opt into the primary region.
- Make Bakin Yours, Runtime, and Settings are host-owned. Plugins cannot opt into the utility region.
- Official entries appear first in the fixed order shown above.
- Custom entries that declare a defined section appear after the official entries in that section.
- Custom entries are ordered by numeric `order` and then stable label/id tie-breakers.
- A top-level item without `section` falls into Mix-ins. Mix-ins uses the same custom ordering.
- No drag ordering, pinning, hiding, arbitrary headings, or per-user navigation preferences are included.

### Multi-page item behavior

Only a navigation item with children renders as a disclosure group.

- In the expanded sidebar, the parent row is a disclosure control; child rows perform navigation.
- Groups start closed unless manually opened or a child route is active.
- Entering any route under the group automatically opens it.
- Leaving the group automatically closes it, clearing a prior manual-open state.
- A closed parent displays one roll-up badge dot using the highest-severity active badge across the parent and children; it never sums counts.
- An open parent hides the roll-up and displays each child's real badge/count on its child row.
- In the collapsed rail, every group—not only special-cased groups—opens a keyboard-accessible hover/focus/click flyout containing all child links and badges.
- The parent icon and accessible name expose the highest-severity roll-up dot in the rail.
- The obsolete `alwaysExpanded` behavior is removed from the contract and from Messaging.

### Collapsed desktop rail

- Preserve the same region and item order as the expanded sidebar.
- Hide section text and use restrained vertical gaps/separators to preserve the grouping story.
- Show a tooltip and accessible name for every flat icon destination.
- Convert count pills to severity-colored dots without hiding the count from the accessible name.
- Render Make Bakin Yours as a distinct `Blocks` icon tile with a tooltip/accessibility label, not as an ordinary nav row.
- Keep the existing 52px rail width.

### Mobile drawer

- Keep the full-width expanded navigation treatment in the mobile drawer; do not use the icon-only rail presentation.
- Use the same three-region structure and middle-region scrolling.
- Close the drawer after a child or flat destination is selected.
- Disclosure controls remain keyboard and touch accessible.

### Make Bakin Yours

Replace the Explore plugin's ordinary `Extend Bakin` bottom nav contribution with a shell-owned promotional tile linking to `/explore`.

- Title: **Make Bakin Yours**
- Supporting copy: **Do more with Bakin—discover agent kits, plugins & more.**
- Expanded treatment: a restrained, branded card using the existing `packages/host/public/bakin-hop.svg` as a small, partially cropped pink decorative mark.
- Collapsed treatment: a distinct `Blocks` icon tile.
- Avoid gradients and saturated generic promotional styling.
- `/explore` remains a discovery/install storefront. A build-your-own path is out of scope and tracked separately in [GitHub issue #688](https://github.com/markhayden/bakin/issues/688).

The visual treatment is intentionally provisional and must be tuned through browser use after implementation.

## Public Plugin Contract

Define a small, closed section vocabulary in both public `NavItem` type copies and the manifest parser:

```ts
export type NavSection = 'plan-and-automate' | 'create' | 'operations'

export interface NavItem {
  id: string
  label: string
  icon?: string
  href?: string
  order?: number
  children?: NavItem[]
  badge?: NavBadge
  /** Top-level destination. Omit to render under Mix-ins. */
  section?: NavSection
}
```

Contract rules:

- `section` is optional and additive for normal plugin items.
- Only the three enum values above are accepted; display labels remain owned by the host so plugins cannot create arbitrary headings.
- `section` is valid only on top-level contributions. The manifest parser rejects it on children rather than silently ignoring it.
- Missing `section` deterministically means Mix-ins.
- `placement: 'bottom'` is removed from the SDK/core contracts and parser. Its only owned use, Explore, is removed in the same change.
- `alwaysExpanded` is removed from the SDK/core contracts and parser. Its only owned use, Messaging, is removed in the same change.
- Manifest parsing validates the enum at the external boundary and returns a direct error naming the invalid field and allowed values.
- Runtime `registerPlugin({ navItems })` declarations must match their manifest declarations so drift checking remains clean.
- Chat/Tasks and utility placement are not expressible through this public enum.

## Official Navigation Contributions

The main Bakin repository updates its owned manifests and duplicate client registrations:

| Item | Section/region | Order | Icon |
|---|---|---:|---|
| Chat | Reserved primary | 1 | `MessageSquare` |
| Tasks | Reserved primary | 2 | `CheckSquare` |
| Schedule | Plan & Automate | official 2 | `CalendarClock` |
| Workflows | Plan & Automate | official 3 | `Workflow` |
| Branding | Create | official 1 | `Paintbrush` |
| Assets | Create | official 2 | `FolderOpen` |
| Health | Operations | official 1 | `HeartPulse` |
| Team | Operations | official 2 | `Users` |
| Models | Operations | official 3 | `Cpu` |
| Memory | Operations | official 4 | `Brain` |

The owned `bakin-bits-official` repository updates both manifest and runtime declarations:

| Item | Section | Order | Icon |
|---|---|---:|---|
| Projects | Plan & Automate | official 1 | `FolderKanban` |
| Messaging | Create | official 3 | `Megaphone` |
| Messaging / Calendar | child | 1 | `CalendarDays` |
| Messaging / Plans | child | 2 | `ClipboardList` |
| Messaging / Brainstorm | child | 3 | `Lightbulb` |

Official rank is a shell product decision keyed to known official nav IDs. A plugin's `section` still controls its destination; the shell does not hardcode section assignments for external-repository plugins. This keeps the public contract clean while ensuring custom `order` values cannot jump ahead of official destinations.

## Technical Design

### Pure navigation model

Replace the current two-way `partitionNavItems()` helper with a pure, router/Lucide-free navigation model builder. It receives the flat registry snapshot and returns explicit regions and ordered sections. This helper is the authoritative home for:

- extracting Chat and Tasks into the primary region;
- grouping defined sections and Mix-ins;
- applying official ranks and custom sorting;
- omitting empty sections;
- excluding obsolete bottom placement;
- providing the sidebar a rendering-ready model.

Keep route activity and badge aggregation in small pure helpers. Do not move plugin registry or routing concerns into the visual component.

```ts
interface SidebarNavModel {
  primary: NavItem[]
  sections: Array<{
    id: NavSection | 'mix-ins'
    label: string
    items: NavItem[]
  }>
}

const model = buildSidebarNavModel(getNavItemsSnapshot())
```

### Sidebar composition

Refactor `AppSidebar` into focused rendering units rather than extending the current monolith:

- `AppSidebar` — subscriptions, path state, and three-region composition.
- section/list renderers — headings and collapsed group spacing.
- flat nav item — link, active treatment, tooltip, badge presentation.
- grouped nav item — expanded disclosure and collapsed flyout.
- Make Bakin Yours tile — responsive expanded/collapsed treatment.

File boundaries may be adjusted during planning, but components should stay local to `packages/host/src/components/layout/` unless they are genuinely reusable elsewhere.

Use existing Base UI Tooltip/Popover primitives and Lucide. Do not add dependencies.

### Icons

The manifest icon string resolver must import and map:

- `FolderKanban`
- `CalendarClock`
- `Megaphone`
- `Lightbulb`
- `HeartPulse`
- `ServerCog`
- `Blocks`
- `Puzzle`

Existing retained icons continue to resolve. A missing or unknown custom icon renders `Puzzle` for a Mix-in rather than leaving an empty icon slot. Defined-section plugin items with an unknown icon use the same safe fallback.

### Accessibility

- Section headings are exposed as labels for their corresponding lists where practical.
- Disclosure parents use a real button with `aria-expanded` and an associated child region/menu.
- Collapsed group flyouts open via pointer hover, keyboard focus, and click; keyboard users can move into the flyout without it closing prematurely.
- Tooltips are supplemental; icon-only links and buttons carry standalone accessible names.
- Badge accessible labels retain counts and tones even when the visual rail shows only dots.
- Active links preserve `aria-current` behavior from the router.
- Focus rings remain visible against the sidebar background.

## Tech Stack

- Bun test/build tooling and TypeScript 5
- React 19.2 and TanStack Router
- Tailwind CSS 4
- Base UI React 1.3 primitives
- Lucide React 0.577
- Bun's test runner for pure contract/model tests
- Playwright or the browser-testing tooling for responsive interaction verification

## Commands

Main Bakin repository:

- Focused contract/model tests: `bun test tests/core/plugin-manifest.test.ts tests/components/nav-placement.test.ts tests/components/nav-badge-logic.test.ts tests/sdk/register.test.ts --isolate`
- Component tests: `bun run test:components`
- Typecheck: `bun run typecheck`
- Lint changed source: `bun run lint`
- Production build: `bun run build`
- Full suite: `bun run test`
- Mock development runtime: `env OPENCLAW_MOCK_FORCE=1 IMITATION_CRAB_PORT=18790 bun run dev:mock`

Official Bits repository:

- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Tests: `bun run test`
- Build: `bun run build`

## Project Structure and Expected Files

Main repository:

- `packages/sdk/src/types/registration.ts` — public `NavSection` and `NavItem` contract.
- `packages/core/src/plugin-types.ts` — core-side contract parity.
- `packages/core/src/plugins/manifest.ts` — strict section parsing; remove obsolete fields.
- `packages/host/src/components/layout/nav-placement.ts` — replace partitioning with the pure sidebar navigation model (rename if a clearer name is chosen in planning).
- `packages/host/src/components/layout/nav-badge-logic.ts` — roll-up helpers, only if behavior gaps are found.
- `packages/host/src/components/layout/app-sidebar.tsx` plus local extracted components — responsive rendering and interaction.
- `packages/host/src/components/layout/layout-shell.tsx` — prevent whole-aside scrolling.
- Owned plugin `bakin-plugin.json` and duplicate client nav declarations — sections and icon updates.
- `plugins/explore/bakin-plugin.json` and `plugins/explore/client.tsx` — remove the ordinary nav contribution/commentary while keeping routes.
- `tests/core/plugin-manifest.test.ts` — accepted/rejected section contract and removed fields.
- `tests/components/nav-placement.test.ts` — new region/group/order model tests.
- `tests/components/nav-badge-logic.test.ts` — parent/child severity behavior.
- Focused sidebar component tests only where the existing runtime graph is stable; browser coverage is required for integrated interaction.
- `.claude/knowledge/plugin-system.md` — new navigation contract and fallback behavior.
- `.claude/knowledge/explore-plugin.md` — Make Bakin Yours shell entry; remove bottom-placement guidance.
- `.claude/knowledge/design-system.md` and/or `.claude/knowledge/ui-patterns.md` — three-region/collapsed sidebar pattern if those documents own it.
- `docs/src/content/docs/extending/plugins/manifest.md` and `docs/src/content/docs/extending/plugins/client-ui.md` — author-facing section contract.
- `docs/src/content/docs/using/essentials.md` — user-facing navigation story if its current tour enumerates the sidebar.
- `.claude/skills/create-plugin.md` and generated/ambient SDK references — update only where inspection shows the public `NavItem` shape is duplicated.

Official Bits repository:

- `plugins/projects/bakin-plugin.json` and `plugins/projects/client.tsx` — section and icon.
- `plugins/messaging/bakin-plugin.json` and `plugins/messaging/client.tsx` — section, icons, and removal of `alwaysExpanded`.
- `types/sdk-ambient.d.ts` / `test-sdk` contract fixtures — update or regenerate if required by that repository's typecheck workflow.

## Code Style

- Keep the public enum in kebab-case because values are serialized into JSON manifests.
- Keep section display text in the host model, not in plugin data.
- Prefer pure data transforms and small render components over conditional growth in `AppSidebar`.
- Reuse current class conventions and design tokens; avoid new one-off colors when a token exists.
- Preserve formatting conventions already used in each repository.

```ts
export function buildSidebarNavModel(items: readonly NavItem[]): SidebarNavModel {
  const primary = selectPrimaryItems(items)
  const candidates = items.filter(item => !PRIMARY_IDS.has(item.id))

  return {
    primary,
    sections: SECTION_DEFINITIONS
      .map(section => ({ ...section, items: itemsForSection(candidates, section.id) }))
      .filter(section => section.items.length > 0),
  }
}
```

## Testing Strategy

### Contract tests

- Parse each allowed top-level `section` value.
- Reject an unknown section with the allowed-value list.
- Reject `section` on a child contribution.
- Reject the removed `placement` and `alwaysExpanded` fields rather than silently preserving stale behavior.
- Verify SDK/core structural parity for the new field where existing architecture tests support it.

### Pure navigation model tests

- Chat and Tasks are extracted and ordered independently of plugin `order`.
- Tasks remains present as the default-route destination; existing `/` redirect coverage continues to pass.
- Official items appear in the exact product order inside each defined section.
- A custom item in a defined section follows official items even with a smaller numeric order.
- Custom items sort by `order`, then normalized label/id tie-breakers.
- Missing section falls into Mix-ins.
- Empty Mix-ins and other empty sections do not render.
- Unknown/missing item icons receive the `Puzzle` fallback at render resolution.

### Badge and disclosure tests

- Closed groups select the highest severity across parent and children and render one dot.
- Expanded groups expose child counts and suppress parent roll-up presentation.
- Groups open for active child routes and close after leaving.
- Manual disclosure toggling does not navigate.
- Every collapsed group produces a flyout with all children.

### Layout and browser verification

Run against the local mock app with representative official and custom nav items:

- Expanded desktop at 1440×900: story/order, headings, fixed regions, only middle scrolls, active states, Make Bakin Yours artwork/copy.
- Collapsed desktop at 1440×900: 52px width, grouping gaps, tooltips, badge dots, all nested links reachable by pointer and keyboard, distinct promotional tile.
- Short desktop viewport: primary and utility regions remain visible while middle scrolls.
- Mobile viewport: full drawer, section labels, disclosure touch behavior, drawer closes after navigation, fixed/scrollable regions.
- Keyboard pass: Tab order, visible focus, disclosure `aria-expanded`, flyout entry/escape, icon-only labels.
- Route pass: `/`, `/chat`, every official top-level destination, all Messaging children, `/explore`, `/runtime`, and `/settings`.
- Visual tuning pass for density, separators, cropped hop artwork, and whether the provisional group-open behavior feels natural.
- Capture before/after screenshots for expanded, collapsed, and mobile states for review.

### Regression verification

- Main and official Bits typechecks, tests, lint, and builds pass independently.
- Plugin manifest/runtime nav drift checks remain clean for Projects and Messaging.
- Explore routes and install functionality still load after its nav contribution is removed.
- No unrelated dirty-worktree files are modified or reverted.

## Documentation

Update documentation in the same implementation commits as the contract or behavior it describes:

- Plugin authors: allowed section values, omitted-to-Mix-ins behavior, top-level-only restriction, ordering guarantees, and lack of arbitrary/custom headings.
- Maintainers: host-owned primary/utility regions, official rank rules, collapsed-group flyout contract, badge roll-ups, and three-region scrolling.
- Explore: discovery remains `/explore`, entered through Make Bakin Yours; remove all references to `placement: 'bottom'` and `Extend Bakin` as a sidebar label.
- User essentials: update any sidebar walkthrough and screenshots that become stale.
- README only if its navigation or Explore wording is actually affected on inspection.

## Boundaries

- **Always:** keep manifest and runtime nav declarations in sync; validate serialized section values at the parser boundary; preserve Tasks as the `/` default; use the three fixed sidebar regions in every responsive mode; update owned documentation with the behavior; test both repositories independently; preserve pre-existing dirty changes.
- **Ask first:** adding a dependency; changing the Explore page itself; changing sidebar widths or mobile drawer architecture; expanding allowed plugin sections; introducing a new public plugin-provenance API; changing the default route away from Tasks.
- **Never:** allow arbitrary custom section names; expose primary or utility placement to plugins; add per-user nav customization; add a build-your-own flow in this initiative; hardcode Projects or Messaging into sections instead of declaring their section in their owned manifests; restore `placement: 'bottom'` through a shim; use gradients or generic saturated promo-card styling.

## Success Criteria

1. The expanded sidebar matches the settled item hierarchy, names, order, and icons.
2. Chat and Tasks remain fixed at the top; Tasks remains the default `/` destination.
3. The middle section alone scrolls; Make Bakin Yours, Runtime, and Settings remain pinned.
4. The optional public `section` field accepts only Plan & Automate, Create, and Operations IDs; omitted items land in Mix-ins.
5. Custom plugins cannot create headings or occupy reserved primary/utility regions.
6. Projects and Messaging declare their homes in `bakin-bits-official`; no Bakin host mapping exception assigns their sections.
7. Official entries lead each section; custom entries follow deterministically.
8. Every child route remains reachable and understandable in expanded, collapsed, mobile, pointer, touch, and keyboard use.
9. Badge counts become accessible severity dots when space is constrained and never aggregate misleading totals.
10. Make Bakin Yours links to the unchanged Explore experience with the approved branded copy and restrained artwork.
11. Obsolete `placement` and `alwaysExpanded` contract paths are removed cleanly without compatibility shims.
12. Relevant tests, typechecks, lint, builds, docs, and real-browser checks pass in both repositories.
13. Expanded, collapsed, and mobile screenshots are reviewed before the final visual treatment is considered complete.

## Assumptions for Review

1. Empty sections are hidden rather than showing an empty heading or placeholder.
2. A group parent row is a disclosure button, not a link to its first child.
3. Leaving a group's route clears manual-open state, matching the agreed auto-collapse behavior.
4. The shell may recognize known official nav IDs for fixed rank and primary extraction, but section ownership always comes from manifests.
5. `placement` and `alwaysExpanded` can be removed because all owned uses are updated in the coordinated release and this project does not require backwards compatibility.
6. Explore page content and routing are unchanged; only its sidebar entry changes.

## Open Questions

None. Any correction to the assumptions above must be resolved before implementation planning begins.
