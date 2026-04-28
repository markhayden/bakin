// @vitest-environment jsdom
/**
 * Regression guards — messaging renders channel chips sourced from the
 * workflows.notificationChannels registry. Locks in the graceful-degradation
 * contract for orphan channel refs.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-channel-rendering-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

const MOCK_CHANNELS = [
  { runtime: 'builtin' as const, id: 'general', label: 'General', initials: 'GE', icon: 'MessageSquare' },
  { runtime: 'builtin' as const, id: 'email',   label: 'Email',   initials: 'EM', icon: 'Mail' },
  { runtime: 'builtin' as const, id: 'alerts',  label: 'Alerts',  initials: 'AL', icon: 'MessageSquare' },
]

mock.module('@bakin/workflows/hooks/use-notification-channels', () => ({
  useNotificationChannels: () => MOCK_CHANNELS,
  getChannelLabel: (id: string, channels: typeof MOCK_CHANNELS) =>
    channels.find(c => c.id === id)?.label ?? id,
  getChannelInitials: (id: string, channels: typeof MOCK_CHANNELS) =>
    channels.find(c => c.id === id)?.initials ?? id.slice(0, 2).toUpperCase(),
}))

mock.module('@bakin/workflows/hooks/channel-icon', () => ({
  ChannelIcon: ({ channelId }: { channelId: string }) => <span data-testid={`channel-icon-${channelId}`} />,
}))

mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgent: (id: string) => ({ id, name: id, emoji: '🤖', role: '', headshot: '' }),
  useAgentIds: () => ['basil'],
  useAgentList: () => [{ id: 'basil', name: 'Basil', emoji: '🥗', role: '', headshot: '' }],
  useAgentColor: () => '#a1a1aa',
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ agents: [], agentIds: [] }),
}))

mock.module('../../../plugins/messaging/hooks/use-content-types', () => ({
  useContentTypes: () => [{ id: 'post', label: 'Post' }],
  getContentTypeLabel: (id: string) => id,
}))

mock.module('@/components/bakin-drawer', () => ({
  BakinDrawer: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
}))

mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid={`avatar-${agentId}`} />,
}))

mock.module('@/components/agent-select', () => ({
  AgentSelect: () => <span />,
}))

import { ItemDetailDrawer } from '../../../plugins/messaging/components/item-detail-drawer'
import type { CalendarItem } from '../../../plugins/messaging/types'

afterEach(() => cleanup())

function makeItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: 'item-1',
    title: 'Regression Post',
    agent: 'basil',
    channels: ['general'],
    contentType: 'post',
    tone: 'conversational',
    scheduledAt: '2026-04-21T10:00:00Z',
    brief: 'Brief',
    status: 'draft',
    createdAt: '2026-04-21T00:00:00Z',
    updatedAt: '2026-04-21T00:00:00Z',
    ...overrides,
  }
}

describe('messaging drawer — channel chips from the workflows registry', () => {
  it('renders a chip per registered channel when the item has that channel active', () => {
    render(
      <ItemDetailDrawer
        item={makeItem({ channels: ['general', 'email'] })}
        open
        editing={false}
        onClose={mock()}
        onCancelEdit={mock()}
        onEdit={mock()}
        onUpdated={mock()}
        onDelete={mock()}
      />
    )
    // Detail view shows chips labelled with getChannelLabel
    expect(screen.getByText(/General/)).toBeDefined()
    expect(screen.getByText(/Email/)).toBeDefined()
  })

  it('falls back to raw id + uppercase prefix for orphan channels not in the registry', () => {
    render(
      <ItemDetailDrawer
        item={makeItem({ channels: ['mastodon'] })}
        open
        editing={false}
        onClose={mock()}
        onCancelEdit={mock()}
        onEdit={mock()}
        onUpdated={mock()}
        onDelete={mock()}
      />
    )
    // Raw id rendered as the label when the channel isn't in the registry
    expect(screen.getByText(/mastodon/)).toBeDefined()
  })
})
