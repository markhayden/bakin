---
title: UI Style Guide
description: Build plugin interfaces from Bakin's supported SDK components, executable examples, and tested interaction contracts.
---

Bakin's UI system has two complementary references:

- This documentation explains how to choose and compose supported UI contracts.
- The [public component catalog](/docs/ui/) is the executable source of truth for SDK components, states, responsive behavior, accessibility, and interaction examples.

The catalog is built from the same release ref as these docs and contains only stories that import through supported `@makinbakin/sdk/*` entrypoints. Maintainer-only and migration stories stay in the local workbench and are mechanically excluded from the published artifact.

## Foundation Status

The catalog includes the approved Product Character foundation: Space Grotesk for interface text, JetBrains Mono for code and machine-readable values, semantic color and layout tokens, and one contextual compact rhythm for tables and other dense operational data. Operational Neutral remains comparison evidence, not a second theme or density mode.

The catalog will grow component by component as primitives, layout recipes, system states, page archetypes, and plugin examples pass their design-system checkpoints. An item appearing in the catalog documents an existing SDK contract; it does not make host internals or arbitrary Tailwind utility strings public API.

## Authoring Rule

Start with the focused SDK entrypoints: `@makinbakin/sdk/ui`, `@makinbakin/sdk/layout`, `@makinbakin/sdk/patterns`, `@makinbakin/sdk/charts`, `@makinbakin/sdk/conversation`, `@makinbakin/sdk/content`, and `@makinbakin/sdk/navigation`. Use semantic component props and documented composition patterns. The older `@makinbakin/sdk/components` barrel is migration-only and should not gain new consumers. Add plugin-owned, root-scoped CSS only for domain-specific presentation that the SDK does not cover.

:::note[Browser navigation ownership]
Use `@makinbakin/sdk/navigation` for `PluginLink`, router hooks, URL-backed
state, history-aware back behavior, and `useUnsavedChangesGuard`. Server HTTP
route declarations remain in `@makinbakin/sdk/routing`. The older hooks and
components imports remain compatibility adapters only. `useUnsavedGuard` is
deprecated because it protects browser close/reload but not in-app navigation;
new dirty surfaces use the complete guard.
:::

Do not copy host components into a plugin. If the same need recurs across official or third-party plugins, propose it as an SDK contract with its public story, interaction test, accessibility coverage, and responsive states.

## Page and Flow Layout

Use `PageShell`, `Stack`, and `Inline` from `@makinbakin/sdk/layout` for routine page composition. They expose finite semantic choices instead of host Tailwind classes:

| Need | Component | Contract |
| --- | --- | --- |
| Bound a routable page inside Bakin's existing main landmark | `PageShell` | Choose `width="content"`, `"wide"`, or `"full"`; insets respond to the available container |
| Establish vertical rhythm | `Stack` | Choose a named `gap` and optional cross-axis `align` |
| Arrange peer content or actions | `Inline` | Wraps by default; choose named `gap`, `align`, and `justify` values |

```tsx
import { Inline, PageShell, Stack } from '@makinbakin/sdk/layout'
import { Button } from '@makinbakin/sdk/ui'

export function TasksPage() {
  return (
    <PageShell width="wide">
      <Inline as="header" align="start" justify="between" gap="section">
        <Stack gap="dense">
          <p>Tasks / live operations</p>
          <h1>Coordinate active work</h1>
          <p>Keep owners, timing, and operational context visible.</p>
        </Stack>
        <Inline as="nav" aria-label="Page actions" gap="dense">
          <Button variant="outline">Export view</Button>
          <Button>New task</Button>
        </Inline>
      </Inline>

      <Stack as="section" gap="section" aria-labelledby="active-tasks-title">
        <h2 id="active-tasks-title">Active tasks</h2>
        {/* Domain content */}
      </Stack>
    </PageShell>
  )
}
```

`PageShell` renders a `div` because the host already owns the page's `main` landmark. Its default `wide` width, `default` padding, and `page` gap suit most index and overview pages. Use `content` for reading and form flows, `full` for a bounded internal canvas, `compact` padding for evidence-backed dense work, and `none` only when another supported recipe owns every inset.

The shared gap vocabulary is `none`, `dense`, `item`, `section`, and `page`. Prefer the default `Inline` wrapping behavior so actions and metadata remain available at 320px. Set `wrap={false}` only inside a deliberately bounded region whose owning recipe supplies reflow or internal scrolling. The `as` prop changes semantics among the supported wrappers; it does not alter layout styling.

Use the remaining layout helpers when content needs two-dimensional reflow, section separation, or intrinsic width:

| Need | Contract |
| --- | --- |
| Equal responsive columns | `Grid layout="split"`, `"thirds"`, or `"quarters"` |
| Repeating object cards | `Grid layout="cards"`; the recipe adds columns when the container can hold them |
| Primary content with supporting context | `Grid layout="main-aside"`; the aside moves below the main content when space is limited |
| A named page region | `Section`; use `spacing="compact"`, `"default"`, or `"generous"`, and `divider="top"` only when peer sections need a visible boundary |
| A wide table, chart, or canvas | `BoundedOverflow`; supply `label` or `labelledBy` so its keyboard-scrollable region has an accessible name |

```tsx
import { BoundedOverflow, Grid, Section } from '@makinbakin/sdk/layout'

<Section aria-labelledby="operations-title">
  <h2 id="operations-title">Active operations</h2>
  <Grid layout="main-aside" gap="section">
    <BoundedOverflow label="Active operation details">
      <table>{/* Intrinsically wide data */}</table>
    </BoundedOverflow>
    <aside>{/* Supporting context */}</aside>
  </Grid>
</Section>
```

Grid recipes respond to their own available container, not the browser viewport. Do not recreate their internal breakpoints in plugin code. `single`, `split`, `thirds`, and `quarters` describe equal-column intent; `cards` and `main-aside` cover the two recurring unequal cases found across official surfaces. If a layout does not fit one of these recipes, compose `Stack` and `Inline` first and bring repeated evidence to the design-system review before adding another public option.

`BoundedOverflow` is intentionally horizontal. The child owns its intrinsic width, while the boundary prevents that width from escaping the page and provides keyboard focus for scrolling. It is not a general-purpose nested page scroller and does not set arbitrary heights.

## List and Detail Page Recipes

Use `@makinbakin/sdk/patterns` once a page is more specific than a general layout. The list and detail recipes standardize page identity, actions, responsive flow, named state boundaries, and scroll ownership without taking over application state:

| Need | Component | Contract |
| --- | --- | --- |
| Identify any routed page | `PageHeader` | Renders the page's single `h1`; optional navigation, eyebrow, description, metadata, compact controls, and actions keep one order at every width |
| Build a searchable or filterable index | `ListPage` | Uses the routine wide canvas; `full` is reserved for genuinely intrinsic-width domain content |
| Keep query controls available | `ListPageControls` | Requires an accessible region name and reflows search, filters, sorting, and peer actions without owning their values |
| Bound list results and replacement states | `ListPageContent` | Requires an accessible region name; `state` replaces only the results, while `feedback` can remain beside stale usable content |
| Build one resource or record page | `DetailPage` | Uses `wide` by default or `content` for a focused single-column record |
| Compose detail content | `DetailPageBody`, `DetailPageMain`, and `DetailPageAside` | Choose `single` or `aside`; a named aside moves below the primary content when its container is narrow |

