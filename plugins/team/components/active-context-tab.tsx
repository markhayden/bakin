'use client'

import { MessageCircle } from 'lucide-react'
import { CodeBlock, MarkdownContent } from '@makinbakin/sdk/content'
import { Panel, Section } from '@makinbakin/sdk/layout'
import { Pagination, StatusBadge } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'
import { useJsonFetch, useQueryState } from '@makinbakin/sdk/hooks'
import type { SessionMessage, SessionTranscript } from '../types'

export interface ActiveContextTabProps {
  agentId: string
}

const ROLE_TONES: Record<
  SessionMessage['role'],
  'neutral' | 'accent' | 'success' | 'attention'
> = {
  system: 'neutral',
  user: 'accent',
  assistant: 'success',
  tool: 'attention',
}

function isJsonLike(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function textBlockContent(content: string): string | null {
  if (!isJsonLike(content)) return content
  try {
    const parsed = JSON.parse(content) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    if (!parsed.every((block) => (
      typeof block === 'object'
      && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
    ))) return null
    return parsed
      .map((block) => (block as { text: string }).text)
      .filter(Boolean)
      .join('\n\n')
  } catch {
    return null
  }
}

function MessageRow({ message, index }: { message: SessionMessage; index: number }) {
  const readableText = message.role === 'tool' ? null : textBlockContent(message.content)
  const hasStructuredMessage = message.role !== 'tool'
    && readableText !== null
    && isJsonLike(message.content)
  return (
    <Panel as="article" aria-label={`Turn ${index + 1}: ${message.role}`}>
      <header className="mb-bakin-3 flex min-w-0 flex-wrap items-center gap-bakin-2">
        <Text mono size="meta" tone="muted">
          #{index + 1}
        </Text>
        <StatusBadge tone={ROLE_TONES[message.role]} variant="solid" size="xs">
          {message.role}
        </StatusBadge>
        {message.toolName ? (
          <code className="font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-primary">
            {message.toolName}
          </code>
        ) : null}
        {message.model ? (
          <Text size="meta" tone="muted">{message.model}</Text>
        ) : null}
        {message.ts ? (
          <time
            dateTime={message.ts}
            className="ml-auto font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted"
          >
            {new Date(message.ts).toLocaleTimeString()}
          </time>
        ) : null}
      </header>

      {readableText === null ? (
        <CodeBlock code={message.content} language="json" label="Message payload" wrap copyable />
      ) : (
        <div className="grid min-w-0 gap-bakin-3">
          <MarkdownContent content={readableText} />
          {hasStructuredMessage ? (
            <details className="min-w-0 border-t border-bakin-border-subtle pt-bakin-3">
              <summary className="cursor-pointer text-bakin-typography-size-meta font-bakin-typography-weight-semibold text-bakin-text-muted">
                Structured message
              </summary>
              <CodeBlock
                className="mt-bakin-2"
                code={message.content}
                language="json"
                label="Structured message"
                wrap
                copyable
              />
            </details>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

export function ActiveContextTab({ agentId }: ActiveContextTabProps) {
  const [pageParam, setPageParam] = useQueryState('contextPage', '1')
  const { data, loading, error: fetchError } = useJsonFetch<{
    ok: boolean
    transcript: SessionTranscript | null
    error?: string
  }>(`/api/plugins/team/${agentId}/active-context`)
  const transcript = data?.ok ? data.transcript : null
  const error = fetchError ?? (data && !data.ok
    ? (data.error ?? 'Failed to load active context')
    : null)
  const pageSize = 8
  const messages = transcript?.messages ?? []
  const showAll = pageParam === 'all'
  const requestedPage = Number.parseInt(pageParam, 10)
  const pageCount = Math.max(1, Math.ceil(messages.length / pageSize))
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), pageCount)
    : 1
  const startIndex = showAll ? 0 : (page - 1) * pageSize
  const visibleMessages = showAll
    ? messages
    : messages.slice(startIndex, startIndex + pageSize)

  if (loading) {
    return (
      <SystemState
        kind="loading"
        scope="page"
        title="Loading session context"
        description="The latest model and tool turns will appear when ready."
      />
    )
  }

  if (error) {
    return (
      <SystemState
        kind="error"
        recovery="unavailable"
        scope="page"
        title="Active context unavailable"
        description={error}
      />
    )
  }

  if (!transcript || transcript.messages.length === 0) {
    return (
      <SystemState
        kind="initial-empty"
        scope="page"
        title="No session context yet"
        description="Run a task with this agent to populate the system prompt, conversation turns, and tool calls."
        action={(
          <span className="inline-flex items-center gap-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">
            <MessageCircle aria-hidden="true" className="size-bakin-4" />
            Waiting for the first dispatch
          </span>
        )}
      />
    )
  }

  return (
    <Section spacing="compact">
      {transcript.truncated ? (
        <Alert tone="attention">
          <AlertTitle>
            Showing latest {transcript.messages.length} of {transcript.totalMessages} messages
          </AlertTitle>
          <AlertDescription>Older messages were omitted to keep this transcript responsive.</AlertDescription>
        </Alert>
      ) : null}

      <header className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
        <div className="min-w-0">
          <h2>Current session</h2>
          <div className="mt-bakin-1 flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
            <code className="font-bakin-typography-family-mono text-bakin-text-primary">
              {transcript.sessionId || 'Unknown session'}
            </code>
            {transcript.sessionStarted ? (
              <time dateTime={transcript.sessionStarted}>
                Started {new Date(transcript.sessionStarted).toLocaleString()}
              </time>
            ) : null}
          </div>
        </div>
        <StatusBadge tone="neutral" variant="solid" size="xs">
          {transcript.messages.length} {transcript.messages.length === 1 ? 'turn' : 'turns'}
        </StatusBadge>
      </header>

      <ol aria-label="Session turns" className="m-0 grid min-w-0 gap-bakin-3 p-0">
        {visibleMessages.map((message, index) => (
          <li key={`${message.ts ?? index}-${index}`} className="min-w-0">
            <MessageRow message={message} index={startIndex + index} />
          </li>
        ))}
      </ol>
      <Pagination
        page={page}
        pageSize={pageSize}
        showAll={showAll}
        total={messages.length}
        onPageChange={(nextPage) => setPageParam(String(nextPage))}
        onShowAllChange={(nextShowAll) => setPageParam(nextShowAll ? 'all' : '1')}
      />
    </Section>
  )
}
