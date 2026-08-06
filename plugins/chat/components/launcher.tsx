/**
 * Launcher — the no-chat-selected pane: agent quick-start cards + recent
 * conversations. Never a bare "select a chat" line.
 */
import { MessageCirclePlus } from 'lucide-react'
import { formatRelativeTime } from '@makinbakin/sdk/conversation'
import { useAgentList } from '@makinbakin/sdk/hooks'
import { Grid } from '@makinbakin/sdk/layout'
import { AgentAvatar, ListRow, ListRows } from '@makinbakin/sdk/patterns'
import { Card, CardContent, Skeleton, SystemState } from '@makinbakin/sdk/ui'

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
      <SystemState
        kind="loading"
        scope="section"
        title="Loading chats"
        data-chat-launcher-skeleton
        preview={(
          <div className="w-full space-y-bakin-4">
            <Grid layout="quarters" gap="item">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-bakin-surface" />
              ))}
            </Grid>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-bakin-3 px-bakin-2">
                <Skeleton className="size-bakin-8 rounded-bakin-pill" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-bakin-3 w-3/4" />
                  <Skeleton className="mt-bakin-1 h-bakin-2 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}
      />
    )
  }

  return (
    <div className="flex-1 overflow-y-auto" data-chat-launcher>
      <div className="w-full space-y-bakin-8 p-bakin-4 md:p-bakin-6">
        <section className="space-y-bakin-3" aria-labelledby="chat-start-heading">
          <h2
            id="chat-start-heading"
            className="flex items-center gap-bakin-2 text-bakin-typography-size-section-title font-bakin-typography-weight-semibold"
          >
            <MessageCirclePlus className="size-5 text-bakin-text-muted" /> Start a chat
          </h2>
          {agents.length === 0 ? (
            <SystemState
              kind="initial-empty"
              scope="inline"
              title="No agents yet"
              description="Add one from the Team page and it appears here."
            />
          ) : (
            <Grid layout="quarters" gap="item">
              {agents.slice(0, MAX_AGENT_CARDS).map((agent) => (
                <Card
                  key={agent.id}
                  size="sm"
                  data-chat-agent-card={agent.id}
                  interactive={{
                    label: `Chat with ${agent.name || agent.id}`,
                    onActivate: () => onStartChat(agent.id),
                  }}
                >
                  <CardContent className="flex flex-col items-center gap-bakin-2 text-center">
                    <AgentAvatar
                      agent={{ id: agent.id, name: agent.name || agent.id, imageSrc: agent.headshot || null }}
                      size="lg"
                      decorative
                    />
                    <span className="w-full truncate text-bakin-typography-size-body font-bakin-typography-weight-medium">
                      {agent.name || agent.id}
                    </span>
                    {agent.role ? (
                      <span className="line-clamp-2 w-full text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">
                        {agent.role}
                      </span>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </Grid>
          )}
        </section>

        {chats.length > 0 ? (
          <section className="space-y-bakin-2" aria-labelledby="chat-recents-heading">
            <h3 id="chat-recents-heading" className="text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-muted">Recent</h3>
            <ListRows aria-label="Recent chats">
              {chats.slice(0, MAX_RECENTS).map((chat) => (
                <ListRow
                  key={chat.id}
                  interactive={{ label: `Open chat: ${chat.title || 'New chat'}`, onActivate: () => onOpenChat(chat.id) }}
                  className="flex items-center gap-bakin-3"
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
                      <span
                        className={`block truncate text-bakin-typography-size-body ${
                          chat.unreadCount > 0 ? 'font-bakin-typography-weight-semibold' : ''
                        }`}
                      >
                        {chat.title || 'New chat'}
                      </span>
                      <span className="mt-bakin-2 block truncate text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">
                        {chat.lastMessagePreview || chat.agentId}
                      </span>
                    </span>
                    <span className="shrink-0 text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">
                      {formatRelativeTime(chat.updatedAt)}
                    </span>
                </ListRow>
              ))}
            </ListRows>
          </section>
        ) : null}
      </div>
    </div>
  )
}
