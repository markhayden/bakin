/**
 * Launcher — the no-chat-selected pane: agent quick-start cards + recent
 * conversations. Never a bare "select a chat" line.
 */
import { MessageCirclePlus } from 'lucide-react'
import { AgentAvatar, formatRelativeTime } from '@makinbakin/sdk/components'
import { useAgentList } from '@makinbakin/sdk/hooks'
import { Skeleton } from '@makinbakin/sdk/ui'

import type { ChatSummaryDto } from './use-chat-data'

const MAX_AGENT_CARDS = 8
const MAX_RECENTS = 6

export function Launcher({
  chats,
  loading,
  onStartChat,
  onOpenChat,
}: {
  chats: ChatSummaryDto[]
  loading: boolean
  onStartChat: (agentId: string) => void
  onOpenChat: (chatId: string) => void
}) {
  const agents = useAgentList()

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6 p-8" data-chat-launcher-skeleton>
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-6 w-24" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto" data-chat-launcher>
      <div className="mx-auto w-full max-w-2xl space-y-8 p-8">
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <MessageCirclePlus className="size-5 text-muted-foreground" /> Start a chat
          </h2>
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agents in the runtime roster yet — add one from the Team page and it appears here.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {agents.slice(0, MAX_AGENT_CARDS).map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  data-chat-agent-card={agent.id}
                  onClick={() => onStartChat(agent.id)}
                  className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 transition-colors hover:border-ring hover:bg-accent/50"
                >
                  <AgentAvatar agentId={agent.id} size="lg" />
                  <span className="w-full truncate text-center text-sm">{agent.name || agent.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {chats.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Recent</h3>
            <div className="space-y-1">
              {chats.slice(0, MAX_RECENTS).map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => onOpenChat(chat.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-accent/50"
                >
                  <AgentAvatar agentId={chat.agentId} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm ${chat.unreadCount > 0 ? 'font-semibold' : ''}`}>
                      {chat.title || 'New chat'}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {chat.lastMessagePreview || chat.agentId}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(chat.updatedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