```tsx
import { useQueryState } from '@makinbakin/sdk/navigation'
import {
  ListPage,
  ListPageContent,
  ListPageControls,
  PageHeader,
  SearchInput,
  SegmentedControl,
} from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'

export function TasksPage({ matchingTasks }: { matchingTasks: Array<{ id: string; title: string }> }) {
  const [status, setStatus] = useQueryState('status', 'all')
  const [query, setQuery] = useQueryState('q', '')
  const [view, setView] = useQueryState('view', 'board')

  return (
    <ListPage>
      <PageHeader
        eyebrow="Tasks / live operations"
        title="Coordinate active work"
        description="Keep owners, timing, and operational context visible."
        controlsLabel="Task search and view"
        controls={(
          <>
            <SearchInput label="Search tasks" value={query} onValueChange={setQuery} />
            <SegmentedControl
              ariaLabel="Task view"
              value={view}
              onValueChange={setView}
              options={[{ value: 'board', label: 'Board' }, { value: 'log', label: 'Log' }]}
            />
          </>
        )}
        actions={<Button>New task</Button>}
      />
      <ListPageControls label="Task list controls">
        <Button aria-pressed={status === 'blocked'} onClick={() => setStatus('blocked')}>
          Blocked
        </Button>
      </ListPageControls>
      <ListPageContent
        label="Task results"
        state={matchingTasks.length === 0 ? (
          <SystemState
            kind="no-results"
            title="No tasks match"
            action={<Button onClick={() => setStatus('all')}>Clear filters</Button>}
          />
        ) : undefined}
      >
        <ul>{matchingTasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul>
      </ListPageContent>
    </ListPage>
  )
}
```

`PageShell` owns the page canvas and insets, `PageHeader` owns page identity and
the responsive header toolbar, and `Stack` or `Section` owns the content flow
below it. Put one compact `SearchInput` and peer view navigation in
`PageHeader controls` when they must remain beside the primary action. The
search reserves its expanded width, so focus never repacks that desktop row.
It starts at 14rem, expands to the available 22rem slot, and collapses on blur
to fit the controlled query up to that cap; longer values remain intact and
truncate with an ellipsis behind the pattern's accessible clear action. Do not
add or restyle the browser-native search cancel control. At narrower header
containers, the whole toolbar stacks at the documented container breakpoint.
Put broader facets, sorting, pagination,
and clear-all actions in `ListPageControls` instead of crowding the header.

Production filters, search, sorting, pagination, selected tabs, and open overlays continue to use the existing query-state hooks. `useQueryState` uses replace semantics for routine view changes and batches multiple setters from one interaction; do not add local history wrappers or rebuild query strings in the recipe. Paths still identify pages. Use the existing `PluginLink` for back links and cross-page navigation:

```tsx
import { PluginLink } from '@makinbakin/sdk/navigation'
import {
  DetailPage,
  DetailPageAside,
  DetailPageBody,
  DetailPageMain,
  PageHeader,
} from '@makinbakin/sdk/patterns'

export function WorkflowDetail() {
  return (
    <DetailPage>
      <PageHeader
        navigation={<PluginLink to="/workflows">Back to workflows</PluginLink>}
        title="Launch approval"
      />
      <DetailPageBody layout="aside">
        <DetailPageMain>{/* Semantic detail sections */}</DetailPageMain>
        <DetailPageAside label="Workflow context">{/* Owner, schedule, related objects */}</DetailPageAside>
      </DetailPageBody>
    </DetailPage>
  )
}
```

`state` is for initial loading, empty, unavailable, permission, or fatal error content that replaces the owning region. During a refresh, retain usable rows or detail sections, set `busy`, and use `feedback` for a `Banner` or inline status instead. Page header, navigation, and controls should not disappear merely because a result request failed.

The host owns the page's `main` landmark and vertical scroll. These recipes therefore render no nested `main`, fixed-height page pane, or vertical scroller. Put a truly wide table or canvas inside `BoundedOverflow`; do not make the entire list or detail body horizontally scrollable.

These are compositional recipes, not page controllers. Do not pass them fetchers, route definitions, filter schemas, resource arrays, or plugin-specific callbacks. Do not use `PageHeader` inside a dialog, drawer, or embedded slot, and do not add a second `h1` inside the page body. Domain CSS may style the actual rows or record content under the plugin's ownership root; it should not recreate the recipe's insets, heading scale, action placement, breakpoints, or state spacing.

## Settings and Dashboard Page Recipes

Settings and dashboards share the same `PageHeader`, state selection, and host-owned scroll contract, but they solve different hierarchy problems:

| Need | Component | Contract |
| --- | --- | --- |
| Build a focused form or multi-category configuration page | `SettingsPage` | Uses `wide` by default for category navigation; choose `content` for one focused form |
| Arrange categories and the active form | `SettingsPageBody` | Choose `single` or `navigation`; category navigation moves above content when the container narrows |
| Name the settings category chooser | `SettingsPageNavigation` | Requires `label` or `labelledBy`; selected category and routing remain consumer owned |
| Bound the active settings category | `SettingsPageContent` | Requires an accessible name; `state` replaces only the active form, while `feedback` retains dirty, validation, save, or provider context |
| Build an operational or diagnostic overview | `DashboardPage` | Uses `wide` by default; `full` is reserved for evidence-backed overview breadth |
| Bound overview data and states | `DashboardPageContent` | Requires an accessible name; compose priority inside with `Section`, `Stack`, and `Grid` |

```tsx
import { Grid, Section } from '@makinbakin/sdk/layout'
import {
  DashboardPage,
  DashboardPageContent,
  PageHeader,
  SettingsPage,
  SettingsPageBody,
  SettingsPageContent,
  SettingsPageNavigation,
} from '@makinbakin/sdk/patterns'
import { Button, Form, FormActions, SubmitButton } from '@makinbakin/sdk/ui'

export function PluginSettings() {
  return (
    <SettingsPage>
      <PageHeader title="Settings" />
      <SettingsPageBody layout="navigation">
        <SettingsPageNavigation label="Settings categories">
          {/* Client-routed category controls */}
        </SettingsPageNavigation>
        <SettingsPageContent labelledBy="plugin-settings-heading">
          <h2 id="plugin-settings-heading">Official plugins</h2>
          <Form>
            {/* Canonical fields and semantic sections */}
            <FormActions><SubmitButton>Save settings</SubmitButton></FormActions>
          </Form>
        </SettingsPageContent>
      </SettingsPageBody>
    </SettingsPage>
  )
}

export function HealthOverview() {
  return (
    <DashboardPage>
      <PageHeader title="Health" actions={<Button>Run checks</Button>} />
      <DashboardPageContent label="Health overview">
        <Section aria-labelledby="platform-pulse-heading">
          <h2 id="platform-pulse-heading">Platform pulse</h2>
          {/* Lead condition and its action */}
        </Section>
        <Grid layout="main-aside" gap="section">
          <Section>{/* Actionable incidents */}</Section>
          <Section>{/* Supporting context */}</Section>
        </Grid>
      </DashboardPageContent>
    </DashboardPage>
  )
}
```

Keep a settings category in query parameters when selecting it changes a meaningful, linkable view. Values, schema discovery, validation, dirty state, submission, and navigation guards stay with the consuming form and the existing router. Place category-local actions in `FormActions`; do not put routine save buttons in `PageHeader`. During submit or refresh, retain usable fields, set `busy`, and use `feedback` for durable validation or save context. Replace only `SettingsPageContent` when the active provider cannot load so other categories remain available.

Keep dashboard view state such as tabs, time ranges, expanded evidence, and selected agents in the same existing query-parameter contract. The recipe does not fetch telemetry, calculate metrics, refresh checks, or prescribe one metric component. Start with the condition and action that matter most, follow with a short summary, then group supporting operational sections. Use cards only for true bounded objects; do not make every metric and section an equal-weight card.

Neither recipe owns a `main` landmark, vertical page scroller, fixed height, sticky save behavior, or URL parsing. Wide charts and tables still go inside `BoundedOverflow`. If usable stale dashboard data survives a refresh failure, retain it with `busy` and a `Banner` in `feedback`; use `state` only when the overview has no usable content.

## Conversation and Inspector Recipes

`ConversationPage` and `InspectorPanel` establish interaction geometry before the focused conversation kit and domain-specific inspectors add behavior:

| Need | Component | Contract |
| --- | --- | --- |
| Bound a routed conversation | `ConversationPage` | Uses a focused content canvas by default; `wide` supports evidence-backed adjacent context |
| Choose scroll ownership | `ConversationPageBody` | `document` keeps host page scrolling; `contained` gives only the named timeline an internal vertical scroller |
| Name new message announcements | `ConversationPageTimeline` | Renders a polite `log`; supply `label` or `labelledBy` and place message rendering inside |
| Keep composition outside the log | `ConversationPageComposer` | Stable boundary for the focused conversation kit's composer and attachments |
| Compose contextual inspection | `InspectorPanel` | A named region usable beside a canvas or inside `BakinDrawer` |
| Preserve inspector hierarchy | `InspectorPanelHeader`, `InspectorPanelContent`, `InspectorPanelFooter` | Identity and close actions remain while only content changes state; local commit/destructive actions stay in the footer |

