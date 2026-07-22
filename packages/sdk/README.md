# @makinbakin/sdk

SDK for building [Bakin](https://github.com/markhayden/bakin) plugins.
Gives you the `registerPlugin` helper, shared UI components, slot
types, and React hooks the Bakin host shell already ships at runtime.

Your plugin bundles use this package as a TypeScript source, but at
runtime React + `@makinbakin/sdk/*` are externalized and resolved through
the host's import map — so plugins don't ship a second copy of any of
them.

Full SDK docs:

- [SDK overview](https://makinbakin.com/docs/extending/sdk/overview/)
- [SDK reference](https://makinbakin.com/docs/reference/generated/sdk/)
- [Build a plugin](https://makinbakin.com/docs/extending/plugins/build/)

## Install

```sh
bun install @makinbakin/sdk
# or
npm install @makinbakin/sdk
```

`react` and `react-dom` are peer dependencies; the Bakin host provides
the actual instances at runtime.

## Quickstart

```sh
bakin plugins scaffold my-plugin
cd my-plugin
bun install
bakin plugins install --dev .
```

## Minimal client entry

```tsx
// src/client.tsx
import { registerPlugin } from '@makinbakin/sdk'

registerPlugin({
  id: 'my-plugin',
  navItems: [
    { title: 'My plugin', path: '/my-plugin' },
  ],
  pages: {
    '/my-plugin': () => <div>Hello from my plugin</div>,
  },
})
```

## Minimal server entry

```ts
// src/index.ts
import type { BakinPlugin, PluginContext } from '@makinbakin/sdk/types'

const plugin: BakinPlugin = {
  id: 'my-plugin',
  name: 'My plugin',
  version: '0.1.0',
  async activate(ctx: PluginContext) {
    ctx.registerRoute({
      method: 'GET',
      path: '/hello',
      handler: async () => Response.json({ ok: true }),
    })
  },
}

export default plugin
```

## Slots

Bakin surfaces these extensibility slots by default. Register a
component for a slot via `registerPlugin({ slots: { 'slot-name': Component } })`.

| Slot                  | Where it renders                                         |
| --------------------- | -------------------------------------------------------- |
| `asset-preview`       | Asset card previews on the Assets page                   |
| `asset-detail-modal`  | Asset detail modal                                       |
| `task-assets`         | Task drawer, asset attachments section                   |
| `task-sidebar`        | Task drawer sidebar (custom panels for a plugin's tasks) |
| `home-widget`         | Dashboard home widget grid                               |
| `nav-badge-providers` | Background hook runners (render `null`) that drive `setNavBadge` |
| `page:/<route>`       | Full-page mount at `<route>`                             |

## Sub-path imports

The public npm package exposes these sub-paths:

| Import path              | What it exposes                              |
| ------------------------ | -------------------------------------------- |
| `@makinbakin/sdk` | Plugin registration, route helpers, top-level exports |
| `@makinbakin/sdk/ui` | Supported Bakin UI primitives and semantic style helpers |
| `@makinbakin/sdk/layout` | Canonical page and responsive composition |
| `@makinbakin/sdk/patterns` | Reusable application-aware UI patterns |
| `@makinbakin/sdk/charts` | Isolated data-visualization components |
| `@makinbakin/sdk/conversation` | Isolated conversation UI and models |
| `@makinbakin/sdk/content` | Opt-in rich content rendering and editing |
| `@makinbakin/sdk/hooks` | Shared React hooks |
| `@makinbakin/sdk/components` | Migration-only legacy component barrel |
| `@makinbakin/sdk/slots` | Slot runtime and provider |
| `@makinbakin/sdk/types` | TypeScript contract types |
| `@makinbakin/sdk/utils` | Shared utilities |
| `@makinbakin/sdk/metadata` | Docs-aware contract metadata helpers |
| `@makinbakin/sdk/routing` | Typed declarative route helpers |
| `@makinbakin/sdk/navigation` | Browser links, URL state, history, and dirty-exit guards |
| `@makinbakin/sdk/testing/ui` | Deterministic browser fixture host for plugin pages and slots |
| `@makinbakin/sdk/styles.css` | Canonical compiled design-system stylesheet |

Use the focused entrypoints for new plugin UI and browser navigation. Existing
`@makinbakin/sdk/components` consumers migrate as their replacement exports
land; do not add new dependencies on that legacy barrel.

## Browser UI fixtures

Use `PluginUiFixtureHost` from `@makinbakin/sdk/testing/ui` to exercise a
plugin's real client registration without a Bakin account, host database, or
live service. The browser-only entrypoint mounts registered pages and slots
through the production route matcher, ownership wrappers, and SDK portal
roots. It also provides deterministic time, random values, UUIDs, theme,
motion preferences, routes, and explicit network responses.

```tsx
import '@makinbakin/sdk/styles.css'
import { PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { pluginRegistration } from './client-registration'

export function PluginPreview() {
  return (
    <PluginUiFixtureHost
      registrations={[pluginRegistration]}
      fixture={{
        fixedNow: '2026-01-15T12:00:00.000Z',
        route: '/bookmarks?tag=release',
        randomSeed: 'bookmarks-preview',
        colorScheme: 'dark',
        reducedMotion: true,
        viewport: 'desktop',
        network: [{ path: '/api/plugins/bookmarks', status: 200, json: { bookmarks: [] } }],
      }}
      slots={[{ name: 'home-widget', label: 'Home widget contributions' }]}
    />
  )
}
```

Import the canonical stylesheet exactly once at the preview root; installed
plugin clients still leave stylesheet loading to Bakin. Apply the matching
`PLUGIN_UI_VIEWPORTS.desktop` or `.mobile` dimensions in the browser runner—the
fixture's viewport field freezes responsive preferences and records intent but
cannot resize the browser from inside React. Unlisted requests fail loudly so
fixtures cannot silently depend on a developer machine or user state.

The prerelease migration surface is machine-inventoried in
[`design-system/public-api.json`](https://github.com/markhayden/bakin/blob/main/design-system/public-api.json).
Any value or type addition, removal, or entrypoint ownership change requires an
explicit inventory review. The legacy components symbol set is frozen: it may
shrink during migration but must not receive new exports.

Action and status UI starts with `Button`, `Badge`, `Alert`, and `Progress`.
Choose their semantic `variant`, `tone`, and `size` props instead of recreating
colors or dimensions in plugin CSS. The `buttonVariants` and `badgeVariants`
helpers are supported when a link or render integration needs the same visual
treatment while preserving its native element semantics.

Routine forms compose `Field`, `FieldLabel`, `FieldDescription`, `FieldError`,
and SDK controls inside `Form`. Use `Fieldset` for related choices and finish
with `FormActions` plus `SubmitButton`; the form's `busy` prop marks submission
and prevents duplicate saves. Form-state libraries may manage values and dirty
state, but the SDK components continue to own labels, errors, spacing, and
actions.

Data-driven surfaces use `SystemState` for initial-empty, filtered no-results,
loading, recoverable or terminal error, and permission-denied states. A
no-results state requires a clear/adjust action; a recoverable error requires a
recovery action. Use `Banner` for persistent page context. Plugins call
`toast()` from `@makinbakin/sdk/hooks` for transient outcomes and leave the
shell-owned `ToastRegion` to Bakin.

Routed indexes and record pages compose from `@makinbakin/sdk/patterns`.
`PageHeader` owns the single page heading and its responsive controls/action
order. Use its `controls` slot for the canonical compact `SearchInput` and peer
view navigation when they belong beside the primary action; the reserved
search slot expands without repacking the desktop header row. Longer queries
remain intact behind an ellipsis, and the pattern supplies its own accessible
clear action instead of a browser-dependent native cancel control.
`ListPageControls` and `ListPageContent` keep query controls separate from the
named result/state boundary. `DetailPageBody` composes a primary flow with an
optional named `DetailPageAside` that reflows below it. The recipes do not own
data or routing: keep filters, search, tabs, pagination, and overlays in the
existing `useQueryState` contract, and use `PluginLink` for client-routed page
navigation. The host retains the `main` landmark and vertical page scroll.

Settings and overview pages also compose from the focused patterns entrypoint.
`SettingsPageBody` supports a single form or responsive category navigation;
the named `SettingsPageContent` owns only the active form's feedback and
replacement-state boundary. `DashboardPageContent` names a prioritized
overview canvas that consumers compose with `Section`, `Stack`, and `Grid`.
Keep settings categories and dashboard view state in the existing query-state
contract. Values, validation, dirty state, saves, telemetry, and domain actions
remain consumer owned; avoid equal-weight card walls and nested page scrollers.

Conversation pages use `ConversationPageBody mode="document"` with host scroll
by default. Choose `contained` only inside an explicitly bounded parent; then
`ConversationPageTimeline` is the single named log scroller and the composer
remains outside it. Render folded turns with `Conversation` from
`@makinbakin/sdk/conversation`; its default `document` mode avoids creating a
second scroller inside the page recipe. `mode="contained"` is reserved for a
standalone conversation with an explicit height boundary. `ConversationEmptyState`
renders starter suggestions only when their callback is supplied. Put `Composer`
inside `ConversationPageComposer`; its stable `storageKey` scopes browser-local
draft/history/resize preferences, while the consumer owns routing, upload requests,
object-URL cleanup, persistence, and send mutations. Attachment `acceptedTypes`
apply consistently to picker, paste, and drop. Pending uploads hold send, `busy`
keeps typing live, and a stop control appears only when `onAbort` exists.
`InspectorPanel` supplies named header/content/footer hierarchy beside a canvas
or inside `BakinDrawer`. Transport, server persistence, rich text, routing, selection,
drawer focus, and domain mutations remain consumer owned.

Workflow and action workspaces use `WorkflowPage` with a named
`WorkflowPageToolbar`, `WorkflowPageCanvas`, and `WorkflowPageActions`.
Vertical is the default graph orientation; horizontal is an explicit option.
The recipe supplies hierarchy and a bounded overflow region without importing
React Flow or owning nodes, edges, selection, graph commands, persistence,
drawers, or URL state. Use the existing routing contract for linkable selected
nodes and view modes, and provide named non-drag actions for required graph
operations.

Consequential actions and staged drafts use `ConfirmDialog`, `DangerZone`,
`SaveBar`, and `UnsavedChangesDialog` from `@makinbakin/sdk/patterns`.
Consumers retain mutation, dirty, persistence, retry, and routing behavior;
the patterns provide typed confirmation, busy/error presentation, responsive
action placement, and the save/discard/stay decision. Keep normal links and
query-only state changes on the existing SDK router contract.

Filtering and view navigation use `FacetFilter`, `AgentFilter`,
`SegmentedControl`, `UnderlineTabs`, and `SortableHead` from the same focused
patterns entrypoint. These components own searchable counts, clearing,
keyboard selection, linked-tab semantics, long-label overflow, and table sort
semantics. Consumers still own values and routing: connect linkable filters and
views to `useQueryArrayState` or `useQueryState` from
`@makinbakin/sdk/hooks`. The public `AgentFilter` accepts presentation-ready
options; host adapters may add app-owned agent metadata and avatars.

Agent identity and assignment use the same focused patterns entrypoint.
`AgentAvatar`, `AgentStatus`, and `AgentSelect` accept presentation-ready
identity, status, agent, and team options; they never fetch the registry or
team API. Status remains visible in text, and consumers keep assignment state,
heartbeat timing, URL state, and persistence. Existing official surfaces may
continue through the migration-only components adapters until fleet migration.

Asset, model, and color choices use `AssetPicker`, `ModelSelect`, and
`ColorPicker` from the focused patterns entrypoint. `AssetPicker` supports a
controlled library dialog plus inline grid or list composition with exact
loading, error, empty, and filtered states. Consumers own asset endpoints,
uploads, eligibility, attachment mutations, and route state. `ModelSelect`
groups presentation-ready catalog options by provider and exports the stable
`DEFAULT_MODEL_VALUE` sentinel; consumers own catalog loading and persistence.
`ColorPicker` provides labelled radio semantics and enabled-option keyboard
movement while consumers own palette values and saving. Existing official
surfaces may remain on the migration-only components adapters until their
incremental migration.

Schema-driven plugin forms use `PluginSettingsRenderer` from
`@makinbakin/sdk/patterns`; the settings schema and field types are co-exported
from that entrypoint. The renderer owns defaults, draft editing, validation,
list-row controls, and accessible feedback placement. Consumers own loading,
persistence, retry, route state, and the durable `busy`/`feedback` values that
describe a save result. Official surfaces may continue through the app-aware
components adapter until fleet migration.

Compact task and workflow output uses `TurnOutputView`, `TurnToolChip`, and
`foldTurnChunks` from `@makinbakin/sdk/conversation`. They share the canonical
conversation fold and tool-row semantics, keep wide code output locally
scrollable, and expose typed live, terminal, and error evidence. Markdown is
plain safe text by default; consumers that need rich content provide
`renderText`, normally with `MarkdownContent` from the opt-in
`@makinbakin/sdk/content` entrypoint. The compatibility adapter retains the
host's existing rich-Markdown behavior during migration.

Compact display patterns use `StatusBadge` and `StatTile`. Status labels carry
meaning without color, while optional icons remain decorative. Focused status
tones use `attention` and `danger`; the legacy components adapter maps the old
`warning` and `destructive` names during migration. `StatTile` is low-chrome by
default, offers an explicit bounded `surface` variant, and exposes labelled
progress values to assistive technology.

## Stylesheet

Bakin loads one shared copy of `@makinbakin/sdk/styles.css` for the host and all
installed plugins. Do not import it from a plugin client entry or copy its
contents into plugin-owned CSS.

Standalone browser previews and test harnesses do not have the Bakin host, so
they import the public artifact once at their application root:

```ts
import '@makinbakin/sdk/styles.css'
```

That package export is the exact compiled stylesheet used by the host and the
public component catalog. Plugin-owned CSS remains for domain-specific styling
and should be scoped to the plugin root.

SDK dialogs, sheets, popovers, menus, selects, and tooltips automatically keep
the host-injected plugin identity when their content is portalled. Plugin code
uses the normal primitive APIs without adding ownership wrappers or custom
portal containers for styling. Toast presentation remains host-owned; plugins
request toasts through the SDK instead of mounting a toast region.

## Repository

This package is developed alongside Bakin in the
[markhayden/bakin](https://github.com/markhayden/bakin) monorepo, under
`packages/sdk`. File issues and PRs on the main repository.

## License

Apache-2.0
