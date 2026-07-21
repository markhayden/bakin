'use client'

import {
  ConversationEmptyState as FocusedConversationEmptyState,
  type ConversationEmptyStateProps,
} from '@makinbakin/sdk/conversation'

/** @deprecated Import `ConversationEmptyState` from `@makinbakin/sdk/conversation`. */
export function ConversationEmptyState(props: ConversationEmptyStateProps) {
  return <FocusedConversationEmptyState {...props} />
}

export type { ConversationEmptyStateProps }