Use `mode="document"` for ordinary chat history where the host page owns vertical scroll. Use `contained` only when a parent surface supplies a deliberate available block size and the composer must remain available; the timeline then becomes the single nested scroller. Do not add a second scrolling message wrapper. The recipe does not own message rendering, folding, tool activity, streaming transport, attachments, send behavior, or scroll-to-latest policy; compose those from the isolated conversation entrypoint described below.

An inspector is contextual, not a second detail page. Use `InspectorPanel` inside the existing responsive `Grid layout="main-aside"` for persistent context, or as the content hierarchy inside the existing `BakinDrawer` when selection opens an overlay. The drawer continues to own focus, dismissal, resizing, and dirty-state confirmation. Inspector selection, open state, tabs, and expanded evidence belong in query parameters when they are meaningful linkable view state; the recipe never parses URLs.

`state` on `ConversationPageBody` replaces the whole conversation work area but preserves the page header. `state` on `InspectorPanelContent` preserves inspector identity, close controls, and valid footer actions. During reconnects or refreshes, retain usable history or inspector fields with `busy` and `feedback` instead.

## Workflow and Action Recipe

`WorkflowPage` defines the page hierarchy around a consumer-owned graph, board, or action workspace without adding a graph library to the base patterns bundle:

| Need | Component | Contract |
| --- | --- | --- |
| Bound a workflow workspace | `WorkflowPage` | Uses the full page canvas by default; `wide` is available for smaller action flows |
| Choose layout and scroll ownership | `WorkflowPageBody` | `canvas` or responsive `inspector` composition; `document` host scroll by default or explicitly bounded `contained` mode |
| Separate graph commands | `WorkflowPageToolbar` | Required accessible name for orientation, layout, zoom, palette, or other consumer-owned commands |
| Bound the interactive graph | `WorkflowPageCanvas` | Required accessible name, keyboard-scrollable overflow boundary, and `vertical` or `horizontal` orientation metadata |
| Keep page decisions stable | `WorkflowPageActions` | Named commit, recovery, approval, or rejection actions outside the canvas interaction model |

Vertical is the Product Character default because most Bakin workflows progress top to bottom. Horizontal remains an explicit supported option for topologies that read better left to right. `orientation` describes the canvas to CSS, tests, and assistive tooling; the consumer must pass the same value to its node positions, handles, edge layout, minimap placement, and named movement actions. The public catalog demonstrates both options with real React Flow. `@makinbakin/sdk/patterns` does not import React Flow, calculate nodes or edges, or own graph selection, pan, zoom, connection, keyboard movement, persistence, dirty state, or auto-layout.

Use `WorkflowPageToolbar` for commands that change how the graph is operated. Keep route-level actions such as save, approve, reject, retry, or delete in `WorkflowPageActions`, and keep global page actions in `PageHeader`. Pointer dragging can be supported, but every required operation needs a keyboard or named non-drag action. Put a selected-node `InspectorPanel` beside the canvas with `layout="inspector"`; use the existing `BakinDrawer` when narrow or task-specific behavior needs an overlay. The drawer continues to own focus, dismissal, resizing, and dirty confirmation.

The existing routing contract remains authoritative. Paths identify workflow pages; query parameters may identify a selected node, drawer, tab, orientation, or other meaningful linkable view state. Keep defaults clean and do not encode transient pan/zoom coordinates unless the product explicitly makes them shareable. The recipe never parses or changes URLs.

Use `state` when no usable workspace can be rendered; it replaces the body while preserving `PageHeader`. Keep a usable graph visible during saves, refreshes, review outcomes, or partial failures with `busy` and `feedback`. `contained` mode is only for a parent that supplies a deliberate available block size; it does not create a second document scroller.

## Destructive and Dirty-State Recipe

Use the focused patterns entrypoint for consequential actions and staged drafts:

| Need | Component | Contract |
| --- | --- | --- |
| Confirm one consequential action | `ConfirmDialog` | Caller owns open, busy, error, retry, and mutation state; use `confirmValue` only when an exact typed value is warranted |
| Keep a staged draft actionable | `SaveBar` | Caller owns dirty comparison, persistence, and discard; the pattern supplies dirty, saving, retryable error, and brief saved presentation |
| Separate irreversible settings | `DangerZone` | Place after routine settings, state the consequence in words, and route through the same typed `ConfirmDialog` engine |
| Resolve navigation with a dirty draft | `UnsavedChangesDialog` | Presentation-only save, discard, and stay decision; a router-aware consumer decides when it opens and what continuation means |

```tsx
import { ConfirmDialog, SaveBar } from '@makinbakin/sdk/patterns'

export function WorkflowDraft({ dirty, saving, error, save, discard }) {
  return (
    <>
      {/* Consumer-owned workflow fields */}
      <SaveBar
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={save}
        onDiscard={discard}
      >
        3 fields changed
      </SaveBar>
      <ConfirmDialog
        open={false}
        title="Delete archived workflow?"
        description="This permanently deletes the definition and run history."
        confirmLabel="Delete workflow"
        confirmValue="launch-publishing"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </>
  )
}
```

SaveBar is the one page-level save/discard boundary for a staged draft. Do not repeat the same save action in `PageHeader`, `FormActions`, or a sticky footer. Its DOM keeps the secondary action before the primary action; its responsive layout stacks full-width actions at narrow container widths without changing keyboard order. Keep a failed draft dirty, pass the durable error back to `error`, and let the same primary action become **Retry save**. Set `saving` while the request is in flight, then clear `dirty` only after persistence succeeds so the saved acknowledgement is truthful.

ConfirmDialog and DangerZone do not call APIs, remove records, close after success, or invent rollback. The consumer keeps the dialog open with `busy`, retains retryable failures in `error`, and closes it when the operation actually succeeds. Typed confirmation is exact and case-sensitive. Use it for genuinely difficult-to-recover actions, not routine archive, disable, or remove-from-view operations. DangerZone adds a visible non-color warning signal and supports heading levels 2–4 so it can preserve the surrounding page hierarchy. When an external button controls `ConfirmDialog` or `UnsavedChangesDialog`, pass that button's ref to `finalFocus`; DangerZone wires its own trigger automatically.

The recent routing work remains authoritative; these presentation patterns do not recreate it. Paths identify pages. Query parameters hold overlay, tab, filter, selection, and other meaningful view state. `useUnsavedChangesGuard` from `@makinbakin/sdk/navigation` is the supported behavior layer for browser unload, TanStack history, and raw same-origin anchors. It deliberately allows query-only changes on the current pathname and must keep those changes inside the SPA router.

There is one pinned exception to the no-hard-navigation rule: after the user explicitly confirms an intercepted raw same-origin anchor, the guard may continue that exact href with `window.location.assign`. Do not widen that exception or use it for ordinary links. Use `PluginLink`, `useRouter()`, and the navigation entrypoint's query-state hooks for normal navigation. The deprecated `useUnsavedGuard(dirty)` covers only browser close/reload; it is not a replacement for the complete guard and must not be used by new surfaces.

## Action and Status Primitives

The first supported primitive set covers actions, compact state, contextual messages, and measurable work:

| Need | Component | Choose with |
| --- | --- | --- |
| Trigger an action | `Button` | semantic `variant` and `size` |
| Label compact state or metadata | `Badge` | independent `tone`, `variant`, and `size` |
| Explain a page- or section-level condition | `Alert` | semantic `tone` |
| Show determinate or indeterminate work | `Progress` | `value`, accessible label, `tone`, and `size` |

```tsx
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@makinbakin/sdk/ui'

export function ImportStatus() {
  return (
    <section aria-labelledby="import-status-heading">
      <h2 id="import-status-heading">Import</h2>
      <Badge tone="attention">Waiting for review</Badge>
      <Progress value={64}>
        <ProgressLabel>Importing assets</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Alert tone="danger">
        <AlertTitle>Three assets need attention</AlertTitle>
        <AlertDescription>Resolve the conflicts before publishing.</AlertDescription>
      </Alert>
      <Button variant="primary">Review conflicts</Button>
    </section>
  )
}
```

