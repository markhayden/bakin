/**
 * Chat view — one conversation on the kit: header (avatar, inline-editable
 * title, pin, working state), Conversation, Composer, ToolCallDrawer.
 * Draft mode renders the same shell before a chat exists; the chat is
 * created on first send.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, Pencil, Pin, PinOff } from 'lucide-react'
import {
  AgentAvatar,
  Composer,
  Conversation,
  ConversationEmptyState,
  ToolCallDrawer,
  foldConversation,
  type ConversationToolCall,
} from '@makinbakin/sdk/components'
import { useAgent } from '@makinbakin/sdk/hooks'

import { patchChatRequest, useChatStream, type ChatSummaryDto } from './use-chat-data'

const CONTENT_MAX = 64_000

function InlineTitle({ chat, onChanged }: { chat: ChatSummaryDto; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title)

  useEffect(() => setDraft(chat.title), [chat.title])

  const commit = async () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (!trimmed || trimmed === chat.title) return
    await patchChatRequest(chat.id, { title: trimmed })
    onChanged()
  }

  if (editing) {
    return (
      <form
        className="flex min-w-0 flex-1 items-center gap-1"
        onSubmit={(e) => { e.preventDefault(); void commit() }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(chat.title); setEditing(false) } }}
          className="min-w-0 flex-1 rounded border border-ring bg-transparent px-1.5 py-0.5 text-sm font-medium focus:outline-none"
          aria-label="Chat title"
          autoFocus
        />
        <button type="submit" aria-label="Save title" className="rounded p-1 text-muted-foreground hover:text-foreground">
          <Check className="size-3.5" />
        </button>
      </form>
    )
  }
  return (
    <button
      type="button"
      data-chat-title
      onClick={() => setEditing(true)}
      title="Rename chat"
      className="group/title flex min-w-0 flex-1 items-center gap-1.5 text-left"
    >
      <span className="truncate text-sm font-medium">{chat.title || 'New chat'}</span>
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
    </button>
  )
}

function ViewHeader({
  agentId,
  chat,
  streaming,
  onChanged,
}: {
  agentId: string
  chat: ChatSummaryDto | null
  streaming: boolean
  onChanged: () => void
}) {
  const agent = useAgent(agentId)
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
      <AgentAvatar agentId={agentId} size="sm" />
      <div className="min-w-0 flex-1">
        {chat ? (
          <InlineTitle chat={chat} onChanged={onChanged} />
        ) : (
          <span className="text-sm font-medium">New chat</span>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{agent?.name ?? agentId}</span>
          {streaming ? (
            <span className="flex items-center gap-1" data-chat-header-working>
              · <Loader2 className="size-3 animate-spin" /> working…
            </span>
          ) : null}
        </div>
      </div>
      {chat ? (
        <button
          type="button"
          aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={() => { void patchChatRequest(chat.id, { pinned: !chat.pinned }).then(onChanged) }}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {chat.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </button>
      ) : null}
    </div>
  )
}

/** Draft mode: agent picked, chat not yet persisted — created on first send. */
export function DraftChatView({
  agentId,
  onCreated,
  createAndSend,
}: {
  agentId: string
  onCreated: (chatId: string) => void
  createAndSend: (agentId: string, content: string) => Promise<string | null>
}) {
  const agent = useAgent(agentId)
  const name = agent?.name ?? agentId
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async (content: string) => {
    setSending(true)
    setError(null)
    try {
      const chatId = await createAndSend(agentId, content)
      if (chatId) onCreated(chatId)
      else setError('Could not start the chat — is the agent still in the roster?')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col" data-chat-draft>
      <ViewHeader agentId={agentId} chat={null} streaming={false} onChanged={() => {}} />
      <div className="flex flex-1 items-center justify-center p-6">
        <ConversationEmptyState
          title={`Chat with ${name}`}
          description="Ask anything — the agent keeps its Bakin tools and can create tasks mid-chat."
        />
      </div>
      {error ? (
        <div className="flex items-center gap-2 px-4 pb-2 text-sm text-destructive">
          <AlertTriangle className="size-4" /> {error}
        </div>
      ) : null}
      <Composer
        storageKey={`chat-draft:${agentId}`}
        placeholder={`Message ${name}…`}
        onSend={(content) => { void handleSend(content) }}
        busy={sending}
        maxLength={CONTENT_MAX}
      />
    </div>
  )
}

export function ChatView({ chatId, onChanged }: { chatId: string; onChanged: () => void }) {
  const { chat, messages, liveChunks, streaming, sendError, send, abort, retry } = useChatStream(chatId)
  const [openCall, setOpenCall] = useState<ConversationToolCall | null>(null)

  if (!chat) return null

  const turns = foldConversation(messages, liveChunks != null ? { liveChunks, liveAgentId: chat.agentId } : undefined)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ViewHeader agentId={chat.agentId} chat={chat} streaming={streaming} onChanged={onChanged} />

      <Conversation
        turns={turns}
        agentId={chat.agentId}
        onRetry={retry}
        onOpenCall={setOpenCall}
        emptyState={
          <ConversationEmptyState
            title={`Chat with ${chat.agentId}`}
            description="Ask anything — the agent keeps its Bakin tools and can create tasks mid-chat."
          />
        }
      />

      {sendError ? (
        <div className="flex items-center gap-2 px-4 pb-1 text-sm text-destructive">
          <AlertTriangle className="size-4" /> {sendError}
          <button type="button" onClick={retry} className="underline underline-offset-2 hover:text-foreground">
            Try again
          </button>
        </div>
      ) : null}

      <Composer
        storageKey={`chat:${chatId}`}
        placeholder="Message the agent…"
        onSend={(content) => { void send(content) }}
        busy={streaming}
        onAbort={abort}
        maxLength={CONTENT_MAX}
      />

      <ToolCallDrawer call={openCall} open={openCall !== null} onOpenChange={(open) => !open && setOpenCall(null)} />
    </div>
  )
}
