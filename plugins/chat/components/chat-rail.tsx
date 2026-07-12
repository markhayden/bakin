/**
 * Chat rail — the session-manager sidebar: Start-a-chat, agent facet
 * filter, and chats grouped Pinned / Today / Yesterday / This week /
 * Older. Rows carry unread pills and a working spinner; the rail is
 * collapsible (persisted).
 */
import { useState } from 'react'
import { Loader2, PanelLeftClose, PanelLeftOpen, Pin, Trash2 } from 'lucide-react'
import { AgentAvatar, AgentFilter, ConfirmDialog, EmptyState, formatRelativeTime } from '@makinbakin/sdk/components'
import { Skeleton } from '@makinbakin/sdk/ui'

import { AgentPicker } from './agent-picker'
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
  return (
    <div
      data-chat-row={chat.id}
      className={`group relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
        selected ? 'bg-foreground/10' : 'hover:bg-foreground/5'
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
      }}
    >
      <AgentAvatar agentId={chat.agentId} size="sm" />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${chat.unreadCount > 0 ? 'font-semibold' : ''}`}>
          {chat.title || 'New chat'}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {chat.lastMessagePreview || chat.agentId} · {formatRelativeTime(chat.updatedAt)}
        </div>
      </div>
      {streaming ? (
        <Loader2 data-chat-working className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : chat.unreadCount > 0 ? (
        <span
          data-chat-unread
          className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[10px] font-medium text-primary-foreground"
        >
          {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
        </span>
      ) : null}
      <div className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 rounded-md border border-border bg-background/95 p-0.5 shadow-sm group-hover:flex">
        <button
          type="button"
          aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={(e) => { e.stopPropagation(); onTogglePin() }}
          className={`rounded p-1 transition-colors hover:bg-accent ${
            chat.pinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Pin className={`size-3 ${chat.pinned ? 'fill-current' : ''}`} />
        </button>
        <button
          type="button"
          aria-label="Delete chat"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
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
  onStartChat: (agentId: string) => void
  onAgentFilter: (agentId: string) => void
  onChanged: () => void
}) {
  const {
    chats, agentIds, loading, selectedId, agentFilter, streamingIds, collapsed,
    onCollapse, onSelect, onStartChat, onAgentFilter, onChanged,
  } = props
  const [pendingDelete, setPendingDelete] = useState<ChatSummaryDto | null>(null)

  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-border py-2">
        <button
          type="button"
          aria-label="Expand chat list"
          onClick={() => onCollapse(false)}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-border">
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <AgentPicker onPick={onStartChat} iconOnly />
          <button
            type="button"
            aria-label="Collapse chat list"
            onClick={() => onCollapse(true)}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>
        {agentIds.length > 1 ? (
          <div className="pt-[5px]">
            <AgentFilter
              agentIds={agentIds}
              value={agentFilter || 'all'}
              onChange={(id) => onAgentFilter(id === 'all' ? '' : id)}
            />
          </div>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="space-y-2 px-1 pt-1" data-chat-rail-skeleton>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : chats.length === 0 ? (
          <div className="pt-4">
            <EmptyState title="No chats yet" description="Start one with any agent above." />
          </div>
        ) : (
          groupChats(chats).map((group) => (
            <div key={group.label}>
              <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-0.5">
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
              </div>
            </div>
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