Use one primary action per local decision area. `secondary`, `outline`, and `ghost` reduce emphasis; `danger` is reserved for destructive consequences. `warning`, `info`, and `accent` communicate specific context and should not replace clear action labels. Icon-only buttons need an accessible name.

For badges, `tone` describes meaning (`neutral`, `primary`, `success`, `attention`, `danger`, or `accent`) while `variant` describes visual treatment (`soft`, `solid`, `outline`, `ghost`, or `link`). Do not encode status only with color: keep the text explicit. Badges label state; buttons change it.

Routine alerts announce with `role="status"`. Danger alerts default to `role="alert"`, so reserve them for conditions that need immediate assistive-technology announcement. Progress accepts an exact `value` for determinate work or `null` for indeterminate work; always supply a visible `ProgressLabel` or an `aria-label`.

`buttonVariants()` and `badgeVariants()` are supported escape hatches for links and render integrations that must share a primitive's visual treatment while preserving the correct native element. They do not make the generated class string, arbitrary Tailwind utilities, or internal DOM structure part of the SDK contract. Prefer the component whenever it has the right semantics.

Existing `default` and `destructive` action variants and `default`, `secondary`, and `destructive` badge variants remain compatibility aliases while owned consumers migrate. New work uses the semantic names above.

## Surface and Content Primitives

The surface/content set covers bounded objects, compact identity, content boundaries, loading presentation, and optional disclosure:

| Need | Component | Contract |
| --- | --- | --- |
| Represent a coherent bounded object | `Card` and its subparts | Use for an entity, record, or grouped data—not page layout |
| Show compact identity | `Avatar`, `AvatarFallback`, and group helpers | Pair the visual with a visible or accessible identity name |
| Reinforce a real content boundary | `Separator` | Decorative by default; opt into separator semantics deliberately |
| Approximate content while a labelled region loads | `Skeleton` | Silent by default and motion-reduced automatically |
| Reveal optional supporting detail | `Collapsible` and its trigger/content | The trigger owns expanded state, focus, and panel association |

```tsx
import {
  Avatar,
  AvatarFallback,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Skeleton,
} from '@makinbakin/sdk/ui'

export function WorkflowObject({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <section aria-labelledby="workflow-loading" aria-busy="true">
        <h2 id="workflow-loading">Loading workflow</h2>
        <Skeleton shape="text" />
      </section>
    )
  }

  return (
    <Card aria-labelledby="workflow-title">
      <CardHeader>
        <CardTitle id="workflow-title">Launch review</CardTitle>
        <CardDescription>Coordinates final publishing approval.</CardDescription>
        <CardAction><Avatar><AvatarFallback>AM</AvatarFallback></Avatar></CardAction>
      </CardHeader>
      <CardContent>Two approvals are waiting.</CardContent>
      <Collapsible>
        <CollapsibleTrigger>Advanced retry policy</CollapsibleTrigger>
        <CollapsibleContent>Retry twice before blocking the run.</CollapsibleContent>
      </Collapsible>
      <CardFooter>Updated 8 minutes ago</CardFooter>
    </Card>
  )
}
```

Card is intentionally not a layout primitive. Build page and section hierarchy from headings, semantic sections, whitespace, responsive layout primitives, surface shifts, and occasional dividers. A page made of bordered panels—or a Card nested inside another bordered Card—is a design-system failure, even if each individual component is valid. Reserve Card for an object whose boundary still makes sense when the object moves elsewhere.

`Skeleton` does not announce itself. Put `aria-busy="true"` and a useful accessible name on the region being loaded. Use `shape="text"`, `"circle"`, or `"rectangle"` to approximate broad geometry, and keep the loading preview simpler than the final interface.

Collapsible is for supporting detail that can safely start hidden. Required decisions, errors, and primary actions stay visible. Its trigger already supplies button behavior, `aria-expanded`, and the panel relationship; do not recreate that state with a clickable `div`.

## Text-Field Primitives

The text-field set standardizes the native entry controls and their composable adornments:

| Need | Component | Contract |
| --- | --- | --- |
| Name a control | `Label` | Associate it with `htmlFor`; an in-control hint is never the label |
| Capture one line | `Input` | Preserve the correct `type`, `inputMode`, `autoComplete`, and native state attributes |
| Capture multiline content | `Textarea` | Retain vertical resizing and the same native state contract |
| Join context or a local action to one control | `InputGroup` and its subparts | The editable control keeps its own accessible label |

```tsx
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  Label,
} from '@makinbakin/sdk/ui'

export function RepositoryField() {
  return (
    <div>
      <Label htmlFor="repository-path">Repository path</Label>
      <p id="repository-help">Enter the owner and repository name.</p>
      <InputGroup aria-label="Repository address">
        <InputGroupAddon>
          <InputGroupText>github.com/</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id="repository-path"
          aria-describedby="repository-help"
          autoComplete="off"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton>Paste</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
```

These are deliberately low-level controls. Preserve `required`, `readOnly`, `disabled`, and `aria-invalid` as real attributes, and associate descriptions and error messages through `aria-describedby`. Use `type`, `inputMode`, and `autoComplete` deliberately so browsers can supply the correct validation, autofill, and mobile keyboard behavior. InputGroup adornments provide context; they do not replace a visible label or recovery message.

A raw native input or textarea is an exception path, not a styling shortcut. Use one only when an unusual domain interface cannot retain its behavior through the SDK primitive. The exception must record that reason in review, use semantic Bakin tokens, remain under the plugin's scoped root, preserve the same accessible names and states, and include focused story or browser coverage. Routine forms and cosmetic variations do not qualify.

## Field and Form Composition

Routine forms use the canonical composition from `@makinbakin/sdk/ui`. It owns the relationships and presentation that low-level controls cannot establish by themselves:

| Need | Component | Contract |
| --- | --- | --- |
| Label and explain one value | `Field`, `FieldLabel`, and `FieldDescription` | The visible label and every mounted message are registered on the real control automatically |
| Show field validation | `FieldError` | Native, async, external, and server errors share one associated recovery location |
| Associate a native control | `FieldControl` | Renders a styled input by default; use its `render` prop for `Textarea` and other native controls |
| Group related choices | `Fieldset`, `FieldsetLegend`, `FieldsetDescription`, and `FieldGroup` | Legend and description are associated with the group; `disabled` propagates to its fields |
| Finish and submit a form | `Form`, `FormActions`, and `SubmitButton` | Actions stack at narrow widths; one `busy` value marks the form and disables duplicate submission |

```tsx
import {
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Form,
  FormActions,
  Input,
  SubmitButton,
  Textarea,
} from '@makinbakin/sdk/ui'

type Settings = { workspaceName: string; summary: string }

export function WorkspaceSettings({ busy }: { busy: boolean }) {
  return (
    <Form<Settings>
      busy={busy}
      errors={{ workspaceName: 'This workspace name is already registered.' }}
      onFormSubmit={(values) => saveSettings(values)}
    >
      <Field name="workspaceName">
        <FieldLabel requirement="required">Workspace name</FieldLabel>
        <FieldDescription>Shown in page chrome and plugin contributions.</FieldDescription>
        <Input required autoComplete="organization" />
        <FieldError />
      </Field>

      <Field name="summary">
        <FieldLabel requirement="optional">Operational summary</FieldLabel>
        <FieldControl render={<Textarea rows={4} />} />
        <FieldDescription>Markdown is supported.</FieldDescription>
      </Field>

      <FormActions>
        <Button type="button" variant="outline">Cancel</Button>
        <SubmitButton busyLabel="Saving settings">Save settings</SubmitButton>
      </FormActions>
    </Form>
  )
}
```

Put `name` on `Field` so `Form` can collect its value and return external `errors` to it. `Field` recognizes SDK `Input`, `Checkbox`, `Switch`, and `Select` controls directly. Use `FieldControl render={<Textarea />}` when a native control needs to join the same association and validation context.

The `requirement` label prop standardizes visible “Required” or “Optional” copy; it does not replace native behavior. A required value must also set `required` on its control. Likewise, `readOnly`, `disabled`, `type`, `inputMode`, and `autoComplete` remain real control attributes.

