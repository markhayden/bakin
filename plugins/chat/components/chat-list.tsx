/**
 * Chat list — left rail: new-chat picker, per-agent filter, chat rows.
 */
import { useState } from 'react'
import { MessageCirclePlus, Trash2 } from 'lucide-react'
import { AgentAvatar, AgentSelect, ConfirmDialog, EmptyState } from '@makinbakin/sdk/components'

import { createChatRequest, deleteChatRequest, type ChatSummaryDto } from './use-chat-data'

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function ChatList(props: {
  chats: ChatSummaryDto[]
  selectedId: string
  agentFilter: string
  onSelect: (chatId: string) => void
  onAgentFilter: (agentId: string) => void
  onChanged: () => void
}) {
  const { chats, selectedId, agentFilter, onSelect, onAgentFilter, onChanged } = props
  const [newAgent, setNewAgent] = useState('')
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ChatSummaryDto | null>(null)

  const startChat = async (agentId: string) => {
    if (!agentId || creating) return
    setCreating(true)
    try {
      const chat = await createChatRequest(agentId)
      if (chat) {
        onChanged()
        onSelect(chat.id)
      }
    } finally {
      setCreating(false)
      setNewAgent('')
    }
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <AgentSelect
            value={newAgent}
            onValueChange={(v) => { setNewAgent(v); void startChat(v) }}
            placeholder="New chat with…"
            className="flex-1"
          />
          <MessageCirclePlus className="size-4 shrink-0 text-muted-foreground" />
        </div>
        <AgentSelect
          value={agentFilter}
          onValueChange={onAgentFilter}
          allowNone
          noneLabel="All agents"
          placeholder="Filter by agent"
          className="w-full"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <EmptyState title="No chats yet" description="Pick an agent above to start one." />
        ) : (
          chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => onSelect(chat.id)}
              className={`group flex w-full items-center gap-2 border-b px-3 py-2 text-left hover:bg-accent/50 ${
                chat.id === selectedId ? 'bg-accent' : ''
              }`}
            >
              <AgentAvatar agentId={chat.agentId} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{chat.title || 'Untitled chat'}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {chat.agentId} · {chat.messageCount} msg · {relativeTime(chat.updatedAt)}
                </div>
              </div>
              <Trash2
                className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); setPendingDelete(chat) }}
              />
            </button>
          ))
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete chat?"
        description={`"${pendingDelete?.title || 'Untitled chat'}" and its transcript will be removed.`}
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return
          void deleteChatRequest(pendingDelete.id).then(() => {
            if (pendingDelete.id === selectedId) onSelect('')
            setPendingDelete(null)
            onChanged()
          })
        }}
      />
    </div>
  )
}
