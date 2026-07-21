'use client'

import { summarizeStructured, unwrapToolResult } from '@bakin/core/format'
import {
  ActivityGroup as FocusedActivityGroup,
  ToolCallRow as FocusedToolCallRow,
  formatDuration,
  humanizeActivity,
  type ActivityGroupProps as FocusedActivityGroupProps,
  type ConversationToolCall,
  type ToolCallRowProps,
} from '@makinbakin/sdk/conversation'

function formatLegacySummary(summary: string): string {
  return summarizeStructured(unwrapToolResult(summary))
}

export type ActivityGroupProps = Omit<FocusedActivityGroupProps, 'formatSummary'>

/** @deprecated Import `ActivityGroup` from `@makinbakin/sdk/conversation`. */
export function ActivityGroup(props: ActivityGroupProps) {
  return <FocusedActivityGroup {...props} formatSummary={formatLegacySummary} />
}

/** @deprecated Import `ToolCallRow` from `@makinbakin/sdk/conversation`. */
export function ToolCallRow({ call, onOpen }: Omit<ToolCallRowProps, 'formatSummary'>) {
  return <FocusedToolCallRow call={call} onOpen={onOpen} formatSummary={formatLegacySummary} />
}

export { formatDuration, humanizeActivity }
export type { ConversationToolCall }