Use `validate` on `Field` for domain validation, including asynchronous checks, and use the `errors` object on `Form` for server-returned errors keyed by field name. Prefer `onFormSubmit` to manual `preventDefault` handling. On a failed submission, keep a page- or form-level explanation near the form and put the actionable message in the affected `FieldError`; on success, announce concise confirmation without replacing the page.

Form-state libraries may own values, dirty state, and orchestration. Their adapters must pass that state into these SDK components instead of rendering their own labels, descriptions, error wrappers, spacing, or submit buttons. In particular, apply a library's `register` or controller props to the actual SDK control and map its invalid state to `Field invalid` plus `FieldError match`; do not wrap the control in a second presentation system.

## Selection Primitives

Choose the control by interaction model rather than appearance:

| Need | Component | Contract |
| --- | --- | --- |
| Choose an independent yes/no value or several items | `Checkbox` | Mixed represents a parent with partially selected children; it is not a third saved value |
| Change one binary setting immediately | `Switch` | The visible copy names the setting and nearby status copy can confirm the effect |
| Choose one value from a bounded list | `Select` and its subparts | The field needs a visible label; groups organize options but do not label the field |

```tsx
import {
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@makinbakin/sdk/ui'

const runtimeLabels = {
  '': 'No runtime',
  pi: 'Pi',
  openclaw: 'OpenClaw',
}

export function ExecutionSettings() {
  return (
    <section aria-labelledby="execution-settings-heading">
      <h2 id="execution-settings-heading">Execution</h2>

      <div>
        <Checkbox id="include-archived" name="includeArchived" />
        <Label htmlFor="include-archived">Include archived tasks</Label>
      </div>

      <div>
        <Switch id="retry-failures" name="retryFailures" />
        <Label htmlFor="retry-failures">Retry failures automatically</Label>
      </div>

      <div>
        <Label htmlFor="execution-runtime">Execution runtime</Label>
        <Select name="runtime" items={runtimeLabels} defaultValue="openclaw">
          <SelectTrigger id="execution-runtime">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No runtime</SelectItem>
            <SelectItem value="pi">Pi</SelectItem>
            <SelectItem value="openclaw">OpenClaw</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}
```

All selection controls preserve at least a 24 CSS-pixel interactive target, including `Switch size="sm"` and `SelectTrigger size="sm"`. Do not shrink them with plugin CSS. Keep long Checkbox and Switch labels wrapping beside the control, not underneath it.

Pass `items` to Select when the submitted value and visible label differ; this lets `SelectValue` render the human label instead of the raw value. An item with `value=""` is an explicit “none” option. The unselected prompt describes the missing selection but never replaces the field label. Use `required`, `disabled`, and `aria-invalid` on the owning Select/trigger as shown in the catalog, and connect recovery copy with `aria-describedby`.

Select's popup is the first consumer of the system-owned option/list presentation. Dropdown menus and Command reuse that private presentation contract as they graduate; generated class strings and popup DOM remain implementation details.

## Modal and Side-Overlay Primitives

Choose the overlay by the work it contains:

| Need | Component | Contract |
| --- | --- | --- |
| Resolve a short, blocking decision | `Dialog` and its subparts | Keep the decision focused, label it with `DialogTitle`, and return focus to the trigger on close |
| Inspect or edit contextual detail | `Sheet` and its subparts | Use the right side by default; top, bottom, and left are deliberate spatial choices |
| Compose a long, product-level detail experience | `BakinDrawer` + `BakinDrawerSection` | Use the supported resizable right panel and its canonical title/content hierarchy, with optional back, actions, dirty-state, and width persistence |

```tsx
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@makinbakin/sdk/ui'

export function DeleteConnection() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="danger" />}>
        Delete connection
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete runtime connection?</DialogTitle>
          <DialogDescription>
            Agents using this connection will stop dispatching until another runtime is assigned.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep connection</DialogClose>
          <Button variant="danger">Delete connection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Every Dialog, Sheet, and BakinDrawer needs an accessible title. Use the matching visible title component whenever possible; when a BakinDrawer intentionally omits visible heading copy, supply `ariaLabel`. Default close controls are already labelled. Set `showCloseButton={false}` only when the composition supplies an equally discoverable close action.

Set `busy` on the owning Dialog, Sheet, or BakinDrawer while irreversible work is in flight. Busy overlays expose `aria-busy` and block Escape, outside-click, close-button, and programmatic dismissal until the operation resolves. They do not disable application controls automatically, so disable or otherwise guard conflicting actions in the content too.

Sheets use the right side by default and become full-viewport panels on narrow screens. A BakinDrawer adds mouse and keyboard resizing on wider screens: Arrow keys adjust its width, Shift increases the step, and Home or End chooses the minimum or maximum. Pass `storageKey` when separate drawer contexts should remember independent widths. Use `dirty` to require confirmation before discarding local edits.

Compose BakinDrawer content with `BakinDrawerSection`. The section title aligns to the drawer gutter while its body receives the canonical additional inset, so detail copy, form fields, assets, and activity rows do not sit against either wall. Use the optional `actions` slot for section-scoped controls rather than building a second ad hoc section header.

The overlay portal is system-owned by default. In a standalone or contained host, pass the supported `portalProps={{ container }}` contract to `DialogContent` or `SheetContent`; do not relocate generated popup DOM or copy overlay z-index classes. URL-backed overlay state continues to follow the existing routing contract described below.

## Anchored Overlays and Command

Choose the layer by interaction rather than visual size:

| Need | Component | Contract |
| --- | --- | --- |
| Show contextual content or lightweight controls | `Popover` | Provide a title and description when the content needs an accessible name |
| Offer actions for the current object | `DropdownMenu` | Use semantic items, nested menus sparingly, and `variant="danger"` for destructive actions |
| Add concise supplemental help | `Tooltip` | Keep required instructions and errors visible without it; icon-only triggers still need their own accessible name |
| Search and invoke a larger action set | `Command` or `CommandDialog` | Supply a meaningful `label`; group related results and preserve keyboard selection |

```tsx
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@makinbakin/sdk/ui'

export function TaskActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Task actions
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>
          Duplicate
          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem variant="danger">Delete task</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

Shortcut hints are visual affordances and are hidden from accessible names by default. `variant="destructive"` remains a compatibility alias, but new code uses the shared semantic `danger` vocabulary. Anchored layers share bounded collision behavior and a minimum interactive-item target; do not copy their generated popup or option-list classes.

Popover, DropdownMenu, and Tooltip content accept `portalProps={{ container }}` for contained hosts. `CommandDialog` accepts the same setting through `contentProps={{ portalProps: { container } }}`. When application state controls a CommandDialog from outside its trigger tree, also pass `contentProps={{ finalFocus: triggerRef }}` so closing returns keyboard focus intentionally.

These components do not redefine navigation. If an overlay, selected result, filter, or tab belongs in browser history, keep it in the existing URL query-state contract described below.

## System States and Feedback

Choose the state from what happened, not from the amount of blank space:

| Situation | Component | Required behavior |
| --- | --- | --- |
| The product has no items yet | `SystemState kind="initial-empty"` | Explain the value of creating or connecting the first item; offer that next action when it exists |
| Data exists but the current query hides it | `SystemState kind="no-results"` | Keep the search and filters intact and provide the required clear or adjust action |
| A bounded region is waiting for data | `SystemState kind="loading"` with optional `Skeleton` preview | Name what is loading, mark the region busy, and keep the preview simpler than the final content |
| A request failed and can be repeated | `SystemState kind="error"` with an action | Explain what remains usable and provide recovery; the error is announced assertively |
| An error has no valid recovery | `SystemState kind="error" recovery="unavailable"` | State the consequence honestly without rendering a dead retry action |
| Policy prevents access | `SystemState kind="permission-denied"` | Explain the boundary without presenting missing permission as a technical failure |
| Context must remain visible with the page | `Banner` | Keep persistent notices quiet by default; opt into `announce="polite"` or `"assertive"` only when the mounted change is new information |
| A background action needs brief confirmation | `toast()` from `@makinbakin/sdk/hooks` | Let the Bakin shell own placement and dismissal; never put the only copy of a durable error or required action in a toast |

