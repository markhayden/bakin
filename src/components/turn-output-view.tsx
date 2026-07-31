'use client'

/**
 * App-aware compatibility adapter for single-turn embeds. The focused
 * conversation pattern owns safe presentation; this adapter retains the
 * historical rich Markdown behavior without leaking the parser into the
 * focused conversation entrypoint.
 */
import {
  TurnOutputView as FocusedTurnOutputView,
  TurnToolChip,
  foldTurnChunks,
  type FoldedTurnOutput,
  type TurnOutputViewProps,
  type TurnTextSegment,
  type TurnToolChipState,
} from '@makinbakin/sdk/conversation'

import { MarkdownContent } from './markdown-content'

export { TurnToolChip, foldTurnChunks }
export type {
  FoldedTurnOutput,
  TurnOutputViewProps,
  TurnTextSegment,
  TurnToolChipState,
}

export function TurnOutputView({ renderText, ...props }: TurnOutputViewProps) {
  return (
    <FocusedTurnOutputView
      {...props}
      renderText={renderText ?? ((content, format) => format === 'markdown' ? (
        <MarkdownContent content={content} />
      ) : format === 'code' ? (
        <pre
          role="region"
          tabIndex={0}
          aria-label="Code output"
          className="max-w-full overflow-x-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-3 font-bakin-typography-family-mono text-bakin-typography-size-meta leading-relaxed text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
        >
          {content}
        </pre>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-bakin-typography-family-mono text-bakin-typography-size-meta leading-relaxed text-bakin-text-primary">
          {content}
        </pre>
      ))}
    />
  )
}
