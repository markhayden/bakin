/**
 * Embedded brainstorm for the brand doc editor (conversation kit): ask an
 * agent for feedback or drafted copy while editing. Session-only — the
 * transcript lives in component state; turns stream over the per-request SSE
 * route (POST .../brainstorm) with the editor's CURRENT content as context.
 */
import { useCallback, useState } from 'react'
import { ConversationPanel, useConversationStream } from '@makinbakin/sdk/components'
import type { ConversationMessage } from '@makinbakin/sdk/components'
import { toast, useMainAgentId } from '@makinbakin/sdk/hooks'

export function DocBrainstormPanel({
  brandId, kind, name, getDocContent,
}: {
  brandId: string
  kind: string
  name: string
  /** Read the editor's live (possibly unsaved) content at send time. */
  getDocContent: () => string
}) {
  const mainAgentId = useMainAgentId()
  const [agentId, setAgentId] = useState<string | null>(null)
  const effectiveAgent = agentId ?? mainAgentId ?? ''
  const [messages, setMessages] = useState<ConversationMessage[]>([])

  const stream = useConversationStream({
    fetcher: (content, { signal }) =>
      fetch(
        `/api/plugins/brands/${encodeURIComponent(brandId)}/docs/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/brainstorm`,
        {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: effectiveAgent,
            message: content,
            history: messages
              .filter((m): m is Extract<ConversationMessage, { kind: 'user' | 'assistant' }> => m.kind === 'user' || m.kind === 'assistant')
              .map((m) => ({ role: m.kind === 'user' ? 'user' : 'agent', content: m.content })),
            docContent: getDocContent(),
          }),
        },
      ),
    onDone: (finalContent) => {
      setMessages((prev) => [
        ...prev,
        { kind: 'assistant', ts: new Date().toISOString(), agentId: effectiveAgent, content: finalContent },
      ])
    },
    onError: (message) => toast(message, 'error'),
  })

  const send = useCallback(
    async (content: string) => {
      if (!effectiveAgent) {
        toast('Pick an agent first', 'error')
        return
      }
      setMessages((prev) => [...prev, { kind: 'user', ts: new Date().toISOString(), content }])
      await stream.send(content)
    },
    [effectiveAgent, stream],
  )

  return (
    <ConversationPanel
      messages={messages}
      liveChunks={stream.liveChunks}
      streaming={stream.streaming}
      agentId={effectiveAgent}
      onAgentChange={setAgentId}
      onSend={send}
      onAbort={stream.abort}
      storageKey={`brand-doc-brainstorm:${brandId}:${kind}:${name}`}
      title="Brainstorm"
      fitParent
      placeholder="Ask for feedback, a rewrite, missing sections..."
      emptyState={
        <div className="px-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Ask an agent about this doc</p>
          <p className="mt-1">
            It sees your current draft (even unsaved). Try "what's missing?", "tighten the personality section",
            or "draft 5 example sentences". Replies stay here — paste what you like into the editor.
          </p>
        </div>
      }
    />
  )
}