```tsx
import { Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'

export function WorkflowResults({ status }: { status: 'loading' | 'empty' | 'none' | 'error' }) {
  if (status === 'loading') {
    return (
      <SystemState
        kind="loading"
        title="Loading workflows"
        description="Current workflow definitions will appear here."
        preview={<Skeleton shape="text" />}
      />
    )
  }

  if (status === 'empty') {
    return (
      <SystemState
        kind="initial-empty"
        title="No workflows yet"
        description="Create the first workflow or install one from a plugin."
        action={<Button>Create workflow</Button>}
      />
    )
  }

  if (status === 'none') {
    return (
      <SystemState
        kind="no-results"
        title="No workflows match"
        description="The current owner and status filters hide every workflow."
        action={<Button variant="outline">Clear filters</Button>}
      />
    )
  }

  return (
    <SystemState
      kind="error"
      title="Workflows could not be refreshed"
      description="The last usable snapshot remains visible."
      action={<Button variant="outline">Try again</Button>}
    />
  )
}
```

Use `scope="inline"` when nearby content remains useful, the default `section` scope when one bounded region is unavailable, and `scope="page"` only when the page's primary content has no usable state. Page scope does not remove shell navigation or working page actions. Choose `headingLevel` to preserve the page's existing hierarchy.

`SystemState` supplies adaptable fallback copy, but product UI should name the actual object and cause whenever known. Loading and no-results changes announce politely. Recoverable and terminal errors announce assertively. Initial-empty and permission-denied states are quiet because they are normally present when the region first renders; use `announce` only when one of those states appears as a new in-place update.

Skeletons are visual stand-ins and remain hidden from assistive technology. Use them for recognizable content geometry, use indeterminate `Progress` for measurable work whose completion is not yet known, and always retain visible loading copy. Preserve stale, usable content during a refresh when possible instead of replacing the whole page with a skeleton.

`Banner` is persistent surface context, while `Alert` is compact inline feedback and a toast is transient shell feedback. Banner tone does not imply announcement urgency. Plugins call `toast()` rather than mounting `ToastRegion`; the public `Toast` and `ToastRegion` presentation contract exists for the Bakin shell and deterministic previews. Toast actions use client-side SDK routing and must remain optional—required recovery belongs in the affected page region.

## Stylesheet Contract

`@makinbakin/sdk/styles.css` is the one supported compiled design-system stylesheet. The Bakin host loads it once for installed plugins, so plugin client entries must not import it or copy its contents into plugin-owned CSS.

Standalone Storybook instances, browser previews, and external test harnesses do not have the host stylesheet. Import the public artifact once at the preview or application root:

```ts
import '@makinbakin/sdk/styles.css'
```

This is the exact artifact used by Bakin and the public component catalog. It supplies the namespaced `--bakin-*` semantic tokens and supported component styling; it does not make the host's arbitrary Tailwind utility vocabulary public API.

## Navigation Stays Separate

UI composition does not redefine routing. Follow the existing presentation-based routing contract: paths identify pages, while query parameters represent overlays, tabs, filters, and other composable view state. Import `PluginLink`, `useRouter()`, and the query-state hooks from `@makinbakin/sdk/navigation`.

`FacetFilter`, `SegmentedControl`, and `UnderlineTabs` are controlled presentation patterns. Connect them to the shipped query-state hooks when their state should survive refreshes, participate in history, or be linkable:

```tsx
import { FacetFilter, SegmentedControl } from '@makinbakin/sdk/patterns'
import { useQueryArrayState, useQueryState } from '@makinbakin/sdk/navigation'

export function TaskControls() {
  const [statuses, setStatuses] = useQueryArrayState('status')
  const [view, setView] = useQueryState('view', 'board')

  return (
    <div>
      <FacetFilter
        label="Status"
        options={statusOptions}
        selected={statuses}
        onChange={setStatuses}
      />
      <SegmentedControl
        ariaLabel="Task view"
        options={viewOptions}
        value={view}
        onValueChange={setView}
      />
    </div>
  )
}
```

Keep the owning page path stable while these values change. The patterns intentionally do not read or write the URL themselves, so the same controls also work for local, non-linkable state. `AgentFilter` follows the same controlled contract; official Bakin surfaces may use the compatibility adapter that supplies registered agent metadata, while plugin UI supplies its own public option labels and visuals.

Agent identity and assignment also live in `@makinbakin/sdk/patterns`. `AgentAvatar`, `AgentStatus`, and `AgentSelect` accept presentation-ready identities, exact presence values, and controlled agent/team options. They do not read the agent registry, calculate heartbeat freshness, fetch teams, persist assignment, or own URL state. Existing official surfaces may keep using the migration adapter from `@makinbakin/sdk/components` until the fleet migration; new plugin UI supplies supported focused props:

```tsx
import {
  AgentAvatar,
  AgentSelect,
  AgentStatus,
  type AgentSelectOption,
} from '@makinbakin/sdk/patterns'

const agents: AgentSelectOption[] = [
  { id: 'maya', name: 'Maya Chen', color: '#8b5cf6' },
  { id: 'release', name: 'Release Operations', color: '#14b8a6' },
]

export function OwnerField({
  owner,
  onOwnerChange,
}: {
  owner: string
  onOwnerChange: (owner: string) => void
}) {
  return (
    <div>
      <AgentAvatar agent={agents[0]} showStatus status="working" />
      <AgentStatus name="Maya Chen" status="working" detail="Validating release 42" />
      <AgentSelect
        ariaLabel="Owner"
        agents={agents}
        teams={[{ id: 'release', label: 'Release team', color: '#f59e0b' }]}
        value={owner}
        onValueChange={onOwnerChange}
        allowNone
      />
    </div>
  )
}
```

Presence is always named in visible copy by `AgentStatus`; avatar badges add compact reinforcement and an accessible name. Use `decorative` on an avatar only when the same option, row, or control already names that agent. Team selections use the exported `team:` value helpers for compatibility, but consumers still translate that UI value into their own API contract before saving.

## Asset, Model, and Color Pickers

Import `AssetPicker`, `ModelSelect`, and `ColorPicker` from `@makinbakin/sdk/patterns`. They are controlled presentation patterns: the consumer supplies presentation-ready options and exact state, then owns requests, persistence, and domain mutations.

`AssetPicker` supports a managed-library dialog and an embedded `inline` composition. Dialog is the default for choosing from a library; inline list mode supports attach, relink, and quick-post flows without creating a second overlay. The picker supplies search presentation, grid or list choices, thumbnails, disabled items, and exact loading, recoverable error, initial-empty, and filtered no-results states. It does not fetch an asset endpoint, upload files, decide which assets are eligible, mutate attachments, or own route/query state:

```tsx
import {
  AssetPicker,
  type AssetPickerCollection,
} from '@makinbakin/sdk/patterns'

export function AttachmentPicker({
  collection,
  query,
  setQuery,
  attach,
  retry,
}: {
  collection: AssetPickerCollection
  query: string
  setQuery: (query: string) => void
  attach: (assetId: string) => void
  retry: () => void
}) {
  return (
    <AssetPicker
      variant="inline"
      view="list"
      title="Attach an existing asset"
      collection={collection}
      query={query}
      onQueryChange={setQuery}
      onPick={attach}
      onRetry={retry}
    />
  )
}
```

For dialog composition, pass controlled `open` and `onOpenChange`. The picker does not close after selection by itself; close it in `onPick` when that matches the owning workflow. Supply upload or other library actions through `toolbarAction`, but keep the file input, validation, request, progress, and result handling in the consumer. Filter unavailable or already-attached records before building the ready collection. Pass a presentation-safe `thumbnailSrc`; authorization and URL lifecycle remain outside the pattern.

`ModelSelect` groups controlled options by provider and can expose a default choice with the stable `DEFAULT_MODEL_VALUE` sentinel. Consumers fetch the catalog, decide availability, translate the sentinel into their API value, and save the result. Associate the trigger with a visible `<label>` through `id`, or supply `ariaLabel` when no visible label exists.

