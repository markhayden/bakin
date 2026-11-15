/**
 * Entity cards in the fold: what a tool call created or changed, carried on
 * its row as `metadata.bakinEntities`, becomes an `entities` turn item beside
 * the activity it came from.
 *
 * Pure logic — no DOM, no React.
 */
import { describe, expect, it } from 'bun:test'

import type { RuntimeChatChunk } from '@makinbakin/sdk/types'
import {
  foldConversation,
  type ConversationEntityRef,
  type ConversationMessage,
  type ConversationTurn,
  type TurnItem,
} from '@makinbakin/sdk/conversation'

const ts = (n: number) => `2026-11-14T10:00:0${n}.000Z`
const project: ConversationEntityRef = { kind: 'projects:project', id: 'p-1', title: 'Launch plan', action: 'created' }
const task: ConversationEntityRef = { kind: 'tasks:task', id: 't-1', title: 'Write the brief', action: 'created' }

const toolRow = (toolName: string, entities?: unknown, n = 2): ConversationMessage => ({
  kind: 'tool', ts: ts(n), turnId: 'turn-1', callId: `call-${toolName}-${n}`, toolName, status: 'completed',
  ...(entities === undefined ? {} : { metadata: { bakinEntities: entities } }),
})
const user: ConversationMessage = { kind: 'user', ts: ts(1), content: 'plan the launch' }
const items = (turns: ConversationTurn[]): TurnItem[] => turns.flatMap((turn) => (turn.kind === 'agent' ? turn.items : []))
const refs = (turns: ConversationTurn[]): ConversationEntityRef[] =>
  items(turns).flatMap((item) => (item.type === 'entities' ? item.refs : []))

describe('foldConversation — entities', () => {
  it('a tool row with entities keeps its activity and adds a card item after it', () => {
    const turns = foldConversation([user, toolRow('bakin_exec_projects_create', [project])])
    expect(items(turns).map((item) => item.type)).toEqual(['activity', 'entities'])
    expect(refs(turns)).toEqual([project])
  })

  it('cards from consecutive tool calls collect after one activity group', () => {
    const turns = foldConversation([
      user,
      toolRow('bakin_exec_projects_create', [project], 2),
      toolRow('bakin_exec_tasks_list', undefined, 3),
      toolRow('bakin_exec_tasks_create', [task], 4),
    ])
    const turnItems = items(turns)
    expect(turnItems.map((item) => item.type)).toEqual(['activity', 'entities'])
    expect(turnItems[0]!.type === 'activity' && turnItems[0]!.calls.map((call) => call.toolName)).toEqual([
      'bakin_exec_projects_create', 'bakin_exec_tasks_list', 'bakin_exec_tasks_create',
    ])
    expect(refs(turns)).toEqual([project, task])
  })

  it('text between tool calls keeps each card at its own position', () => {
    const turns = foldConversation([
      user,
      toolRow('bakin_exec_projects_create', [project], 2),
      { kind: 'assistant', ts: ts(3), turnId: 'turn-1', content: 'Project is up. Adding the first task.' },
      toolRow('bakin_exec_tasks_create', [task], 4),
    ])
    expect(items(turns).map((item) => item.type)).toEqual(['activity', 'entities', 'text', 'activity', 'entities'])
  })

  it('one card per thing per reply: created beats updated, repeats collapse', () => {
    const turns = foldConversation([
      user,
      toolRow('bakin_exec_tasks_update', [{ ...task, action: 'updated', title: 'Write brief' }], 2),
      toolRow('bakin_exec_tasks_create', [task], 3),
      toolRow('bakin_exec_tasks_update', [{ ...task, action: 'updated', title: 'Later title' }], 4),
    ])
    expect(refs(turns)).toEqual([task])
  })

  it('the same thing in a later reply gets its own card', () => {
    const turns = foldConversation([
      user,
      toolRow('bakin_exec_tasks_create', [task], 2),
      { kind: 'user', ts: ts(3), content: 'rename it' },
      { kind: 'tool', ts: ts(4), turnId: 'turn-2', toolName: 'bakin_exec_tasks_update', status: 'completed', metadata: { bakinEntities: [{ ...task, action: 'updated' }] } },
    ])
    expect(refs(turns).map((ref) => ref.action)).toEqual(['created', 'updated'])
  })

  it('an asset already shown inline as an image gets no extra card', () => {
    const asset: ConversationEntityRef = { kind: 'assets:asset', id: '20261114-logo', title: 'Logo', action: 'created' }
    const other: ConversationEntityRef = { kind: 'assets:asset', id: '20261114-logo-2', title: 'Logo 2', action: 'created' }
    const turns = foldConversation([
      user,
      toolRow('bakin_exec_images_generate', [asset, other], 2),
      { kind: 'assistant', ts: ts(3), turnId: 'turn-1', content: 'Here it is:\n\n![Logo](/api/assets/20261114-logo/thumb)' },
    ])
    expect(refs(turns)).toEqual([other])
  })

  it('malformed references are ignored, and a row with none adds no item', () => {
    const turns = foldConversation([
      user,
      toolRow('bakin_exec_projects_create', [
        { ...project, action: 'deleted' },
        { ...project, title: '' },
        { kind: 'project', id: 'p-1', title: 'x', action: 'created' },
        { ...project, params: { brandId: 7 } },
        'projects:project',
      ], 2),
      toolRow('bakin_exec_projects_update', 'not-an-array', 3),
    ])
    expect(items(turns).map((item) => item.type)).toEqual(['activity'])
  })

  it('live chunks fold the same way as persisted rows', () => {
    const liveChunks: RuntimeChatChunk[] = [
      { type: 'tool', content: '', data: { phase: 'call', callId: 'c1', toolName: 'bakin_exec_projects_create', status: 'running' } },
      { type: 'tool', content: '', data: { phase: 'result', callId: 'c1', toolName: 'bakin_exec_projects_create', status: 'completed', metadata: { bakinEntities: [project] } } },
    ]
    const turns = foldConversation([user], { liveChunks })
    expect(items(turns).map((item) => item.type)).toEqual(['activity', 'entities'])
    expect(refs(turns)).toEqual([project])
  })
})
