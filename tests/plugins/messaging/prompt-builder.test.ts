/**
 * Prompt builder tests — verifies system prompt construction,
 * persona loading, plan state inclusion, and messages array format.
 *
 * Agent identity and content-type taxonomy come from the caller via
 * PromptBuilderOptions; the builder stays neutral.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const testDir = vi.hoisted(() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-prompt-${Date.now()}`)
})

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ messaging: testDir }),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}))

import { buildSystemPrompt, buildMessages } from '../../../plugins/messaging/lib/prompt-builder'
import type { PlanningSession, ContentTypeOption } from '../../../plugins/messaging/types'

const DEFAULT_TYPES: ContentTypeOption[] = [
  { id: 'post',    label: 'Post' },
  { id: 'article', label: 'Article' },
  { id: 'video',   label: 'Video' },
]

function opts(overrides: { agentName?: string; contentTypes?: ContentTypeOption[] } = {}) {
  return {
    contentDir: testDir,
    contentTypes: overrides.contentTypes ?? DEFAULT_TYPES,
    agentName: overrides.agentName,
  }
}

function makeSession(overrides: Partial<PlanningSession> = {}): PlanningSession {
  return {
    id: 'sess-1',
    agentId: 'basil',
    title: 'Test Session',
    status: 'active',
    createdAt: '2026-04-07T00:00:00Z',
    updatedAt: '2026-04-07T00:00:00Z',
    messages: [],
    proposals: [],
    ...overrides,
  }
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('buildSystemPrompt', () => {
  it('uses the agentName from options when provided', () => {
    const prompt = buildSystemPrompt('basil', makeSession(), opts({ agentName: 'Basil (Chef)' }))
    expect(prompt).toContain('You are Basil (Chef)')
    expect(prompt).toContain('Planning Instructions')
    expect(prompt).toContain('Revising Existing Proposals')
  })

  it('falls back to agentId when agentName is missing (orphaned reference)', () => {
    const prompt = buildSystemPrompt('ghost', makeSession({ agentId: 'ghost' }), opts())
    expect(prompt).toContain('You are ghost')
  })

  it('lists caller-supplied content types in the instructions', () => {
    const prompt = buildSystemPrompt('x', makeSession(), opts({
      contentTypes: [{ id: 'blog', label: 'Blog' }, { id: 'reel', label: 'Reel' }],
    }))
    expect(prompt).toContain('contentType: one of blog, reel')
  })

  it('falls back to a neutral placeholder when contentTypes is empty', () => {
    const prompt = buildSystemPrompt('x', makeSession(), opts({ contentTypes: [] }))
    expect(prompt).toContain('contentType: one of a content type id of your choosing')
  })

  it('includes persona when file exists', () => {
    const personaDir = join(testDir, 'team', 'personas')
    mkdirSync(personaDir, { recursive: true })
    writeFileSync(join(personaDir, 'basil.md'), '# Basil\nA chef who loves fresh ingredients.')

    const prompt = buildSystemPrompt('basil', makeSession(), opts({ agentName: 'Basil' }))
    expect(prompt).toContain('Your Persona')
    expect(prompt).toContain('fresh ingredients')
  })

  it('omits persona section when file is missing', () => {
    const prompt = buildSystemPrompt('scout', makeSession({ agentId: 'scout' }), opts({ agentName: 'Scout' }))
    expect(prompt).not.toContain('Your Persona')
    expect(prompt).toContain('You are Scout')
  })

  it('includes plan state with proposal statuses', () => {
    const session = makeSession({
      proposals: [
        {
          id: 'p1', messageId: 'm1', revision: 1, agentId: 'basil',
          title: 'Monday Post', scheduledAt: '2026-04-13T10:00:00Z',
          contentType: 'post', tone: 'energetic', brief: 'Intro',
          status: 'approved',
        },
        {
          id: 'p2', messageId: 'm1', revision: 1, agentId: 'basil',
          title: 'Wednesday Article', scheduledAt: '2026-04-15T10:00:00Z',
          contentType: 'article', tone: 'calm', brief: 'Deep dive',
          status: 'rejected', rejectionNote: 'Too similar to last week',
        },
      ],
    })

    const prompt = buildSystemPrompt('basil', session, opts({ agentName: 'Basil' }))
    expect(prompt).toContain('Current Plan State')
    expect(prompt).toContain('[APPROVED]')
    expect(prompt).toContain('[REJECTED]')
    expect(prompt).toContain('Monday Post')
    expect(prompt).toContain('Too similar to last week')
    expect(prompt).toContain('1 approved, 1 rejected, 0 pending')
  })

  it('omits plan state when no proposals exist', () => {
    const prompt = buildSystemPrompt('basil', makeSession(), opts({ agentName: 'Basil' }))
    expect(prompt).not.toContain('## Current Plan State')
  })
})

describe('buildMessages', () => {
  it('returns system + new user message for empty session', () => {
    const messages = buildMessages(makeSession(), 'Plan next week', opts())
    expect(messages.length).toBe(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toBe('Plan next week')
  })

  it('includes session history as individual messages', () => {
    const session = makeSession({
      messages: [
        { id: 'm1', role: 'user', content: 'Plan Monday', timestamp: '2026-04-07T01:00:00Z' },
        { id: 'm2', role: 'assistant', content: 'Here are ideas...', timestamp: '2026-04-07T01:01:00Z' },
      ],
    })

    const messages = buildMessages(session, 'Now plan Tuesday', opts())
    expect(messages.length).toBe(4)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toBe('Plan Monday')
    expect(messages[2].role).toBe('assistant')
    expect(messages[2].content).toBe('Here are ideas...')
    expect(messages[3].role).toBe('user')
    expect(messages[3].content).toBe('Now plan Tuesday')
  })

  it('includes plan state in system prompt when proposals exist', () => {
    const session = makeSession({
      proposals: [
        {
          id: 'p1', messageId: 'm1', revision: 1, agentId: 'basil',
          title: 'Test Item', scheduledAt: '2026-04-13T10:00:00Z',
          contentType: 'post', tone: 'energetic', brief: 'Test',
          status: 'proposed',
        },
      ],
    })

    const messages = buildMessages(session, 'What do you think?', opts())
    expect(messages[0].content).toContain('Current Plan State')
    expect(messages[0].content).toContain('Test Item')
  })
})