`ColorPicker` is a keyboard-complete radio group. Supply stable option `value` identifiers separately from their presentation `color`, and keep palette definition and persistence in the consumer. Use semantic CSS colors or validated color strings; do not encode meaning in a swatch alone. Each option needs a plain-language `label`, selected state remains available through radio semantics, and arrow, Home, and End keys move among enabled choices.

The migration-only `AssetPicker`, `ModelSelect`, and `ColorPicker` adapters in `@makinbakin/sdk/components` preserve existing official consumers while the fleet migration proceeds. New plugin UI should use the focused controlled contracts above. These patterns do not replace the established routing work: keep linkable library queries, overlay state, and selected records in the existing query-state contract when the product requires them.

Use `StatusBadge` for compact state language and `StatTile` for scan-friendly technical metrics. A status always needs a visible label such as “Published,” “Needs review,” or “Blocked”; never use a bare colored dot or icon as the only meaning. Status icons are decorative reinforcement. Focused status tones follow the shared semantic vocabulary: `neutral`, `success`, `attention`, `danger`, and `accent`.

`StatTile` uses the low-chrome Product Character treatment by default. Choose `variant="surface"` only when the metric is a genuinely bounded or actionable object, not to put a card around every number. When a tile has a meter, pass `progress.label` whenever the visible metric label is not a plain string. Consumers provide the exact value, denominator, and honest coverage copy; the component only clamps and presents the meter. An `onClick` tile becomes a native `type="button"` with the same visible focus contract as other actions.

## Markdown and Search Trust Patterns

Import `MarkdownContent` and `MarkdownEditor` from `@makinbakin/sdk/content`. The focused content entrypoint isolates its intentionally heavier parser from routine UI and application-pattern consumers. The renderer supports GFM tables and task lists, highlighted copyable code, bounded media previews, and visibly identified `bakin:*` managed sections. Raw HTML is not rendered. Wide tables and code own horizontal overflow inside the content boundary instead of widening the page.

Internal links must keep using the shipped routing contract. Supply `renderInternalLink` with `PluginLink`; do not rebuild history or route parsing inside a Markdown renderer:

```tsx
import { MarkdownContent } from '@makinbakin/sdk/content'
import { PluginLink } from '@makinbakin/sdk/navigation'

export function ReleaseNotes({ content }: { content: string }) {
  return (
    <MarkdownContent
      content={content}
      renderInternalLink={({ href, children }) => (
        <PluginLink to={href}>{children}</PluginLink>
      )}
    />
  )
}
```

`MarkdownEditor` is controlled: the host owns edit/preview mode, content, persistence, and save actions. Use `height="compact"`, `"document"`, `"viewport"`, or `"fill"` instead of arbitrary minimum heights. Its `format` may be `markdown`, `yaml`, `json`, or `text`; JSON preview formats valid input and preserves invalid in-progress input exactly. The earlier `editing` and `minHeight` props remain source-compatible while official consumers migrate; supplied `minHeight` values normalize to the named viewport treatment. New code uses the labeled `mode` and semantic `height` contract.

Search feedback lives on `@makinbakin/sdk/patterns` and must distinguish three materially different states:

| State | Pattern | Meaning |
| --- | --- | --- |
| The search engine returned no trustworthy query result | `SearchUnavailable` | Replace the owning results region, preserve surrounding browse/filter controls when useful, and provide `retry` or a host-owned `healthAction` only when that recovery exists |
| A lower-quality local matcher produced usable results | `SearchDegradedChip` | Keep results visible and name the fallback in plain language |
| Some sources exceeded their query budget | `SearchPartialChip` | Keep results visible and pass exact table metadata so keyboard and pointer users can inspect which sources degraded or were omitted |

`ScoreOverlay` is diagnostic evidence, not a status color. It labels the fused score, each reported search leg, and matched fields in text. Pass adapter-reported `matchedFields` when available; use `computeMatchedFields` only for the documented client-side approximation.

```tsx
import {
  SearchPartialChip,
  SearchUnavailable,
} from '@makinbakin/sdk/patterns'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { buttonVariants } from '@makinbakin/sdk/ui'

const unavailable = (
  <SearchUnavailable
    retry={retrySearch}
    healthAction={(
      <PluginLink to="/health" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        Open health
      </PluginLink>
    )}
  />
)

const partial = <SearchPartialChip meta={response.meta} />
```

`SearchUnavailable` preserves the established `/health` action by default. Pass another `healthAction` when the host has a more relevant recovery destination, or pass `null` when no health route is valid. Search and filter values remain in the existing query-state hooks. These patterns report result quality; they do not own the query, URL, request lifecycle, or navigation.

## Compact Data Visualization

Import chart helpers from the opt-in `@makinbakin/sdk/charts` entrypoint so pages that do not visualize data do not pay for the chart kit. Every visual summary needs an exact data path: use `ChartDataTable` as the visible disclosure for a chart, while `Sparkline` includes its compact exact table for assistive technology automatically.

```tsx
import {
  assignSeriesColors,
  ChartDataTable,
  ChartExplainer,
  Sparkline,
} from '@makinbakin/sdk/charts'

const agents = ['patch', 'pixel', 'rolo']
const colors = assignSeriesColors(agents)

export function CompletionTrend() {
  return (
    <section aria-labelledby="completion-trend-heading">
      <h2 id="completion-trend-heading">Completed tasks</h2>
      <p>42 completed · up 8 from the prior window</p>
      <Sparkline
        label="Completed tasks across the last four runs"
        labels={['Run 1', 'Run 2', 'Run 3', 'Run 4']}
        values={[7, null, 11, 14]}
      />
      <ChartDataTable
        caption="Completion trend data"
        data={[{ x: 'run-4', xLabel: 'Run 4', values: { patch: 8, pixel: 6 } }]}
        series={agents.map((key) => ({ key, label: key, color: colors.get(key) }))}
      />
      <ChartExplainer>A missing run means it was not reported; it is not zero.</ChartExplainer>
    </section>
  )
}
```

Pass the full entity set to `assignSeriesColors` before filtering or changing time windows. The fixed order keeps a surviving entity stable; a ninth and later entity belongs in a visibly labelled “Other” group instead of receiving another hue. Never reorder or cycle the palette locally.

Never use color alone to carry series, state, or trend meaning. Keep a visible legend or series label, pair a sparkline with visible current-value and direction copy, and make pointer detail available from keyboard focus. `null`, omitted, and non-finite values are missing data: label them honestly and leave a visual gap instead of drawing through them or coercing them to zero.

Use `LineChart` for change over time, including signed values; missing values break the line. Use `BarChart` for non-negative discrete comparisons, with `stacked` only when the total matters more than peer-to-peer comparison. Use `StackedColumnChart` for a dense composition whose named entities may be toggled. Pass its complete stable set through `series` (custom labels/colors) or `seriesKeys` (key-as-label shorthand), even when the current window omits an entity.

```tsx
import { BarChart, LineChart, StackedColumnChart } from '@makinbakin/sdk/charts'

const series = [
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]
const windows = [
  { x: 'one', xLabel: 'Window 1', values: { completed: 8, failed: 2 } },
  { x: 'two', xLabel: 'Window 2', values: { completed: 11 }, missingLabels: { failed: 'Not reported' } },
]

export function OperationalCharts() {
  return (
    <>
      <LineChart label="Outcome trend" data={windows} series={series} />
      <BarChart label="Outcome comparison" data={windows} series={series} />
      <StackedColumnChart label="Outcome composition" data={windows} series={series} />
    </>
  )
}
```

Each full chart owns a named, keyboard-scrollable plot boundary at narrow widths and a collapsed exact-data disclosure. Set `showDataTable={false}` on `BarChart` only when the same exact dataset is already rendered beside it; a chart without an equivalent table is not a supported composition. Axis labels may shorten visually to keep the plot readable, while the accessible mark labels and exact table retain the full text.

## Conversation Model and Folding

Import conversation models and pure helpers from the focused `@makinbakin/sdk/conversation` entrypoint. `foldConversation` is the one supported way to combine persisted `ConversationMessage` rows with an optional live stream into render-ready `ConversationTurn` objects. It preserves text and tool activity in arrival order, coalesces adjacent text with the same format, and settles tool results against their original call even when text arrived between the call and result.

