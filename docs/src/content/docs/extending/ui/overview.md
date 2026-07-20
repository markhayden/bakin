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

Start with the focused visual SDK entrypoints: `@makinbakin/sdk/ui`, `@makinbakin/sdk/layout`, `@makinbakin/sdk/patterns`, `@makinbakin/sdk/charts`, and `@makinbakin/sdk/conversation`. Use semantic component props and documented composition patterns. The older `@makinbakin/sdk/components` barrel is migration-only and should not gain new consumers. Add plugin-owned, root-scoped CSS only for domain-specific presentation that the SDK does not cover.

Do not copy host components into a plugin. If the same need recurs across official or third-party plugins, propose it as an SDK contract with its public story, interaction test, accessibility coverage, and responsive states.

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
| Compose a long, product-level detail experience | `BakinDrawer` | Use the supported resizable right panel with optional back, actions, dirty-state, and width persistence |

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

The overlay portal is system-owned by default. In a standalone or contained host, pass the supported `portalProps={{ container }}` contract to `DialogContent` or `SheetContent`; do not relocate generated popup DOM or copy overlay z-index classes. URL-backed overlay state continues to follow the existing routing contract described below.

## Stylesheet Contract

`@makinbakin/sdk/styles.css` is the one supported compiled design-system stylesheet. The Bakin host loads it once for installed plugins, so plugin client entries must not import it or copy its contents into plugin-owned CSS.

Standalone Storybook instances, browser previews, and external test harnesses do not have the host stylesheet. Import the public artifact once at the preview or application root:

```ts
import '@makinbakin/sdk/styles.css'
```

This is the exact artifact used by Bakin and the public component catalog. It supplies the namespaced `--bakin-*` semantic tokens and supported component styling; it does not make the host's arbitrary Tailwind utility vocabulary public API.

## Navigation Stays Separate

UI composition does not redefine routing. Follow the existing presentation-based routing contract: paths identify pages, while query parameters represent overlays, tabs, filters, and other composable view state. Use `PluginLink` or `useRouter()` for client-side navigation and the SDK query-state hooks for URL-backed view state.

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
