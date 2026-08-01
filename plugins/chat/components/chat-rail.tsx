/**
 * Chat rail — the session-manager sidebar: agent filter pills and chats
 * grouped Pinned / Today / Yesterday / This week /
 * Older. Rows carry unread pills and a working spinner; the rail is
 * collapsible (persisted). Groups ride the kit's ListRowGroup/ListRows
 * contract (per-group labelled lists — refit T6.5).
 */
import { useMemo, useState } from 'react'
import { Loader2, PanelLeftClose, PanelLeftOpen, Pin, Trash2 } from 'lucide-react'
import { formatRelativeTime } from '@makinbakin/sdk/conversation'
import { useAgent, useAgentList } from '@makinbakin/sdk/hooks'
import {
  AgentAvatar,
  AgentFilter,
  ConfirmDialog,
  ListRow,
  ListRowGroup,
  ListRows,
} from '@makinbakin/sdk/patterns'
import { Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'

import { deleteChatRequest, patchChatRequest, type ChatSummaryDto } from './use-chat-data'

const COLLAPSE_KEY = 'bakin-chat-rail-collapsed'

export function useRailCollapsed(): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true'
    } catch {
      return false
    }
  })
  return [
    collapsed,
    (v: boolean) => {
      setCollapsed(v)
      try {
        localStorage.setItem(COLLAPSE_KEY, String(v))
      } catch {
        // Persistence failures never break the toggle.
      }
    },
  ]
}

type Group = { label: string; chats: ChatSummaryDto[] }

function groupChats(chats: ChatSummaryDto[], now = Date.now()): Group[] {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const today = startOfDay.getTime()
  const yesterday = today - 86_400_000
  const week = today - 6 * 86_400_000

  const groups: Group[] = [
    { label: 'Pinned', chats: [] },
    { label: 'Today', chats: [] },
    { label: 'Yesterday', chats: [] },
    { label: 'This week', chats: [] },
    { label: 'Older', chats: [] },
  ]
  for (const chat of chats) {
    if (chat.pinned) {
      groups[0].chats.push(chat)
      continue
    }
    const t = Date.parse(chat.updatedAt)
    if (t >= today) groups[1].chats.push(chat)
    else if (t >= yesterday) groups[2].chats.push(chat)
    else if (t >= week) groups[3].chats.push(chat)
    else groups[4].chats.push(chat)
  }
  return groups.filter((g) => g.chats.length > 0)
}

