/**
 * The redirect decision for an open chat whose reply was handed off.
 *
 * Pure function over the event payload and the browser entity registry
 * (seeded with the core kinds by the test preload).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-chat-handoff-redirect-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { handoffRedirect } from '../../../plugins/chat/components/handoff-redirect'
import { getEntityDeclaration, setEntityDeclarations } from '@makinbakin/sdk/internal'

const project = { entity: 'projects:project', id: 'p-1', title: 'Launch plan' }
const session = { entity: 'messaging:session', id: 's-1', title: 'Launch posts' }
const core = ['tasks:task', 'chat:chat'].map((id) => getEntityDeclaration(id)!)

beforeAll(() => setEntityDeclarations([
  ...core,
  { kind: 'project', label: 'Project', icon: 'FolderKanban', href: '/projects/{id}', handoff: true, pluginId: 'projects', id: 'projects:project' },
  { kind: 'session', label: 'Brainstorm', icon: 'Lightbulb', href: '/messaging/brainstorm?session={id}', handoff: true, pluginId: 'messaging', id: 'messaging:session' },
]))
afterAll(() => setEntityDeclarations(core))

describe('handoffRedirect', () => {
  test('one created target that took the history, for the chat on screen: go there', () => {
    expect(handoffRedirect({ chatId: 'c-1', created: 1, targets: [project] }, 'c-1')).toBe('/projects/p-1')
    expect(handoffRedirect({ chatId: 'c-1', created: 1, targets: [session] }, 'c-1')).toBe('/messaging/brainstorm?session=s-1')
  })

  test('another chat is on screen, or none: stay', () => {
    expect(handoffRedirect({ chatId: 'c-1', created: 1, targets: [project] }, 'c-2')).toBeNull()
    expect(handoffRedirect({ chatId: 'c-1', created: 1, targets: [project] }, null)).toBeNull()
    expect(handoffRedirect({ chatId: 'c-1', created: 1, targets: [project] }, '')).toBeNull()
  })

  test('two created: stay, whether both, one or neither took the history', () => {
    expect(handoffRedirect({ chatId: 'c-1', created: 2, targets: [project, session] }, 'c-1')).toBeNull()
    expect(handoffRedirect({ chatId: 'c-1', created: 2, targets: [project] }, 'c-1')).toBeNull()
    expect(handoffRedirect({ chatId: 'c-1', created: 2, targets: [] }, 'c-1')).toBeNull()
  })

  test('the one target refused: stay', () => {
    expect(handoffRedirect({ chatId: 'c-1', created: 1, targets: [] }, 'c-1')).toBeNull()
  })

  test('a kind no loaded plugin declares, or a malformed event: stay', () => {
    expect(handoffRedirect({ chatId: 'c-1', created: 1, targets: [{ entity: 'gone:thing', id: 'x', title: 'X' }] }, 'c-1')).toBeNull()
    expect(handoffRedirect({ chatId: 'c-1', created: 1, targets: [{ id: 'x' }] }, 'c-1')).toBeNull()
    expect(handoffRedirect({}, 'c-1')).toBeNull()
  })
})
