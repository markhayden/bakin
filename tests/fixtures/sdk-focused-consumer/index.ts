import type * as Charts from '@makinbakin/sdk/charts'
import type * as Conversation from '@makinbakin/sdk/conversation'
import type * as Content from '@makinbakin/sdk/content'
import type * as Layout from '@makinbakin/sdk/layout'
import type * as Navigation from '@makinbakin/sdk/navigation'
import type * as Patterns from '@makinbakin/sdk/patterns'
import type * as TestingUi from '@makinbakin/sdk/testing/ui'
import type * as TestingUiConformance from '@makinbakin/sdk/testing/ui/conformance'
import type * as Ui from '@makinbakin/sdk/ui'
import { BarChart } from '@makinbakin/sdk/charts'
import { TurnOutputView } from '@makinbakin/sdk/conversation'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { PageShell } from '@makinbakin/sdk/layout'
import { PluginLink, useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'
import { PluginSettingsRenderer } from '@makinbakin/sdk/patterns'
import { PluginUiFixtureHost, createPluginUiFixtureFetch } from '@makinbakin/sdk/testing/ui'
import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'
import { Button } from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { Slot, registerSlot } from '@makinbakin/sdk/slots'
import { defineHookContract } from '@makinbakin/sdk/metadata'

// Each rejected import guards the emitted declarations. Restoring an export
// makes its @ts-expect-error unused, failing the external-consumer typecheck.
// @ts-expect-error URL construction is private to pluginFetch.
export { pluginApiUrl } from '@makinbakin/sdk/utils'
// @ts-expect-error Clipboard behavior is private to the UI implementation.
export { copyToClipboard } from '@makinbakin/sdk/utils'
// @ts-expect-error Slot inspection is internal.
export { getSlotEntries } from '@makinbakin/sdk/slots'
// @ts-expect-error Plugin teardown owns slot cleanup.
export { clearSlotsOwnedBy } from '@makinbakin/sdk/slots'

export interface FocusedSdkConsumer {
  charts: typeof Charts
  conversation: typeof Conversation
  content: typeof Content
  layout: typeof Layout
  navigation: typeof Navigation
  patterns: typeof Patterns
  testingUi: typeof TestingUi
  testingUiConformance: typeof TestingUiConformance
  ui: typeof Ui
}

/** Representative runtime names ensure declarations and JS agree per domain. */
export const focusedSdkValues = {
  BarChart,
  Button,
  MarkdownContent,
  PageShell,
  PluginLink,
  PluginSettingsRenderer,
  PluginUiFixtureHost,
  TurnOutputView,
  createPluginUiFixtureFetch,
  definePluginUiConformance,
  useUnsavedChangesGuard,
  pluginFetch,
  Slot,
  registerSlot,
  defineHookContract,
}

/** Representative props prove consumers need no private implementation types. */
export interface FocusedSdkProps {
  chart: Charts.BarChartProps
  turnOutput: Conversation.TurnOutputViewProps
  markdown: Content.MarkdownContentProps
  page: Layout.PageShellProps
  link: Navigation.PluginLinkProps
  settings: Patterns.PluginSettingsRendererProps
  fixture: TestingUi.PluginUiFixtureHostProps
  fixtureConfig: TestingUiConformance.PluginUiConformanceConfig
  button: Ui.ButtonProps
}