```ts
import type { RuntimeChatChunk } from '@makinbakin/sdk/types'
import {
  foldConversation,
  formatRelativeTime,
  type ConversationMessage,
} from '@makinbakin/sdk/conversation'

const messages: ConversationMessage[] = [
  { kind: 'user', ts: '2026-07-20T12:00:00.000Z', content: 'Check production.' },
]
const liveChunks: RuntimeChatChunk[] = [
  { type: 'status', content: 'checking' },
  { type: 'text', content: 'All systems are healthy.' },
]

const turns = foldConversation(messages, { liveChunks })
const sent = formatRelativeTime(messages[0].ts)
```

`ConversationChunk` is structurally compatible with `RuntimeChatChunk`, so runtime output passes directly into the folder without conversion or a dependency on host internals. Missing tool previews, metadata, durations, status labels, and attachments stay missing data; consumers should not invent values. Error and aborted rows remain distinct terminal states, while an empty `liveChunks` array intentionally creates a streaming turn so the UI can show an honest waiting state.

Use `formatRelativeTime` for compact visible timestamps, `formatAbsoluteTime` for full supplemental context, and `formatDayLabel` with `dayKey` for local-calendar separators. These helpers return an empty string for an invalid timestamp.

## Conversation Tool Activity

Render consecutive tool calls with `ActivityGroup` from the same focused entrypoint. It starts collapsed by default so evidence stays subordinate to the conversation, while its summary retains running and failure meaning. Expanding it exposes each exact tool name, display-ready summary, duration when reported, and visible status. An empty call list renders an honest empty state rather than implying success.

```tsx
import { ActivityGroup, type ConversationToolCall } from '@makinbakin/sdk/conversation'

export function TurnActivity({ calls }: { calls: ConversationToolCall[] }) {
  return (
    <ActivityGroup
      calls={calls}
      onOpenCall={(call) => openToolDetail(call.callId)}
    />
  )
}
```

The consumer owns any exact-detail drawer and receives the original call object through `onOpenCall`; the activity component does not own URL or selection state. Supply presentation-ready summaries. `formatSummary` exists for compatibility adapters that must unwrap an established runtime envelope, not as a general domain-formatting hook. Status remains visible text when color or motion is unavailable, and the disclosure uses native button semantics. New consumers should not import the legacy `@makinbakin/sdk/components` barrel.

## Conversation Turns and Messages

Use `AgentTurn` and `UserMessage` for the two sides of a conversation. Pass a presentation-ready `ConversationAgent` to every agent turn: its name remains visible beside the avatar in complete, streaming, stopped, and failed states. `ThinkingIndicator` provides the same identity-first treatment when a surface needs a standalone live indicator.

```tsx
import {
  AgentTurn,
  UserMessage,
  type ConversationAgent,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'

export function Turn({ turn, agent }: {
  turn: ConversationTurn
  agent: ConversationAgent
}) {
  return turn.kind === 'user'
    ? <UserMessage turn={turn} />
    : <AgentTurn turn={turn} agent={agent} onRetry={retryLastMessage} />
}
```

The focused component does not look up agents or import a Markdown engine. Its default renderer preserves markdown text safely as wrapped text; supply `renderText` when the consumer already owns a supported rich-text renderer. `transformText` runs before that renderer for established domain extraction such as proposals. Use `renderAvatar` and `renderAttachment` only for presentation integrations; callbacks receive the original presentation models.

Image attachments render as lazy images and other MIME types render as named file links instead of broken image thumbnails. Relative timestamps remain visible with the exact local time available as supplemental context. Copy and retry are native buttons, and retry remains a consumer-owned mutation. Streaming, stopped, failure, and error-kind meaning stays textual when motion and color are unavailable.

## Conversation Timeline and Empty State

Use `Conversation` to render ordered `ConversationTurn` objects with consistent day boundaries, identity resolution, attachments, activity, and lifecycle treatment. Its default `mode="document"` is the product default and does not create an internal vertical scroller. In a routed conversation, put it inside the one named `ConversationPageTimeline`:

```tsx
import {
  Conversation,
  ConversationEmptyState,
  type ConversationAgent,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'
import {
  ConversationPageBody,
  ConversationPageTimeline,
} from '@makinbakin/sdk/patterns'

export function ReleaseConversation({
  turns,
  resolveAgent,
  startWith,
}: {
  turns: readonly ConversationTurn[]
  resolveAgent: (agentId?: string) => ConversationAgent | undefined
  startWith: (prompt: string) => void
}) {
  return (
    <ConversationPageBody mode="document">
      <ConversationPageTimeline label="Release review">
        <Conversation
          turns={turns}
          resolveAgent={resolveAgent}
          emptyState={(
            <ConversationEmptyState
              title="Start a release review"
              description="Ask about readiness or blocked work."
              suggestions={['Check blocked routes']}
              onSuggestion={startWith}
            />
          )}
        />
      </ConversationPageTimeline>
    </ConversationPageBody>
  )
}
```

Use `Conversation mode="contained"` only for a standalone embedded transcript whose parent supplies a real block-size boundary. That mode owns pin-to-latest behavior and shows a keyboard-operable “New messages” action after the operator scrolls away from the bottom. Do not nest it inside a contained `ConversationPageTimeline`; in that composition the page timeline is already the single scroller, so leave `Conversation` in document mode.

Pass presentation-ready identity through `agent` or `resolveAgent`. The focused timeline does not read the host agent store, parse URLs, own storage, fetch history, or import a Markdown engine. Supply the existing `renderText`, `renderAvatar`, `renderAttachment`, and `formatToolSummary` integrations when needed. Suggestions render only when `onSuggestion` is present, so an empty state never presents inert controls.

## Conversation Composer and Attachments

Put `Composer` inside `ConversationPageComposer`, outside the named message log. Give it a stable, opaque `storageKey` for the current thread; the component uses that key only for browser-local draft, input-history, and resize preferences. Do not put secrets in the key, and do not use it as routed or server-side conversation identity.

```tsx
import {
  Composer,
  type ComposerAttachmentItem,
} from '@makinbakin/sdk/conversation'
import { ConversationPageComposer } from '@makinbakin/sdk/patterns'

export function ReleaseComposer({
  threadId,
  busy,
  stagedImages,
  addImages,
  removeImage,
  send,
  abort,
}: {
  threadId: string
  busy: boolean
  stagedImages: readonly ComposerAttachmentItem[]
  addImages: (files: File[]) => void
  removeImage: (id: string) => void
  send: (content: string) => void
  abort: () => void
}) {
  return (
    <ConversationPageComposer>
      <Composer
        storageKey={`release:${threadId}`}
        inputLabel="Message the release agent"
        onSend={send}
        busy={busy}
        onAbort={abort}
        attachments={{
          enabled: true,
          acceptedTypes: ['image/*'],
          items: stagedImages,
          onAdd: addImages,
          onRemove: removeImage,
        }}
      />
    </ConversationPageComposer>
  )
}
```

The consumer owns file validation beyond the declared picker types, upload requests, object-URL cleanup, attachment persistence, and the eventual send mutation. Feed the resulting presentation state back as `uploading`, `ready`, or `error`; pending uploads hold send, and errors remain visible text. Set `enabled: false` with a concrete `disabledReason` when the selected agent or model cannot accept the declared files. The visible affordance and native picker are both disabled.

`busy` never disables typing. It holds send and shows a stop action only when `onAbort` exists; without that callback the composer renders non-interactive progress instead. Enter sends, Shift+Enter inserts a line, Escape aborts when available, IME composition is protected, and the resize separator supports pointer and keyboard input. Use `inputLabel` when the visible input hint alone does not provide a durable accessible name.

## Local Commands

```sh
bun run ui:dev
bun run ui:test:stories
bun run ui:test:visual
bun run ui:test:browsers
bun run docs:check
```

`docs:check` validates the curated docs, the existing route contracts, the public-story boundary, and the combined `/docs/ui/` artifact.

## Related

- [SDK overview](/docs/extending/sdk/overview/)
- [Plugin client UI](/docs/extending/plugins/client-ui/)
- [Quality control](/docs/extending/quality-control/)
- [SDK reference](/docs/reference/generated/sdk/)
