/**
 * Embedded brainstorm for the brand doc editor (conversation kit): ask an
 * agent for feedback or drafted copy while editing. Durable since #703 —
 * the transcript persists per doc, turns run server-side on the
 * conversation turn engine and stream as brands.brainstorm.* bus events,
 * so navigating away never kills a turn and reopening the panel restores
 * the conversation (including a mid-flight streaming indicator).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ConversationPanel,
  useConversationThread,
  type ConversationMessage,
} from '@makinbakin/sdk/conversation'
import { toast, useMainAgentId } from '@makinbakin/sdk/hooks'
import { AgentSelect } from '@makinbakin/sdk/patterns'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { useBrandAgentOptions } from './use-brand-agent-options'

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
  const agentOptions = useBrandAgentOptions()
  const [agentId, setAgentId] = useState<string | null>(null)
  const effectiveAgent = agentId ?? mainAgentId ?? ''
  const selectedAgent = agentOptions.find((agent) => agent.id === effectiveAgent)
  const key = `${brandId}/${kind}/${name}`
  const docPath = `${encodeURIComponent(brandId)}/docs/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`

  const thread = useConversationThread({
    threadKey: key,
    events: {
      chunk: 'brands.brainstorm.chunk',
      done: 'brands.brainstorm.done',
      error: 'brands.brainstorm.error',
    },
    keyOf: (payload) => payload.key,
    load: async () => {
      const res = await pluginFetch('brands', `${docPath}/brainstorm`)
      if (!res.ok) return null
      return (await res.json()) as { messages: ConversationMessage[]; streaming?: boolean; streamingText?: string }
    },
    post: async (_key, content) => {
      const res = await pluginFetch('brands', `${docPath}/brainstorm`, {
        method: 'POST',
        body: { agent: effectiveAgent, message: content, docContent: getDocContent() },
      })
      if (res.ok) return { ok: true }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, status: res.status, ...(body.error ? { error: body.error } : {}) }
    },
  })

  // Send failures (409 busy, network) surface as a toast — the panel has
  // no persistent error strip and the optimistic row stays visible.
  useEffect(() => {
    if (thread.sendError) toast(thread.sendError, 'error')
  }, [thread.sendError])

  const send = useCallback(
    async (content: string) => {
      if (!effectiveAgent) {
        toast('Pick an agent first', 'error')
        return
      }
      await thread.send(content)
    },
    [effectiveAgent, thread.send],
  )

  const abort = useCallback(() => {
    void pluginFetch('brands', `${docPath}/brainstorm/abort`, { method: 'POST' }).catch(() => {})
  }, [docPath])

  return (
    <ConversationPanel
      messages={thread.messages}
      liveChunks={thread.liveChunks}
      streaming={thread.streaming}
      agent={{
        id: effectiveAgent || undefined,
        name: selectedAgent?.name ?? (effectiveAgent || 'Agent'),
        avatarUrl: selectedAgent?.imageSrc ?? undefined,
      }}
      agentControl={(
        <AgentSelect
          value={effectiveAgent}
          onValueChange={setAgentId}
          agents={agentOptions}
          ariaLabel="Brainstorm agent"
          placeholder="Choose agent"
        />
      )}
      onSend={send}
      onAbort={abort}
      storageKey={`brand-doc-brainstorm:${brandId}:${kind}:${name}`}
      title="Brainstorm"
      placeholder="Ask for feedback, a rewrite, missing sections..."
      emptyState={
        <div className="px-bakin-6 text-center text-bakin-text-muted">
          <p className="m-0 font-bakin-typography-weight-semibold text-bakin-text-primary">Ask an agent about this document</p>
          <p className="m-0 mt-bakin-1 leading-relaxed">
            It sees your current draft (even unsaved). Try "what's missing?", "tighten the personality section",
            or "draft 5 example sentences". Replies stay here — paste what you like into the editor.
          </p>
        </div>
      }
    />
  )
}