function ChatRow({
  chat,
  selected,
  streaming,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  chat: ChatSummaryDto
  selected: boolean
  streaming: boolean
  onSelect: () => void
  onDelete: () => void
  onTogglePin: () => void
}) {
  const agent = useAgent(chat.agentId)
  return (
    <ListRow data-chat-row={chat.id} className="group relative p-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onSelect}
        className={`!h-auto w-full min-w-0 justify-start gap-bakin-2 whitespace-normal rounded-bakin-control px-bakin-2 py-bakin-2 text-left font-bakin-typography-weight-regular ${
          selected ? 'bg-bakin-surface-default' : ''
        }`}
      >
        <AgentAvatar
          agent={{
            id: chat.agentId,
            name: agent?.name ?? chat.agentId,
            imageSrc: agent?.headshot ?? null,
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
          <span className="mt-bakin-2 block truncate text-bakin-typography-size-meta text-bakin-text-muted">
            {chat.lastMessagePreview || chat.agentId} · {formatRelativeTime(chat.updatedAt)}
          </span>
        </span>
        {streaming ? (
          <Loader2
            data-chat-working
            className="size-bakin-3 shrink-0 animate-spin text-bakin-text-muted motion-reduce:animate-none"
          />
        ) : chat.unreadCount > 0 ? (
          <span
            data-chat-unread
            className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-bakin-pill bg-bakin-action-primary-background px-bakin-1 font-bakin-typography-family-mono text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-action-primary-foreground"
          >
            {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
          </span>
        ) : null}
      </Button>
      <span className="absolute right-bakin-1 top-bakin-1 hidden items-center gap-bakin-0 rounded-bakin-control border border-bakin-border-subtle bg-bakin-canvas-default/95 p-bakin-0 group-hover:flex group-focus-within:flex">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={(e) => { e.stopPropagation(); onTogglePin() }}
          className={chat.pinned ? 'text-bakin-signal-accent' : 'text-bakin-text-muted'}
        >
          <Pin className={chat.pinned ? 'fill-current' : ''} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Delete chat"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="text-bakin-text-muted hover:bg-bakin-signal-danger/15 hover:text-bakin-signal-danger"
        >
          <Trash2 />
        </Button>
      </span>
    </ListRow>
  )
}

export function ChatRail(props: {
  chats: ChatSummaryDto[]
  /** Agents that have chats — drives the filter pill strip. */
  agentIds: string[]
  loading: boolean
  selectedId: string
  agentFilter: string
  streamingIds: ReadonlySet<string>
  collapsed: boolean
  onCollapse: (v: boolean) => void
  onSelect: (chatId: string) => void
  onAgentFilter: (agentId: string) => void
  onChanged: () => void
}) {
  const {
    chats, agentIds, loading, selectedId, agentFilter, streamingIds, collapsed,
    onCollapse, onSelect, onAgentFilter, onChanged,
  } = props
  const [pendingDelete, setPendingDelete] = useState<ChatSummaryDto | null>(null)
  const roster = useAgentList()
  const agentOptions = useMemo(() => agentIds.map((id) => {
    const agent = roster.find((a) => a.id === id)
    const name = agent?.name || id
    return {
      value: id,
      label: name,
      visual: (
        <AgentAvatar
          agent={{ id, name, imageSrc: agent?.headshot ?? null }}
          size="xs"
          decorative
        />
      ),
    }
  }), [agentIds, roster])

  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-bakin-border-subtle py-bakin-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Expand chat list"
          onClick={() => onCollapse(false)}
          className="text-bakin-text-muted"
        >
          <PanelLeftOpen />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-bakin-border-subtle">
      <div className="p-bakin-3">
        <div className="flex items-center justify-between gap-bakin-2 pt-bakin-1">
          {agentIds.length > 1 ? (
            <AgentFilter
              options={agentOptions}
              value={agentFilter || 'all'}
              onValueChange={(id) => onAgentFilter(id === 'all' ? '' : id)}
              compact
            />
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse chat list"
            onClick={() => onCollapse(true)}
            className="text-bakin-text-muted"
          >
            <PanelLeftClose />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-bakin-3 overflow-y-auto px-bakin-2 pb-bakin-2">
        {loading ? (
          <div className="space-y-bakin-2 px-bakin-1 pt-bakin-1" data-chat-rail-skeleton>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-bakin-2">
                <Skeleton className="size-bakin-8 rounded-bakin-pill" />
                <div className="flex-1 space-y-bakin-1">
                  <Skeleton className="h-bakin-3 w-3/4" />
                  <Skeleton className="h-bakin-2 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : chats.length === 0 ? (
          <SystemState
            kind="initial-empty"
            scope="section"
            title="No chats yet"
            description="Use Start a chat (top right) to begin one."
          />
        ) : (
          groupChats(chats).map((group) => (
            <ListRowGroup key={group.label} label={group.label}>
              <ListRows variant="plain" className="gap-bakin-0">
                {group.chats.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    selected={chat.id === selectedId}
                    streaming={streamingIds.has(chat.id)}
                    onSelect={() => onSelect(chat.id)}
                    onDelete={() => setPendingDelete(chat)}
                    onTogglePin={() => {
                      void patchChatRequest(chat.id, { pinned: !chat.pinned }).then(onChanged)
                    }}
                  />
                ))}
              </ListRows>
            </ListRowGroup>
          ))
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete chat?"
        description={`"${pendingDelete?.title || 'New chat'}" and its transcript will be removed.`}
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
