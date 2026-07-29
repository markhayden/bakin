/**
 * Launcher — the no-chat-selected pane: agent quick-start cards + recent
 * conversations. Never a bare "select a chat" line.
 */
import { MessageCirclePlus } from 'lucide-react'
import { formatRelativeTime } from '@makinbakin/sdk/conversation'
import { useAgentList } from '@makinbakin/sdk/hooks'
import { AgentAvatar, ListRow, ListRows } from '@makinbakin/sdk/patterns'
import { Button, Skeleton } from '@makinbakin/sdk/ui'

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
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))

  if (loading) {
    return (
      <div className="w-full space-y-bakin-6 p-bakin-4 md:p-bakin-6" data-chat-launcher-skeleton>
        <Skeleton className="h-bakin-6 w-40" />
        <div className="grid grid-cols-1 gap-bakin-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-bakin-surface" />
          ))}
        </div>
        <Skeleton className="h-bakin-6 w-24" />
        <div className="space-y-bakin-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-bakin-surface" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto" data-chat-launcher>
      <div className="w-full space-y-bakin-8 p-bakin-4 md:p-bakin-6">
        <div className="space-y-bakin-3">
          <h2 className="flex items-center gap-bakin-2 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold">
            <MessageCirclePlus className="size-bakin-5 text-bakin-text-muted" /> Start a chat
          </h2>
          {agents.length === 0 ? (
            <p className="text-bakin-typography-size-body text-bakin-text-muted">
              No agents in the runtime roster yet — add one from the Team page and it appears here.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-bakin-3 sm:grid-cols-2 lg:grid-cols-4">
              {agents.slice(0, MAX_AGENT_CARDS).map((agent) => (
                <Button
                  key={agent.id}
                  type="button"
                  variant="outline"
                  data-chat-agent-card={agent.id}
                  onClick={() => onStartChat(agent.id)}
                  className="h-auto min-w-0 flex-col gap-bakin-2 whitespace-normal p-bakin-4"
                >
                  <AgentAvatar
                    agent={{ id: agent.id, name: agent.name || agent.id, imageSrc: agent.headshot || null }}
                    size="lg"
                    decorative
                  />
                  <span className="w-full truncate text-center">{agent.name || agent.id}</span>
                  {agent.role ? (
                    <span className="line-clamp-2 w-full text-center text-bakin-typography-size-meta font-bakin-typography-weight-regular leading-snug text-bakin-text-muted">
                      {agent.role}
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>
          )}
        </div>

        {chats.length > 0 ? (
          <section className="space-y-bakin-2" aria-labelledby="chat-recents-heading">
            <h3 id="chat-recents-heading" className="text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-muted">Recent</h3>
            <ListRows aria-label="Recent chats">
              {chats.slice(0, MAX_RECENTS).map((chat) => (
                <ListRow key={chat.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChat(chat.id)}
                    className="h-auto w-full min-w-0 justify-start gap-bakin-3 whitespace-normal p-bakin-0 text-left"
                  >
                    <AgentAvatar
                      agent={{
                        id: chat.agentId,
                        name: agentById.get(chat.agentId)?.name || chat.agentId,
                        imageSrc: agentById.get(chat.agentId)?.headshot || null,
                      }}
                      size="sm"
                      decorative
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${chat.unreadCount > 0 ? 'font-bakin-typography-weight-bold' : ''}`}>
                        {chat.title || 'New chat'}
                      </span>
                      <span className="block truncate text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">
                        {chat.lastMessagePreview || chat.agentId}
                      </span>
                    </span>
                    <span className="shrink-0 text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">
                      {formatRelativeTime(chat.updatedAt)}
                    </span>
                  </Button>
                </ListRow>
              ))}
            </ListRows>
          </section>
        ) : null}
      </div>
    </div>
  )
}
