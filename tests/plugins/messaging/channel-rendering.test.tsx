// @vitest-environment jsdom
/**
 * Regression guards — messaging renders channel chips sourced from the
 * workflows.notificationChannels registry. Locks in the graceful-degradation
 * contract for orphan channel refs in legacy frontmatter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-channel-rendering-${Date.now()}`)

vi.mock('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

const MOCK_CHANNELS = [
  { runtime: 'builtin' as const, id: 'discord', label: 'Discord', initials: 'DC', icon: 'MessageSquare' },
  { runtime: 'builtin' as const, id: 'email',   label: 'Email',   initials: 'EM', icon: 'Mail' },
  { runtime: 'builtin' as const, id: 'slack',   label: 'Slack',   initials: 'SL', icon: 'MessageSquare' },
]

vi.mock('@bakin/workflows/hooks/use-notification-channels', () => ({
  useNotificationChannels: () => MOCK_CHANNELS,
  getChannelLabel: (id: string, channels: typeof MOCK_CHANNELS) =>
    channels.find(c => c.id === id)?.label ?? id,
  getChannelInitials: (id: string, channels: typeof MOCK_CHANNELS) =>
    channels.find(c => c.id === id)?.initials ?? id.slice(0, 2).toUpperCase(),
}))

vi.mock('@bakin/workflows/hooks/channel-icon', () => ({
  ChannelIcon: ({ channelId }: { channelId: string }) => <span data-testid={`channel-icon-${channelId}`} />,
}))

vi.mock('@bakin/team/hooks/use-agent-store', () => ({
  useAgent: (id: string) => ({ id, name: id, emoji: '🤖', role: '', headshot: '' }),
  useAgentIds: () => ['basil'],
  useAgentList: () => [{ id: 'basil', name: 'Basil', emoji: '🥗', role: '', headshot: '' }],
  useAgentColor: () => '#a1a1aa',
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ agents: [], agentIds: [] }),
}))

vi.mock('../../../plugins/messaging/hooks/use-content-types', () => ({
  useContentTypes: () => [{ id: 'post', label: 'Post' }],
  getContentTypeLabel: (id: string) => id,
}))

vi.mock('@/components/bakin-drawer', () => ({
  BakinDrawer: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
}))

vi.mock('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid={`avatar-${agentId}`} />,
}))

vi.mock('@/components/agent-select', () => ({
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
    channel: 'discord',
    channelTarget: '1234',
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
        item={makeItem({ channels: ['discord', 'email'] })}
        open
        editing={false}
        onClose={vi.fn()}
        onCancelEdit={vi.fn()}
        onEdit={vi.fn()}
        onUpdated={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    // Detail view shows chips labelled with getChannelLabel
    expect(screen.getByText(/Discord/)).toBeDefined()
    expect(screen.getByText(/Email/)).toBeDefined()
  })

  it('falls back to raw id + uppercase prefix for orphan channels not in the registry', () => {
    render(
      <ItemDetailDrawer
        item={makeItem({ channels: ['mastodon'] })}
        open
        editing={false}
        onClose={vi.fn()}
        onCancelEdit={vi.fn()}
        onEdit={vi.fn()}
        onUpdated={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    // Raw id rendered as the label, prefix MA as the initials
    expect(screen.getByText(/mastodon/)).toBeDefined()
    expect(screen.getByText(/MA/)).toBeDefined()
  })
})
