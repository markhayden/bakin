import type * as Charts from '@makinbakin/sdk/charts'
import type * as Conversation from '@makinbakin/sdk/conversation'
import type * as Content from '@makinbakin/sdk/content'
import type * as Layout from '@makinbakin/sdk/layout'
import type * as Patterns from '@makinbakin/sdk/patterns'
import type * as Ui from '@makinbakin/sdk/ui'
import { BarChart } from '@makinbakin/sdk/charts'
import { TurnOutputView } from '@makinbakin/sdk/conversation'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { PageShell } from '@makinbakin/sdk/layout'
import { PluginSettingsRenderer } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

export interface FocusedSdkConsumer {
  charts: typeof Charts
  conversation: typeof Conversation
  content: typeof Content
  layout: typeof Layout
  patterns: typeof Patterns
  ui: typeof Ui
}

/** Representative runtime names ensure declarations and JS agree per domain. */
export const focusedSdkValues = {
  BarChart,
  Button,
  MarkdownContent,
  PageShell,
  PluginSettingsRenderer,
  TurnOutputView,
}

/** Representative props prove consumers need no private implementation types. */
export interface FocusedSdkProps {
  chart: Charts.BarChartProps
  turnOutput: Conversation.TurnOutputViewProps
  markdown: Content.MarkdownContentProps
  page: Layout.PageShellProps
  settings: Patterns.PluginSettingsRendererProps
  button: Ui.ButtonProps
}
