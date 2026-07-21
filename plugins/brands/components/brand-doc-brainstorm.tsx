/**
 * Embedded brainstorm for the brand doc editor (conversation kit): ask an
 * agent for feedback or drafted copy while editing. Durable since #703 —
 * the transcript persists per doc, turns run server-side on the
 * conversation turn engine and stream as brands.brainstorm.* bus events,
 * so navigating away never kills a turn and reopening the panel restores
 * the conversation (including a mid-flight streaming indicator).
 */
import { useCallback, useEffect, useState } from 'react'
import { ConversationPanel, useConversationThread } from '@makinbakin/sdk/components'
import { toast, useMainAgentId } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'

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
      return (await res.json()) as { messages: []; streaming?: boolean }
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
    [effectiveAgent, thread],
  )

  const abort = useCallback(() => {
    void pluginFetch('brands', `${docPath}/brainstorm/abort`, { method: 'POST' }).catch(() => {})
  }, [docPath])

  return (
    <ConversationPanel
      messages={thread.messages}
      liveChunks={thread.liveChunks}
      streaming={thread.streaming}
      agentId={effectiveAgent}
      onAgentChange={setAgentId}
      onSend={send}
      onAbort={abort}
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
