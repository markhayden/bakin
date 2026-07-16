/**
 * Chat route surface pins (routing overhaul PR2).
 *
 * /chat/new must win over /chat/$chatId for the literal path "new" — that
 * ranking (static segment > dynamic segment, independent of registration
 * order) is core TanStack behavior; unit tests here shim the router (see
 * tests/shims/tanstack-router.ts), so what we pin is OUR surface:
 *
 *   1. the three chat route modules carry the exact expected paths,
 *   2. they are wired into the host route tree (router.ts),
 *   3. each route renders the slot name the chat plugin registers.
 *
 * The /chat/new-vs-$chatId behavior itself is exercised in the PR's live
 * checklist and guarded implicitly by (1): with these literal paths,
 * TanStack's ranking is deterministic.
 */
import { describe, test, expect, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure surface pins — no storage — resolvers mocked per the isolation rule.
const testDir = join(tmpdir(), `bakin-test-chat-routes-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}))

import { Route as ChatRoute } from '../../packages/host/src/routes/chat'
import { Route as ChatNewRoute } from '../../packages/host/src/routes/chat.new'
import { Route as ChatDetailRoute } from '../../packages/host/src/routes/chat.$chatId'

const path = (r: unknown) => (r as { path?: string }).path

describe('chat route surface', () => {
  test('route modules carry the exact paths the taxonomy locked (spec D2)', () => {
    expect(path(ChatRoute)).toBe('/chat')
    expect(path(ChatNewRoute)).toBe('/chat/new')
    expect(path(ChatDetailRoute)).toBe('/chat/$chatId')
  })

  test('all three chat routes are wired into the host route tree', () => {
    const routerSrc = readFileSync(join(process.cwd(), 'packages/host/src/router.ts'), 'utf8')
    for (const mod of ['./routes/chat', './routes/chat.new', './routes/chat.$chatId']) {
      expect(routerSrc).toContain(`from '${mod}'`)
    }
    for (const name of ['ChatRoute', 'ChatNewRoute', 'ChatDetailRoute']) {
      // Present in the addChildren list, not just imported.
      expect(routerSrc).toMatch(new RegExp(`^\\s+${name},`, 'm'))
    }
  })

  test('route components render the slot names the chat plugin registers', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), 'packages/host/src/routes', f), 'utf8')
    expect(read('chat.tsx')).toContain('page:/chat"')
    expect(read('chat.new.tsx')).toContain('page:/chat/new')
    expect(read('chat.$chatId.tsx')).toContain('page:/chat/[chatId]')
    // The detail route must thread the path param into the slot.
    expect(read('chat.$chatId.tsx')).toContain('chatId={chatId}')
  })
})
