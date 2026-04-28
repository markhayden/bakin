/**
 * Regression guards for orphaned messaging refs.
 *
 * After the refactor, types.ts widens ContentAgent / ContentType to plain
 * string. Calendar items with frontmatter referencing a removed agent id
 * (e.g. an agent that was deleted from OpenClaw) or a removed content-type
 * id (a user-deleted category) must still parse, render, and degrade
 * gracefully — never crash.
 */
// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ContentTypeOption } from '../../../plugins/messaging/types'

const testDir = join(tmpdir(), `bakin-test-orphan-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/watcher', () => ({ watchFiles: mock() }))
// Team store returns an empty roster — any agent id is therefore orphaned.
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgent: (id: string) => (id === 'known' ? { id: 'known', name: 'Known', emoji: '✅', role: '', headshot: '' } : undefined),
  useAgentList: () => [{ id: 'known', name: 'Known', emoji: '✅', role: '', headshot: '' }],
  useAgentIds: () => ['known'],
  useAgentColor: () => '#a1a1aa',
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ agents: [{ id: 'known', name: 'Known', emoji: '✅', role: '', headshot: '' }] }),
}))

import {
  getContentTypeLabel,
  __resetContentTypesCache,
} from '../../../plugins/messaging/hooks/use-content-types'
import { buildSystemPrompt } from '../../../plugins/messaging/lib/prompt-builder'
import type { PlanningSession } from '../../../plugins/messaging/types'

afterEach(() => {
  cleanup()
  __resetContentTypesCache()
})

function makeSession(overrides: Partial<PlanningSession> = {}): PlanningSession {
  return {
    id: 'sess-1',
    agentId: 'orphaned-agent',
    title: 'Orphan Session',
    status: 'active',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z',
    messages: [],
    proposals: [],
    ...overrides,
  }
}

describe('orphaned references — content types', () => {
  it('getContentTypeLabel returns the raw id when the type is not configured', () => {
    const types: ContentTypeOption[] = [{ id: 'post', label: 'Post' }]
    expect(getContentTypeLabel('post', types)).toBe('Post')
    expect(getContentTypeLabel('legacy-recipe', types)).toBe('legacy-recipe')
  })

  it('getContentTypeLabel handles an empty taxonomy without crashing', () => {
    expect(getContentTypeLabel('anything', [])).toBe('anything')
  })
})

describe('orphaned references — agents in prompt builder', () => {
  it('falls back to the agent id when agentName is not supplied (caller handed in nothing)', () => {
    const prompt = buildSystemPrompt(
      'orphaned-agent',
      makeSession({ agentId: 'orphaned-agent' }),
      { contentTypes: [{ id: 'post', label: 'Post' }], persona: '' },
    )
    // Identity line uses the raw id when name unknown — never throws.
    expect(prompt).toContain('You are orphaned-agent')
    expect(prompt).not.toContain('undefined')
  })

  it('handles an empty content-type taxonomy in the prompt instruction', () => {
    const prompt = buildSystemPrompt(
      'x',
      makeSession({ agentId: 'x' }),
      { contentTypes: [], persona: '' },
    )
    expect(prompt).toContain('contentType: one of a content type id of your choosing')
  })
})
