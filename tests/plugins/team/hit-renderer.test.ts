/**
 * Team ⌘K hit renderers.
 *
 * - Agents render under the `team` key — the registered table is `team`,
 *   and the overlay resolves renderers by bare table name. (A renderer
 *   keyed `agents` never matches and every agent hit falls to the
 *   null-href default.)
 * - Lessons read the schema's `agent_id`/`lesson_id` fields (NOT `agent`)
 *   and deep-link to the exact lesson on the Lessons tab.
 */
import { describe, it, expect, mock } from 'bun:test'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-team-hit-renderer',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import '../../../plugins/team/client'
import { getSearchHitRenderer } from '../../../packages/sdk/src/register'
import type { SearchResult } from '../../../packages/sdk/src/types/registration'

const hit = (id: string, table: string, fields: Record<string, unknown> = {}): SearchResult =>
  ({ id, table, score: 1, fields })

describe('team hit renderer', () => {
  it('registers under the bare table name `team`, not `agents`', () => {
    expect(getSearchHitRenderer('team')).toBeDefined()
    expect(getSearchHitRenderer('agents')).toBeUndefined()
  })

  it('agent hits deep-link to the agent page', () => {
    const d = getSearchHitRenderer('team')!(hit('patch', 'bakin_team', { name: 'Patch', role: 'fixer' }))
    expect(d.href).toBe('/team/patch')
    expect(d.title).toBe('Patch')
  })
})

describe('agent-lessons hit renderer', () => {
  it('reads agent_id/lesson_id and deep-links to the exact lesson', () => {
    const d = getSearchHitRenderer('agent-lessons')!(
      hit('pixel@0.1.0/style', 'bakin_agent-lessons', {
        title: 'Style guide',
        agent_id: 'pixel',
        lesson_id: 'style',
      }),
    )
    expect(d.href).toBe('/team/pixel?tab=lessons&lessonId=style')
    expect(d.title).toBe('Style guide')
    expect(d.subtitle).toContain('pixel')
  })

  it('URL-encodes agent and lesson ids', () => {
    const d = getSearchHitRenderer('agent-lessons')!(
      hit('x', 'bakin_agent-lessons', { title: 't', agent_id: 'a b', lesson_id: 'c&d' }),
    )
    expect(d.href).toBe(`/team/${encodeURIComponent('a b')}?tab=lessons&lessonId=${encodeURIComponent('c&d')}`)
  })

  it('falls back to the agent page when lesson_id is missing', () => {
    const d = getSearchHitRenderer('agent-lessons')!(
      hit('x', 'bakin_agent-lessons', { title: 't', agent_id: 'pixel' }),
    )
    expect(d.href).toBe('/team/pixel?tab=lessons')
  })

  it('href is null (inert) only when agent_id is genuinely absent', () => {
    const d = getSearchHitRenderer('agent-lessons')!(hit('x', 'bakin_agent-lessons', { title: 't' }))
    expect(d.href).toBeNull()
  })
})
