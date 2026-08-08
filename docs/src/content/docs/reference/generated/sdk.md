---
title: SDK Reference
description: Public API surface of @makinbakin/sdk — hooks, components, types, and utilities for plugin authors.
---

The Bakin SDK is a single package with multiple subpaths. Plugin authors mark `@makinbakin/sdk` (and `react`/`react-dom`) as externals at build time; the host serves a single shared instance at runtime.

```ts
import { registerPlugin } from '@makinbakin/sdk'
import { useSearch } from '@makinbakin/sdk/hooks'
import { Button } from '@makinbakin/sdk/ui'
import type { BakinPlugin, PluginContext } from '@makinbakin/sdk/types'
```

## `@makinbakin/sdk`

The main entry. Re-exports the plugin contract types (`./types`) plus the high-traffic plugin lifecycle helpers (`registerPlugin`, `defineRoute`, `definePlugin`). Source: `packages/sdk/src/index.ts`.

| Export | Description |
| --- | --- |
| `registerPlugin` | Register a plugin (single-call entry from a plugin's `client.tsx`). |
| `registerPluginCleanup` | Register a cleanup callback fired when the plugin is unregistered. |
| `setNavBadge` | Set or clear a runtime badge on a plugin-owned nav item. |
| `getNavBadge` | Read the current badge for a nav item, or undefined if none. |
| `PluginRegistration` | — |
| `defineRoute` | Define a plugin HTTP route with typed input/output schemas. |
| `defineCoreRoute` | Define a core (non-plugin) HTTP route. |
| `definePlugin` | Compose a plugin's routes into a single definition for the server. |
| `HttpStatus` | — |
| `RouteContext` | — |
| `PluginContextLite` | — |
| `CoreContext` | — |
| `BodySpec` | — |
| `ResponseSpec` | — |
| `ParsedInput` | — |

## `@makinbakin/sdk/hooks`

Source: `packages/sdk/src/hooks/index.ts`.

```ts
import { useSearch, useDebug } from '@makinbakin/sdk/hooks'
```

### Data & State

| Hook | Description |
| --- | --- |
| `useContentStore` | Access the global Zustand store for SSE-driven content state. |
| `useScheduleJobs` | List scheduled jobs with live updates. |
| `useRunHistory` | Fetch run history for a scheduled job. |
| `ScheduleJob` | — |
| `RunEntry` | — |

### Search

| Hook | Description |
| --- | --- |
| `useSearch` | Hybrid full-text + semantic search across plugins with facet filtering. |
| `reorderBySearchResults` | Re-rank a local list to match the order returned by a search query. |
| `SearchResult` | — |
| `SearchResponse` | — |
| `UseSearchOptions` | — |
| `UseSearchReturn` | — |

### Navigation & URL

| Hook | Description |
| --- | --- |
| `useQueryState` | — |
| `useQueryArrayState` | — |
| `useSidebar` | Read sidebar open/closed state and toggle helper. |
| `useRouter` | — |
| `usePathname` | — |
| `useSearchParams` | — |
| `useParams` | — |

### Agent Data

| Hook | Description |
| --- | --- |
| `useAgentStore` | Access the agent registry store (Zustand). |
| `useAgent` | Look up a single agent by ID. |
| `useAgentList` | List all registered agents. |
| `useAgentColor` | Get an agent's brand color (hex string). |
| `useAgentDisplayName` | Get an agent's display name (fallback to ID). |
| `useAgentIds` | List all registered agent IDs. |
| `useMainAgentId` | Get the ID of the designated main/orchestrator agent. |
| `usePackageState` | Read agent-package install state (managed/unmanaged). |
| `hexToMuted` | Convert a hex color to a muted variant for backgrounds. |

### Notification Channels

| Hook | Description |
| --- | --- |
| `useNotificationChannels` | List configured notification channels (Discord, Slack, email, etc.). |
| `getChannelLabel` | Get a human-readable label for a channel ID. |
| `getChannelInitials` | Get initials for a channel (e.g. "Discord" → "D"). |

### UI Controls

| Hook | Description |
| --- | --- |
| `useDebug` | Read/toggle the global debug (X-Ray) flag. |
| `useFormGuard` | Guard a form against unmounting while submission is in flight. |
| `toast` | Fire a toast notification (success/error/info). |
| `useToastStore` | Subscribe to the toast store for custom toast UIs. |
| `useVerticalResize` | Imperatively resize a vertical pane via mouse drag handle. |

### Runtime

| Hook | Description |
| --- | --- |
| `useRuntimeStatus` | Subscribe to runtime connection status (online/offline, last heartbeat). |
| `useSSE` | Subscribe to a Server-Sent Events endpoint with auto-reconnect. |

### Other

| Hook | Description |
| --- | --- |
| `useNavBadge` | Sync a nav item's badge to a derived value; the recommended provider glue. |
| `useJsonFetch` | Cancellable JSON GET with a `{ data, loading, error, refresh }` lifecycle. |
| `usePluginJsonFetch` | Cancellable JSON GET with a `{ data, loading, error, refresh }` lifecycle. |
| `UseJsonFetchResult` | — |
| `useOccurrences` | — |
| `ScheduleOccurrence` | — |
| `ScheduledDomainEvent` | — |
| `useTaskRunHistory` | Fetch dispatch run history for a task. |
| `TaskOutcome` | — |
| `TaskRunEntry` | — |
| `usePluginEvent` | Subscribe to a server-pushed plugin event over the shell's single connection. |
| `emitPluginEvent` | Subscribe to a server-pushed plugin event over the shell's single connection. |
| `PluginEventPayload` | Subscribe to a server-pushed plugin event over the shell's single connection. |
| `useFileDrop` | Headless drag-drop file intake (drag-over state + handlers + accept filter) — style your own zone. |
| `UseFileDropOptions` | — |
| `UseFileDropResult` | — |
| `useHistoryBack` | — |
| `useHorizontalResize` | Resize a side-by-side split pane by dragging the divider between columns. |
| `useAvailableModels` | The available-models catalog (cached, read-only); empty until loaded. |
| `toNavigationOptions` | — |

## `@makinbakin/sdk/ui`

Source: `packages/sdk/src/ui/index.ts`. Supported Bakin primitives backed by the canonical design-system stylesheet. Use semantic props and the [UI style guide](/docs/extending/ui/) rather than relying on upstream-library APIs or arbitrary utility classes.

```ts
import { Alert, Badge, Button, Progress } from '@makinbakin/sdk/ui'
```

Available: `Alert`, `AlertAction`, `AlertDescription`, `AlertTitle`, `alertVariants`, `AlertProps`, `AlertTone`, `AlertVariantOptions`, `LegacyAlertVariant`, `Drawer`, `DrawerProps`, `DrawerSection`, `DrawerSectionHeadingLevel`, `DrawerSectionProps`, `Avatar`, `AvatarBadge`, `AvatarFallback`, `AvatarGroup`, `AvatarGroupCount`, `AvatarImage`, `AvatarProps`, `AvatarSize`, `LegacyAvatarSize`, `Badge`, `badgeVariants`, `BadgeProps`, `BadgeSize`, `BadgeTone`, `BadgeVariant`, `BadgeVariantOptions`, `LegacyBadgeVariant`, `Button`, `buttonVariants`, `ButtonProps`, `ButtonSize`, `ButtonVariant`, `ButtonVariantOptions`, `LegacyButtonSize`, `LegacyButtonVariant`, `Card`, `CardAction`, `CardContent`, `CardDescription`, `CardFooter`, `CardHeader`, `CardMedia`, `CardTitle`, `InteractiveAction`, `CardFooterVariant`, `CardInteractive`, `CardOrientation`, `CardProps`, `CardSize`, `CardTone`, `LegacyCardSize`, `Checkbox`, `CheckboxProps`, `Radio`, `RadioGroup`, `RadioGroupProps`, `RadioProps`, `FileInput`, `FileInputHandle`, `FileInputProps`, `Collapsible`, `CollapsibleContent`, `CollapsibleTrigger`, `CollapsibleContentProps`, `CollapsibleProps`, `CollapsibleTriggerProps`, `Command`, `CommandDialog`, `CommandEmpty`, `CommandGroup`, `CommandInput`, `CommandItem`, `CommandList`, `CommandSeparator`, `CommandShortcut`, `CommandDialogProps`, `CommandEmptyProps`, `CommandGroupProps`, `CommandInputProps`, `CommandItemProps`, `CommandListProps`, `CommandProps`, `CommandSeparatorProps`, `CommandShortcutProps`, `Dialog`, `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogOverlay`, `DialogPortal`, `DialogTitle`, `DialogTrigger`, `DialogCloseProps`, `DialogContentProps`, `DialogDescriptionProps`, `DialogFooterProps`, `DialogHeaderProps`, `DialogOverlayProps`, `DialogPortalProps`, `DialogProps`, `DialogTitleProps`, `DialogTriggerProps`, `DropdownMenu`, `DropdownMenuCheckboxItem`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuPortal`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubContent`, `DropdownMenuSubTrigger`, `DropdownMenuTrigger`, `DropdownMenuCheckboxItemProps`, `DropdownMenuContentProps`, `DropdownMenuGroupProps`, `DropdownMenuItemProps`, `DropdownMenuItemVariant`, `DropdownMenuLabelProps`, `DropdownMenuPortalProps`, `DropdownMenuProps`, `DropdownMenuRadioGroupProps`, `DropdownMenuRadioItemProps`, `DropdownMenuSeparatorProps`, `DropdownMenuShortcutProps`, `DropdownMenuSubContentProps`, `DropdownMenuSubProps`, `DropdownMenuSubTriggerProps`, `DropdownMenuTriggerProps`, `Field`, `FieldControl`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldLabel`, `Fieldset`, `FieldsetDescription`, `FieldsetLegend`, `Form`, `FormActions`, `SubmitButton`, `FieldControlProps`, `FieldDescriptionProps`, `FieldErrorProps`, `FieldGroupProps`, `FieldLabelProps`, `FieldOrientation`, `FieldProps`, `FieldRequirement`, `FieldsetDescriptionProps`, `FieldsetLegendProps`, `FieldsetProps`, `FormActionsAlign`, `FormActionsProps`, `FormProps`, `SubmitButtonProps`, `Banner`, `SystemState`, `Toast`, `ToastAction`, `ToastRegion`, `systemStateDefaults`, `BannerProps`, `BannerTone`, `FeedbackAnnouncement`, `SystemStateAlign`, `SystemStateContent`, `SystemStateHeadingLevel`, `SystemStateKind`, `SystemStateProps`, `SystemStateScope`, `ToastActionProps`, `ToastProps`, `ToastRegionProps`, `ToastTone`, `Input`, `InputProps`, `InputGroup`, `InputGroupAddon`, `InputGroupButton`, `InputGroupInput`, `InputGroupText`, `InputGroupTextarea`, `InputGroupAddonAlign`, `InputGroupAddonProps`, `InputGroupButtonProps`, `InputGroupButtonSize`, `InputGroupInputProps`, `InputGroupProps`, `InputGroupTextProps`, `InputGroupTextareaProps`, `Label`, `LabelProps`, `Popover`, `PopoverContent`, `PopoverDescription`, `PopoverHeader`, `PopoverPortal`, `PopoverTitle`, `PopoverTrigger`, `PopoverContentProps`, `PopoverDescriptionProps`, `PopoverHeaderProps`, `PopoverPortalProps`, `PopoverProps`, `PopoverTitleProps`, `PopoverTriggerProps`, `Progress`, `ProgressIndicator`, `ProgressLabel`, `ProgressTrack`, `ProgressValue`, `ProgressIndicatorProps`, `ProgressMarker`, `ProgressProps`, `ProgressSize`, `ProgressTone`, `ProgressTrackMarker`, `ProgressTrackProps`, `Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator`, `SelectTrigger`, `SelectValue`, `SelectContentProps`, `SelectGroupProps`, `SelectItemProps`, `SelectLabelProps`, `SelectProps`, `SelectScrollDownButtonProps`, `SelectScrollUpButtonProps`, `SelectSeparatorProps`, `SelectTriggerProps`, `SelectTriggerSize`, `SelectValueProps`, `Separator`, `SeparatorProps`, `Sheet`, `SheetClose`, `SheetContent`, `SheetDescription`, `SheetFooter`, `SheetHeader`, `SheetOverlay`, `SheetPortal`, `SheetTitle`, `SheetTrigger`, `SheetCloseProps`, `SheetContentProps`, `SheetDescriptionProps`, `SheetFooterProps`, `SheetHeaderProps`, `SheetOverlayProps`, `SheetPortalProps`, `SheetProps`, `SheetSide`, `SheetTitleProps`, `SheetTriggerProps`, `Skeleton`, `SkeletonProps`, `SkeletonShape`, `ShimmerText`, `ShimmerTextBase`, `ShimmerTextHighlight`, `ShimmerTextProps`, `Switch`, `SwitchProps`, `SwitchSize`, `Textarea`, `TextareaProps`, `Tooltip`, `TooltipContent`, `TooltipPortal`, `TooltipProvider`, `TooltipTrigger`, `TooltipContentProps`, `TooltipPortalProps`, `TooltipProps`, `TooltipProviderProps`, `TooltipTriggerProps`.

## `@makinbakin/sdk/layout`

Canonical page and responsive composition. Source: `packages/sdk/src/layout/index.ts`.

| Export | Description |
| --- | --- |
| `BoundedOverflow` | `@makinbakin/sdk/layout` — canonical page and responsive composition. |
| `DisclosurePanel` | `@makinbakin/sdk/layout` — canonical page and responsive composition. |
| `Grid` | `@makinbakin/sdk/layout` — canonical page and responsive composition. |
| `Inline` | `@makinbakin/sdk/layout` — canonical page and responsive composition. |
| `PageShell` | `@makinbakin/sdk/layout` — canonical page and responsive composition. |
| `Panel` | `@makinbakin/sdk/layout` — canonical page and responsive composition. |
| `Section` | `@makinbakin/sdk/layout` — canonical page and responsive composition. |
| `Stack` | `@makinbakin/sdk/layout` — canonical page and responsive composition. |
| `BoundedOverflowProps` | — |
| `DisclosurePanelProps` | — |
| `GridAlign` | — |
| `GridLayout` | — |
| `GridProps` | — |
| `InlineAlign` | — |
| `InlineJustify` | — |
| `InlineProps` | — |
| `LayoutElement` | — |
| `LayoutGap` | — |
| `PageShellGap` | — |
| `PageShellPadding` | — |
| `PageShellProps` | — |
| `PageShellWidth` | — |
| `PanelElement` | — |
| `PanelPadding` | — |
| `PanelProps` | — |
| `PanelTone` | — |
| `PanelVariant` | — |
| `SectionDivider` | — |
| `SectionElement` | — |
| `SectionProps` | — |
| `SectionSpacing` | — |
| `StackAlign` | — |
| `StackProps` | — |

## `@makinbakin/sdk/patterns`

Reusable application-aware presentation patterns. Source: `packages/sdk/src/patterns/index.ts`.

| Export | Description |
| --- | --- |
| `InspectorPanel` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `InspectorPanelContent` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `InspectorPanelFooter` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `InspectorPanelHeader` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `KanbanBoard` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `KanbanCardSignal` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `KanbanColumn` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `KanbanColumnBody` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `KanbanColumnHeader` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `CalendarGrid` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `ListRow` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `ListRowActions` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `ListRowGroup` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `ListRowLabels` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `ListRows` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `NavList` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `Page` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `PageAside` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `useCollapsedAside` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `PageBody` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `PageCanvas` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `PageComposer` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `PageControls` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `PageTimeline` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `Pagination` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `PageHeader` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `PageHeaderOverflowMenu` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `WorkspacePage` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `WorkspacePageBody` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `WorkspacePageCompactHeader` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `WorkspacePageHeader` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `ConfirmDialog` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `DangerZone` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `DataTable` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `FacetFilter` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `AgentFilter` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `SaveBar` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `SearchInput` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `SegmentedControl` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `SortableHead` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `StatGroup` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `StatTile` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `StatusBadge` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `StatusMarker` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `Timeline` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `TimelineEntry` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `UnsavedChangesDialog` | `@makinbakin/sdk/patterns` — reusable application-aware UI patterns. |
| `SearchUnavailable` | Replace an affected result region when search returns no trustworthy result. |
| `ScoreOverlay` | Show fused and per-leg search relevance as exact, non-color-dependent evidence. |
| `computeMatchedFields` | Approximate matched fields when the adapter has no exact metadata. |
| `SearchPartialChip` | Disclose the exact sources that degraded or exceeded the search budget. |
| `SearchDegradedChip` | Disclose that usable results came from a named lower-quality fallback. |
| `ScoreOverlayInfo` | — |
| `ScoreOverlayProps` | — |
| `SearchDegradedChipProps` | — |
| `SearchPartialChipProps` | — |
| `SearchPartialMeta` | — |
| `SearchUnavailableProps` | — |
| `AgentAvatar` | Present agent identity without importing a registry or host store. |
| `AgentDot` | Present agent identity without importing a registry or host store. |
| `AgentStatus` | Present agent identity without importing a registry or host store. |
| `AgentSelect` | Present agent identity without importing a registry or host store. |
| `ASSIGNED_AGENT_VALUE` | Stable assignment-value helpers shared by forms and workflow configuration. |
| `TEAM_VALUE_PREFIX` | Stable assignment-value helpers shared by forms and workflow configuration. |
| `isTeamValue` | Stable assignment-value helpers shared by forms and workflow configuration. |
| `teamIdFromValue` | Stable assignment-value helpers shared by forms and workflow configuration. |
| `AgentAvatarProps` | — |
| `AgentDotProps` | — |
| `AgentIdentity` | — |
| `AgentPresenceStatus` | — |
| `AgentSelectOption` | — |
| `AgentSelectProps` | — |
| `AgentStatusProps` | — |
| `AgentTeamOption` | — |
| `AssetPicker` | Controlled asset, model, and color choices without app data ownership. |
| `ColorPicker` | Controlled asset, model, and color choices without app data ownership. |
| `DEFAULT_MODEL_VALUE` | Controlled asset, model, and color choices without app data ownership. |
| `ModelSelect` | Controlled asset, model, and color choices without app data ownership. |
| `AssetPickerAsset` | — |
| `AssetPickerCollection` | — |
| `AssetPickerProps` | — |
| `AssetPickerVariant` | — |
| `AssetPickerView` | — |
| `ColorPickerOption` | — |
| `ColorPickerProps` | — |
| `ModelSelectOption` | — |
| `ModelSelectProps` | — |
| `ColorInput` | Freeform hex/color choice: a kit swatch over the platform color dialog. |
| `ColorInputProps` | — |
| `AssetLibraryPicker` | The presentation AssetPicker composed with the assets plugin's library + upload wiring. |
| `AssetLibraryAsset` | — |
| `AssetLibraryPickerProps` | — |
| `ChannelIcon` | Icon for a notification channel, resolved from the workflows channel registry. |
| `__resetChannelIconCache` | Icon for a notification channel, resolved from the workflows channel registry. |
| `ChannelIconChannel` | — |
| `ChannelIconProps` | — |
| `ChannelIconSize` | — |
| `PluginSettingsRenderer` | Schema-driven settings form with consumer-owned persistence and feedback. |
| `PluginSettingsFeedback` | — |
| `PluginSettingsRendererProps` | — |
| `BooleanSettingsField` | — |
| `ListSettingsField` | — |
| `NumberSettingsField` | — |
| `PluginSettingsSchema` | — |
| `SelectSettingsField` | — |
| `SettingsField` | — |
| `StringSettingsField` | — |
| `InspectorPanelContentProps` | — |
| `InspectorPanelFooterProps` | — |
| `InspectorPanelHeaderProps` | — |
| `InspectorPanelProps` | — |
| `KanbanBoardProps` | — |
| `KanbanCardSignalProps` | — |
| `KanbanColumnBodyProps` | — |
| `KanbanColumnHeaderProps` | — |
| `KanbanColumnProps` | — |
| `CalendarGridItem` | — |
| `CalendarGridProps` | — |
| `CalendarGridView` | — |
| `ListRowActionsProps` | — |
| `ListRowGroupProps` | — |
| `ListRowLabelsProps` | — |
| `ListRowProps` | — |
| `ListRowsColumnsAlign` | — |
| `ListRowsColumnsAt` | — |
| `ListRowsProps` | — |
| `ListRowsSize` | — |
| `ListRowsVariant` | — |
| `NavListItem` | — |
| `NavListProps` | — |
| `NavListSection` | — |
| `PageAsideCollapsible` | — |
| `PageAsideProps` | — |
| `PageAsideWidth` | — |
| `PageBodyGap` | — |
| `PageBodyLayout` | — |
| `PageBodyProps` | — |
| `PageCanvasOrientation` | — |
| `PageCanvasProps` | — |
| `PageComposerProps` | — |
| `PageControlsAs` | — |
| `PageControlsProps` | — |
| `PageDensity` | — |
| `PageHeaderMeasure` | — |
| `PageHeaderOverflowMenuProps` | — |
| `PageHeaderProps` | — |
| `PageProps` | — |
| `PageScroll` | — |
| `PageTimelineProps` | — |
| `PageWidth` | — |
| `PaginationProps` | — |
| `WorkspacePageBodyProps` | — |
| `WorkspacePageCompactHeaderProps` | — |
| `WorkspacePageHeaderProps` | — |
| `WorkspacePageMode` | — |
| `WorkspacePageProps` | — |
| `ConfirmDialogCancelVariant` | — |
| `ConfirmDialogProps` | — |
| `ConfirmDialogTone` | — |
| `DangerZoneHeadingLevel` | — |
| `DangerZoneProps` | — |
| `DataTableAlign` | — |
| `DataTableCollapse` | — |
| `DataTableColumn` | — |
| `DataTableNarrowRole` | — |
| `DataTableProps` | — |
| `DataTableSort` | — |
| `FacetFilterProps` | — |
| `FacetOption` | — |
| `AgentFilterOption` | — |
| `AgentFilterProps` | — |
| `SaveBarProps` | — |
| `SearchInputProps` | — |
| `SegmentedControlOption` | — |
| `SegmentedControlProps` | — |
| `SortableHeadProps` | — |
| `SortDir` | — |
| `StatGroupProps` | — |
| `StatTileProgress` | — |
| `StatTileProgressTone` | — |
| `StatTileProps` | — |
| `StatTileVariant` | — |
| `StatusBadgeProps` | — |
| `StatusBadgeVariant` | — |
| `StatusMarkerProps` | — |
| `StatusTone` | — |
| `TimelineEntryProps` | — |
| `TimelineProps` | — |
| `UnsavedChangesDialogProps` | — |

## `@makinbakin/sdk/charts`

Isolated data-visualization components and contracts. Source: `packages/sdk/src/charts/index.ts`.

| Export | Description |
| --- | --- |
| `assignSeriesColors` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `BarChart` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `PieChart` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `ChartDataTable` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `ChartExplainer` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `CompositionBar` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `chartSeriesColor` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `chartToneColor` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `CHART_MAX_SERIES` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `CHART_OTHER_COLOR` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `CHART_SERIES_COLORS` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `CHART_TOKEN_COLORS` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `CHART_TONE_COLORS` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `LineChart` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `AreaChart` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `RankedBarChart` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `Sparkline` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `StackedColumnChart` | `@makinbakin/sdk/charts` — opt-in, accessible data visualization. |
| `BarChartProps` | — |
| `PieChartDatum` | — |
| `PieChartProps` | — |
| `ChartDataTableProps` | — |
| `ChartDataTableRenderContext` | — |
| `ChartDatum` | — |
| `ChartExplainerProps` | — |
| `ChartSeries` | — |
| `ChartTone` | — |
| `CompositionBarProps` | — |
| `CompositionBarSegment` | — |
| `LineChartProps` | — |
| `AreaChartProps` | — |
| `RankedBarChartProps` | — |
| `SparklineProps` | — |
| `StackedColumnChartProps` | — |
| `StackedColumnDatum` | — |

## `@makinbakin/sdk/conversation`

Isolated conversation UI and models. Source: `packages/sdk/src/conversation/index.ts`.

| Export | Description |
| --- | --- |
| `foldConversation` | Fold persisted rows and live chunks into ordered render-ready turns. |
| `ConversationChunk` | — |
| `ConversationMessage` | — |
| `ConversationTextFormat` | — |
| `ConversationToolActivity` | — |
| `ConversationToolCall` | — |
| `ConversationTurn` | — |
| `DisplayAttachment` | — |
| `FoldOptions` | — |
| `TurnItem` | — |
| `TurnStatus` | — |
| `TurnOutputView` | Compact single-turn output for task and workflow embeds. |
| `TurnToolChip` | Compact single-turn output for task and workflow embeds. |
| `foldTurnChunks` | Compact single-turn output for task and workflow embeds. |
| `FoldedTurnOutput` | — |
| `TurnOutputViewProps` | — |
| `TurnTextSegment` | — |
| `TurnToolChipState` | — |
| `ConversationPanel` | Bounded, resizable single-session composition for embedded reviews. |
| `ToolCallDrawer` | Exact, resizable detail for one conversation tool call. |
| `ConversationHeader` | The one header treatment for chat-like surfaces (avatar/title/actions/meta). |
| `ContextMeter` | The compaction bar: runtime-truth context fullness for a session (#737). |
| `contextMeterHasContent` | The compaction bar: runtime-truth context fullness for a session (#737). |
| `ContextMeterStats` | — |
| `ConversationHeaderProps` | — |
| `ConversationPanelProps` | — |
| `ToolCallDrawerProps` | — |
| `useConversationThread` | Durable bus-driven thread state for server-owned conversational turns. |
| `ConversationQueuedItem` | — |
| `ConversationThread` | — |
| `ConversationThreadLoad` | — |
| `ConversationThreadOptions` | — |
| `attentionForDone` | Shared attention, badge, notification, and reply-state primitives. |
| `badgeFor` | Shared attention, badge, notification, and reply-state primitives. |
| `visibleIdFromLocation` | Shared attention, badge, notification, and reply-state primitives. |
| `withUnreadPrefix` | Shared attention, badge, notification, and reply-state primitives. |
| `AttentionActions` | — |
| `ConversationAttentionContext` | — |
| `ConversationDonePayload` | — |
| `playReplyChime` | — |
| `ConversationReplyToast` | — |
| `useConversationAttention` | — |
| `ConversationAttentionConfig` | — |
| `ConversationAttentionTotals` | — |
| `dayKey` | Stable compact, absolute, and calendar-day timestamp helpers. |
| `formatAbsoluteTime` | Stable compact, absolute, and calendar-day timestamp helpers. |
| `formatDayLabel` | Stable compact, absolute, and calendar-day timestamp helpers. |
| `formatRelativeTime` | Stable compact, absolute, and calendar-day timestamp helpers. |
| `ActivityGroup` | Collapsible exact tool-activity presentation and compact formatters. |
| `formatDuration` | Collapsible exact tool-activity presentation and compact formatters. |
| `humanizeActivity` | Collapsible exact tool-activity presentation and compact formatters. |
| `ToolCallRow` | Collapsible exact tool-activity presentation and compact formatters. |
| `ActivityGroupProps` | — |
| `ToolCallRowProps` | — |
| `AgentTurn` | Agent and user turn presentation with consumer-owned identity and rich text. |
| `CopyButton` | Agent and user turn presentation with consumer-owned identity and rich text. |
| `ThinkingIndicator` | Agent and user turn presentation with consumer-owned identity and rich text. |
| `TurnTimestamp` | Agent and user turn presentation with consumer-owned identity and rich text. |
| `UserMessage` | Agent and user turn presentation with consumer-owned identity and rich text. |
| `AgentTurnProps` | — |
| `ConversationAgent` | — |
| `ConversationAttachmentRenderer` | — |
| `ConversationAvatarRenderer` | — |
| `ConversationTextRenderer` | — |
| `ConversationTextTransform` | — |
| `CopyButtonProps` | — |
| `ThinkingIndicatorProps` | — |
| `TurnTimestampProps` | — |
| `UserMessageProps` | — |
| `formatTokenCount` | — |
| `formatUsageCost` | — |
| `ConversationTurnUsage` | — |
| `Conversation` | Document-first conversation timeline and honest zero-message state. |
| `ConversationEmptyState` | Document-first conversation timeline and honest zero-message state. |
| `ConversationEmptyStateProps` | — |
| `ConversationMode` | — |
| `ConversationProps` | — |
| `Composer` | Persistent, IME-safe composer with consumer-owned attachment mutations. |
| `writeComposerDraft` | Persistent, IME-safe composer with consumer-owned attachment mutations. |
| `ComposerAttachmentItem` | — |
| `ComposerAttachments` | — |
| `ComposerAttachmentStatus` | — |
| `ComposerHandle` | — |
| `ComposerProps` | — |
| `QueuedMessageList` | Accepted follow-ups waiting behind an active turn. |
| `QueuedMessageListProps` | — |

## `@makinbakin/sdk/content`

Opt-in rich content rendering and editing. Source: `packages/sdk/src/content/index.ts`.

| Export | Description |
| --- | --- |
| `MarkdownContent` | Render safe GFM, code, media, and visibly identified Bakin-managed sections. |
| `MarkdownContentProps` | — |
| `MarkdownInternalLinkProps` | — |
| `MarkdownEditor` | Controlled edit or preview surface with semantic format and height options. |
| `MarkdownEditorFormat` | — |
| `MarkdownEditorHeight` | — |
| `MarkdownEditorMode` | — |
| `MarkdownEditorProps` | — |

## `@makinbakin/sdk/slots`

Source: `packages/sdk/src/slots/index.tsx`.

| Slot system | Description |
| --- | --- |
| `registerSlot` | Register a component for a named slot. Lower `order` renders first; default `order` is 100. |
| `getSlotEntries` | Read the registered entries for a slot. Exported for tooling / tests. |
| `getSlotNamesOwnedBy` | Slot names with at least one entry owned by the given plugin (manifest drift checks). |
| `clearSlotsOwnedBy` | Remove every slot entry owned by the given plugin (hot-swap teardown). |
| `Slot` | Render all components registered for the named slot, in order. Extra props |

## `@makinbakin/sdk/types`

Source: `packages/sdk/src/types/index.ts`. The full plugin contract surface. Below: detailed field-level docs for the types most plugin authors directly implement, then summary tables grouped by domain.

```ts
import type { BakinPlugin, PluginContext, ExecToolDefinition } from '@makinbakin/sdk/types'
```

### Core types (full field docs)

### Health

| Type | Description |
| --- | --- |
| `JsonValue` | Canonical Health contracts shared by plugin authors, adapters, core, HTTP |
| `JsonObject` | — |
| `HealthNonEmptyArray` | A tuple used wherever an empty list would make the contract ambiguous. |
| `HealthObservationStatus` | — |
| `HealthDisposition` | — |
| `HealthReportStatus` | — |
| `HEALTH_INCIDENT_CLASSES` | Producer-stamped behavior class (#690) — what KIND of problem an incident |
| `HealthIncidentClass` | — |
| `HealthSensitivity` | Health sensitivity mode (#690): how loudly findings surface. `developer` |
| `HealthOwnerKind` | — |
| `HealthOwner` | Core-stamped owner of a registration or canonical finding. |
| `HealthGroup` | Stable subsystem grouping supplied by a registration. |
| `HealthResourceKind` | — |
| `HealthResource` | Stable reference to a resource affected by an incident. |
| `HealthRepairResolution` | — |
| `HealthNavigateResolution` | — |
| `HealthInstructionsResolution` | — |
| `HealthRerunResolution` | — |
| `HealthResolution` | — |
| `HealthIncidentBaseInput` | — |
| `AdvisoryIncidentInput` | — |
| `WatchIncidentInput` | — |
| `ActionIncidentInput` | — |
| `HealthIncidentInput` | — |
| `HealthObservationBaseInput` | — |
| `HealthyObservationInput` | — |
| `WarningObservationInput` | — |
| `ErrorObservationInput` | — |
| `UnknownObservationInput` | — |
| `HealthObservationInput` | Status-discriminated producer observation; illegal combinations do not typecheck. |
| `ObservedHealthCheckRunInput` | — |
| `NotApplicableHealthCheckRunInput` | — |
| `HealthCheckRunInput` | — |
| `HealthCheckRunContext` | Cancellation context supplied by core when it executes a health check. |
| `HealthCheckRegistrationInput` | Plugin- or adapter-authored check definition; core supplies owner metadata. |
| `HealthRepairSafety` | — |
| `HealthRepairChange` | — |
| `HealthRepairTarget` | — |
| `HealthRepairPrecondition` | — |
| `HealthRepairPlanItem` | — |
| `HealthRepairPlan` | — |
| `HealthRepairApplyRequest` | — |
| `HealthRepairApplyResult` | — |
| `HealthRepairActionDefinition` | Owner-local repair action registered separately from diagnostic checks. |
| `CanonicalHealthyObservation` | — |
| `CanonicalWarningObservation` | — |
| `CanonicalErrorObservation` | — |
| `CanonicalUnknownObservation` | — |
| `HealthObservation` | Validated, core-stamped observation retained in immutable check snapshots. |
| `HealthCheckExecutionError` | — |
| `HealthCheckExecution` | — |
| `HealthIncident` | — |
| `HealthCheckSnapshot` | — |
| `HealthCheckState` | Cached state for one currently registered check. |
| `SearchReadinessStatus` | — |
| `SearchStageStatus` | — |
| `SearchReadinessStageKey` | — |
| `SearchReadinessStage` | — |
| `SearchReadiness` | — |
| `HealthReportCheckSummary` | — |
| `HealthReportIncidentSummary` | — |
| `HealthReportSummary` | — |
| `HealthFullSweep` | — |
| `HealthReportSubsystems` | — |
| `HealthReport` | — |

## `@makinbakin/sdk/utils`

Source: `packages/sdk/src/utils/index.ts`.

| Utility | Description |
| --- | --- |
| `healthError` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthHealthy` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthNotApplicable` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthObserved` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthResourceId` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthUnknown` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthWarning` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `cn` | Tailwind class merger (clsx + tailwind-merge). |
| `copyToClipboard` | — |
| `BadgeTone` | Semantic tone for an outline status badge. |
| `toneBadgeClass` | Classes for an outline status badge of the given tone — the |
| `isValidAssetId` | Pure assetId shape validators (see ./asset-id). |
| `yearMonthFromAssetId` | Pure assetId shape validators (see ./asset-id). |
| `formatAge` | Format a Date or ISO string as a relative age (e.g. "5m ago"). |
| `formatDateTime` | Format an ISO timestamp as a calendar-aware absolute date+time (e.g. "Today 3:45 PM", "Jan 5 9:02 AM"). |
| `formatDuration` | Format a millisecond count as an elapsed duration (e.g. "42s", "3m 5s"); null when undefined. |
| `formatSize` | Format a byte count as a human-readable size string (e.g. "1.2 MB"). |
| `isStale` | Returns true if a timestamp is older than a configurable staleness threshold. |
| `conversationThreadId` | Canonical thread id for embedded conversation surfaces (scope:entity:agent). |
| `createTurnRecorder` | Record one streamed turn's chunks into persistable ConversationMessage rows. |
| `SUMMARY_MAX_CHARS` | Record one streamed turn's chunks into persistable ConversationMessage rows. |
| `PREVIEW_MAX_CHARS` | Record one streamed turn's chunks into persistable ConversationMessage rows. |
| `TurnRecorder` | — |
| `humanizeKey` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `formatStructured` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `summarizeStructured` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `unwrapToolResult` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `FormatStructuredOptions` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `pluginFetch` | Fetch a plugin's own API route (`/api/plugins/&lt;id>/&lt;path>`) with JSON defaults. |
| `pluginApiUrl` | Fetch a plugin's own API route (`/api/plugins/&lt;id>/&lt;path>`) with JSON defaults. |

## `@makinbakin/sdk/metadata`

Source: `packages/sdk/src/metadata/index.ts`.

| Contract helper | Description |
| --- | --- |
| `ContractMetadata` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `ContractStability` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `ContractVisibility` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `CliCommandContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `DocsAwareAPIRoute` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `DocsExample` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `ExecToolContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `HookContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `HookKind` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `PublicContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `RouteContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `SchemaLike` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `SlotContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `SourceLocation` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `defineApiRoute` | Legacy: declare an API route with docs metadata. Prefer `defineRoute` from `/routing`. |
| `defineCliCommandContract` | Define a CLI command contract for documentation. |
| `defineExecToolContract` | Define an MCP exec tool contract for documentation. |
| `defineHookContract` | Define a cross-plugin hook contract for documentation. |
| `definePluginRoute` | Legacy: declare a plugin route with docs metadata. Prefer `defineRoute` from `/routing`. |
| `defineRouteContract` | Define a generic route contract (shared shape for API + plugin routes). |
| `defineSlotContract` | Define a UI slot contract for documentation. |

## `@makinbakin/sdk/routing`

Source: `packages/sdk/src/routing/index.ts`.

| Routing | Description |
| --- | --- |
| `defineRoute` | Define a plugin HTTP route with typed input/output and handler. |
| `defineCoreRoute` | Define a core (non-plugin) HTTP route. |
| `definePlugin` | Compose a plugin's routes into a single definition for the server. |
| `HttpMethod` | — |
| `HttpStatus` | — |
| `RouteContext` | — |
| `PluginContextLite` | — |
| `CoreContext` | — |
| `JsonBodySpec` | — |
| `MultipartBodySpec` | — |
| `RawBodySpec` | — |
| `NoBodySpec` | — |
| `BodySpec` | — |
| `JsonResponseSpec` | — |
| `NoContentResponseSpec` | — |
| `NonJsonResponseSpec` | — |
| `ResponseSpec` | — |
| `ParsedInput` | — |
| `APIRoute` | — |
| `PluginWithRoutes` | — |
| `DefinePluginInput` | — |

## `@makinbakin/sdk/navigation`

Source: `packages/sdk/src/navigation/index.ts`.

| Browser navigation | Description |
| --- | --- |
| `PluginLink` | Real-anchor SPA navigation for runtime-registered plugin routes. |
| `PluginLinkProps` | Props for a runtime-route link with native anchor semantics. |
| `toNavigationOptions` | Browser router hooks and plain-string URL conversion. |
| `useParams` | Browser router hooks and plain-string URL conversion. |
| `usePathname` | Browser router hooks and plain-string URL conversion. |
| `useRouter` | Browser router hooks and plain-string URL conversion. |
| `useSearchParams` | Browser router hooks and plain-string URL conversion. |
| `Router` | Public browser-router contracts for string-based plugin paths. |
| `RouterNavigationOptions` | Public browser-router contracts for string-based plugin paths. |
| `StringNavigationOptions` | Public browser-router contracts for string-based plugin paths. |
| `useQueryArrayState` | URL-backed string state with clean defaults and same-tick batching. |
| `useQueryState` | URL-backed string state with clean defaults and same-tick batching. |
| `useHistoryBack` | History-aware back navigation with a cold-deep-link fallback. |
| `useUnsavedChangesGuard` | Complete browser-unload, in-app route, anchor, and explicit-exit protection. |
| `UnsavedChangesGuardOptions` | Inputs and result contract for complete unsaved-change protection. |
| `UnsavedChangesGuardResult` | Inputs and result contract for complete unsaved-change protection. |

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated Aug 6, 2026 · Bakin 0.0.0-dev</span>
</aside>
