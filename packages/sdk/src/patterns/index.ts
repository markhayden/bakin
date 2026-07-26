/**
 * `@makinbakin/sdk/patterns` — reusable application-aware UI patterns.
 *
 * Recipes own page hierarchy, responsive composition, and state slots while
 * consumers retain domain data, URL state, and routing behavior.
 */
export {
  ConversationPage,
  ConversationPageBody,
  ConversationPageComposer,
  ConversationPageTimeline,
  DashboardPage,
  DashboardPageContent,
  DetailPage,
  DetailPageAside,
  DetailPageBody,
  DetailPageMain,
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelFooter,
  InspectorPanelHeader,
  KanbanBoard,
  KanbanCardSignal,
  KanbanColumn,
  KanbanColumnBody,
  KanbanColumnHeader,
  ListPage,
  ListPageContent,
  ListPageControls,
  PageNavigator,
  PageHeader,
  SettingsPage,
  SettingsPageBody,
  SettingsPageContent,
  SettingsPageNavigation,
  WorkflowPage,
  WorkflowPageActions,
  WorkflowPageBody,
  WorkflowPageCanvas,
  WorkflowPageToolbar,
  ConfirmDialog,
  DangerZone,
  FacetFilter,
  AgentFilter,
  SaveBar,
  SearchInput,
  SegmentedControl,
  SortableHead,
  StatGroup,
  StatTile,
  StatusBadge,
  UnderlineTabs,
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
  ConversationPageBodyProps,
  ConversationPageComposerProps,
  ConversationPageMode,
  ConversationPageProps,
  ConversationPageTimelineProps,
  ConversationPageWidth,
  DashboardPageContentProps,
  DashboardPageProps,
  DashboardPageWidth,
  DetailPageAsideProps,
  DetailPageBodyProps,
  DetailPageLayout,
  DetailPageMainProps,
  DetailPageProps,
  DetailPageWidth,
  InspectorPanelContentProps,
  InspectorPanelFooterProps,
  InspectorPanelHeaderProps,
  InspectorPanelProps,
  KanbanBoardProps,
  KanbanCardSignalProps,
  KanbanColumnBodyProps,
  KanbanColumnHeaderProps,
  KanbanColumnProps,
  ListPageContentProps,
  ListPageControlsProps,
  ListPageProps,
  ListPageWidth,
  PageHeaderMeasure,
  PageHeaderProps,
  PageNavigatorProps,
  SettingsPageBodyProps,
  SettingsPageContentProps,
  SettingsPageLayout,
  SettingsPageNavigationProps,
  SettingsPageProps,
  SettingsPageWidth,
  WorkflowOrientation,
  WorkflowPageActionsProps,
  WorkflowPageBodyProps,
  WorkflowPageCanvasProps,
  WorkflowPageLayout,
  WorkflowPageMode,
  WorkflowPageProps,
  WorkflowPageToolbarProps,
  WorkflowPageWidth,
  ConfirmDialogCancelVariant,
  ConfirmDialogProps,
  ConfirmDialogTone,
  DangerZoneHeadingLevel,
  DangerZoneProps,
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
  StatusTone,
  UnderlineTab,
  UnderlineTabsProps,
  UnsavedChangesDialogProps,
} from '@bakin/ui/patterns'
