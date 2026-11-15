/**
 * Entity cards in an agent turn: resolved kinds render as one whole-card
 * link; unresolved kinds render as plain content.
 */
import { describe, expect, it, mock } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'
import { actRender } from '../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-entity-card-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { AgentTurn, Conversation, foldConversation, type ConversationMessage } from '@makinbakin/sdk/conversation'
import { EntityKindResolverContext, type EntityKindResolver } from '@makinbakin/sdk/internal'

const rows: ConversationMessage[] = [
  { kind: 'user', ts: '2026-11-14T10:00:01.000Z', content: 'plan the launch' },
  {
    kind: 'tool', ts: '2026-11-14T10:00:02.000Z', turnId: 't1', toolName: 'bakin_exec_projects_create', status: 'completed',
    metadata: { bakinEntities: [
      { kind: 'projects:project', id: 'p-1', title: 'Launch plan', action: 'created' },
      { kind: 'gone:widget-thing', id: 'w-1', title: 'Old widget', action: 'updated' },
    ] },
  },
  { kind: 'assistant', ts: '2026-11-14T10:00:03.000Z', turnId: 't1', content: 'Done.' },
]
const turn = foldConversation(rows).find((t) => t.kind === 'agent')!
const agent = { id: 'main', name: 'Main' }

const resolve: EntityKindResolver = (ref) => (ref.kind === 'projects:project'
  ? { label: 'Project', icon: <svg data-testid="icon" />, link: <a href={`/projects/${ref.id}`} /> }
  : null)

describe('entity cards in an agent turn', () => {
  it('a resolved kind is one link naming the kind and title', async () => {
    await actRender(() => render(
      <EntityKindResolverContext value={resolve}>
        <AgentTurn turn={turn as never} agent={agent} />
      </EntityKindResolverContext>,
    ))
    const list = screen.getByRole('list', { name: 'Created and updated' })
    const link = within(list).getByRole('link', { name: 'Open project: Launch plan' })
    expect(link.getAttribute('href')).toBe('/projects/p-1')
    expect(within(list).getByText('Project · Created')).toBeDefined()
    expect(within(list).getAllByRole('link')).toHaveLength(1)
  })

  it('an unresolved kind is plain content named after the kind', async () => {
    await actRender(() => render(
      <EntityKindResolverContext value={resolve}>
        <AgentTurn turn={turn as never} agent={agent} />
      </EntityKindResolverContext>,
    ))
    expect(screen.getByText('Old widget')).toBeDefined()
    expect(screen.getByText('Widget thing · Updated')).toBeDefined()
  })

  it('with no resolver at all, every card is plain content', async () => {
    await actRender(() => render(<AgentTurn turn={turn as never} agent={agent} />))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Project · Created')).toBeDefined()
  })
})

describe('hand-off markers in a conversation', () => {
  const proj = { entity: 'projects:project', id: 'p-1', title: 'Launch plan' }
  const chat = { entity: 'chat:chat', id: 'c-1', title: 'Launch chat' }
  const linked: EntityKindResolver = (ref) => {
    const href = ref.kind === 'projects:project' ? `/projects/${ref.id}` : ref.kind === 'chat:chat' ? `/chat/${ref.id}` : null
    if (!href) return null
    return { label: ref.kind === 'chat:chat' ? 'Chat' : 'Project', link: <a href={href} />, renderLink: (children) => <a href={href}>{children}</a> }
  }

  it('out: a "continued here" card per target, linking there', async () => {
    const turns = foldConversation([
      { kind: 'assistant', ts: '2026-11-14T10:00:01.000Z', turnId: 't1', content: 'Project created.' },
      { kind: 'handoff', ts: '2026-11-14T10:00:02.000Z', handoffId: 'c-1:t1', direction: 'out', peers: [proj] },
    ])
    await actRender(() => render(
      <EntityKindResolverContext value={linked}><Conversation turns={turns} agent={agent} /></EntityKindResolverContext>,
    ))
    const list = screen.getByRole('list', { name: 'Continued in' })
    expect(within(list).getByRole('link', { name: 'Open project: Launch plan' }).getAttribute('href')).toBe('/projects/p-1')
    expect(within(list).getByText('Project · Continued here')).toBeDefined()
  })

  it('in: a divider naming the source, linking back to it', async () => {
    const turns = foldConversation([
      { kind: 'handoff', ts: '2026-11-14T10:00:02.000Z', handoffId: 'c-1:t1:p-1', direction: 'in', peers: [chat], carried: 1 },
      { kind: 'user', ts: '2026-11-14T09:00:00.000Z', content: 'plan the launch' },
    ])
    await actRender(() => render(
      <EntityKindResolverContext value={linked}><Conversation turns={turns} agent={agent} /></EntityKindResolverContext>,
    ))
    const note = screen.getByRole('note')
    expect(note.textContent).toBe('Carried over from the chat Launch chat')
    expect(within(note).getByRole('link', { name: 'Launch chat' }).getAttribute('href')).toBe('/chat/c-1')
    expect(screen.getByText('plan the launch')).toBeDefined()
  })

  it('without a resolver both markers are plain content, never a dead link', async () => {
    const turns = foldConversation([
      { kind: 'handoff', ts: '2026-11-14T10:00:02.000Z', handoffId: 'h', direction: 'in', peers: [chat], carried: 0 },
      { kind: 'handoff', ts: '2026-11-14T10:00:03.000Z', handoffId: 'h2', direction: 'out', peers: [proj] },
    ])
    await actRender(() => render(<Conversation turns={turns} agent={agent} />))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('note').textContent).toBe('Carried over from the chat Launch chat')
    expect(screen.getByText('Project · Continued here')).toBeDefined()
  })
})
