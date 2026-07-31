/**
 * `@makinbakin/sdk/patterns` — reusable application-aware UI patterns.
 *
 * Recipes own page hierarchy, responsive composition, and state slots while
 * consumers retain domain data, URL state, and routing behavior.
 */
export {
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelFooter,
  InspectorPanelHeader,
  KanbanBoard,
  KanbanCardSignal,
  KanbanColumn,
  KanbanColumnBody,
  KanbanColumnHeader,
  CalendarGrid,
  ListRow,
  ListRowGroup,
  ListRowLabels,
  ListRows,
  NavList,
  Page,
  PageAside,
  PageBody,
  PageCanvas,
  PageComposer,
  PageControls,
  PageTimeline,
  Pagination,
  PageHeader,
  PageHeaderOverflowMenu,
  WorkspacePage,
  WorkspacePageBody,
  WorkspacePageCompactHeader,
  WorkspacePageHeader,
  ConfirmDialog,
  DangerZone,
  DataTable,
  FacetFilter,
  AgentFilter,
  SaveBar,
  SearchInput,
  SegmentedControl,
  SortableHead,
  StatGroup,
  StatTile,
  StatusBadge,
  StatusMarker,
  Timeline,
  TimelineEntry,
  UnsavedChangesDialog,
} from '@bakin/ui/patterns'

/** Replace an affected result region when search returns no trustworthy result. */
export { SearchUnavailable } from './search-patterns'
/** Show fused and per-leg search relevance as exact, non-color-dependent evidence. */
export { ScoreOverlay } from './search-patterns'
/** Approximate matched fields when the adapter has no exact metadata. */
export { computeMatchedFields } from './search-patterns'
/** Disclose the exact sources that degraded or exceeded the search budget. */
export { SearchPartialChip } from './search-patterns'
/** Disclose that usable results came from a named lower-quality fallback. */
export { SearchDegradedChip } from './search-patterns'
export type {
  ScoreOverlayInfo,
  ScoreOverlayProps,
  SearchDegradedChipProps,
  SearchPartialChipProps,
  SearchPartialMeta,
  SearchUnavailableProps,
} from './search-patterns'

/** Present agent identity without importing a registry or host store. */
export { AgentAvatar, AgentDot, AgentStatus, AgentSelect } from './agent-patterns'
/** Stable assignment-value helpers shared by forms and workflow configuration. */
export {
  ASSIGNED_AGENT_VALUE,
  TEAM_VALUE_PREFIX,
  isTeamValue,
  teamIdFromValue,
} from './agent-patterns'
export type {
  AgentAvatarProps,
  AgentDotProps,
  AgentIdentity,
  AgentPresenceStatus,
  AgentSelectOption,
  AgentSelectProps,
  AgentStatusProps,
  AgentTeamOption,
} from './agent-patterns'

/** Controlled asset, model, and color choices without app data ownership. */
export { AssetPicker, ColorPicker, DEFAULT_MODEL_VALUE, ModelSelect } from './picker-patterns'
export type {
  AssetPickerAsset,
  AssetPickerCollection,
  AssetPickerProps,
  AssetPickerVariant,
  AssetPickerView,
  ColorPickerOption,
  ColorPickerProps,
  ModelSelectOption,
  ModelSelectProps,
} from './picker-patterns'

/** Freeform hex/color choice: a kit swatch over the platform color dialog. */
export { ColorInput } from '@bakin/ui'
export type { ColorInputProps } from '@bakin/ui'

/** The presentation AssetPicker composed with the assets plugin's library + upload wiring. */
export { AssetLibraryPicker } from './asset-library-picker'
export type { AssetLibraryAsset, AssetLibraryPickerProps } from './asset-library-picker'

/** Icon for a notification channel, resolved from the workflows channel registry. */
export { ChannelIcon, __resetChannelIconCache } from './channel-patterns'
export type { ChannelIconChannel, ChannelIconProps, ChannelIconSize } from './channel-patterns'

/** Schema-driven settings form with consumer-owned persistence and feedback. */
export { PluginSettingsRenderer } from './plugin-settings-renderer'
export type {
  PluginSettingsFeedback,
  PluginSettingsRendererProps,
} from './plugin-settings-renderer'
export type {
  BooleanSettingsField,
  ListSettingsField,
  NumberSettingsField,
  PluginSettingsSchema,
  SelectSettingsField,
  SettingsField,
  StringSettingsField,
} from '../types'

export type {
  InspectorPanelContentProps,
  InspectorPanelFooterProps,
  InspectorPanelHeaderProps,
  InspectorPanelProps,
  KanbanBoardProps,
  KanbanCardSignalProps,
  KanbanColumnBodyProps,
  KanbanColumnHeaderProps,
  KanbanColumnProps,
  CalendarGridItem,
  CalendarGridProps,
  CalendarGridView,
  ListRowGroupProps,
  ListRowLabelsProps,
  ListRowProps,
  ListRowsColumnsAlign,
  ListRowsColumnsAt,
  ListRowsProps,
  ListRowsVariant,
  NavListItem,
  NavListProps,
  NavListSection,
  PageAsideProps,
  PageBodyGap,
  PageBodyLayout,
  PageBodyProps,
  PageCanvasOrientation,
  PageCanvasProps,
  PageComposerProps,
  PageControlsAs,
  PageControlsProps,
  PageDensity,
  PageHeaderMeasure,
  PageHeaderOverflowMenuProps,
  PageHeaderProps,
  PageProps,
  PageScroll,
  PageTimelineProps,
  PageWidth,
  PaginationProps,
  WorkspacePageBodyProps,
  WorkspacePageCompactHeaderProps,
  WorkspacePageHeaderProps,
  WorkspacePageMode,
  WorkspacePageProps,
  ConfirmDialogCancelVariant,
  ConfirmDialogProps,
  ConfirmDialogTone,
  DangerZoneHeadingLevel,
  DangerZoneProps,
  DataTableAlign,
  DataTableCollapse,
  DataTableColumn,
  DataTableProps,
  DataTableSort,
  FacetFilterProps,
  FacetOption,
  AgentFilterOption,
  AgentFilterProps,
  SaveBarProps,
  SearchInputProps,
  SegmentedControlOption,
  SegmentedControlProps,
  SortableHeadProps,
  SortDir,
  StatGroupProps,
  StatTileProgress,
  StatTileProgressTone,
  StatTileProps,
  StatTileVariant,
  StatusBadgeProps,
  StatusBadgeVariant,
  StatusMarkerProps,
  StatusTone,
  TimelineEntryProps,
  TimelineProps,
  UnsavedChangesDialogProps,
} from '@bakin/ui/patterns'
