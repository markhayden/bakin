import type * as Charts from '@makinbakin/sdk/charts'
import type * as Conversation from '@makinbakin/sdk/conversation'
import type * as Content from '@makinbakin/sdk/content'
import type * as Layout from '@makinbakin/sdk/layout'
import type * as Patterns from '@makinbakin/sdk/patterns'
import type * as Ui from '@makinbakin/sdk/ui'

export interface FocusedSdkConsumer {
  charts: typeof Charts
  conversation: typeof Conversation
  content: typeof Content
  layout: typeof Layout
  patterns: typeof Patterns
  ui: typeof Ui
}
