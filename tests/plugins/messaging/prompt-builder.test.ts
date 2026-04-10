/**
 * Prompt builder tests — verifies system prompt construction,
 * persona loading, plan state inclusion, and messages array format.
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
import type { PlanningSession } from '../../../plugins/messaging/types'

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
  it('includes agent name and planning instructions', () => {
    const prompt = buildSystemPrompt('basil', makeSession(), testDir)
    expect(prompt).toContain('You are Basil')
    expect(prompt).toContain('Planning Instructions')
    expect(prompt).toContain('Revision Rules')
  })

  it('includes persona when file exists', () => {
    const personaDir = join(testDir, 'team', 'personas')
    mkdirSync(personaDir, { recursive: true })
    writeFileSync(join(personaDir, 'basil.md'), '# Basil\nA chef who loves fresh ingredients.')

    const prompt = buildSystemPrompt('basil', makeSession(), testDir)
    expect(prompt).toContain('Your Persona')
    expect(prompt).toContain('fresh ingredients')
  })

  it('omits persona section when file is missing', () => {
    const prompt = buildSystemPrompt('scout', makeSession({ agentId: 'scout' }), testDir)
    expect(prompt).not.toContain('Your Persona')
    expect(prompt).toContain('Scout (Connor)')
  })

  it('includes plan state with proposal statuses', () => {
    const session = makeSession({
      proposals: [
        {
          id: 'p1', messageId: 'm1', revision: 1, agentId: 'basil',
          title: 'Monday Recipe', scheduledAt: '2026-04-13T10:00:00Z',
          contentType: 'recipe', tone: 'energetic', brief: 'Pasta',
          status: 'approved',
        },
        {
          id: 'p2', messageId: 'm1', revision: 1, agentId: 'basil',
          title: 'Wednesday Tip', scheduledAt: '2026-04-15T10:00:00Z',
          contentType: 'tip', tone: 'calm', brief: 'Knife care',
          status: 'rejected', rejectionNote: 'Too similar to last week',
        },
      ],
    })

    const prompt = buildSystemPrompt('basil', session, testDir)
    expect(prompt).toContain('Current Plan State')
    expect(prompt).toContain('[APPROVED]')
    expect(prompt).toContain('[REJECTED]')
    expect(prompt).toContain('Monday Recipe')
    expect(prompt).toContain('Too similar to last week')
    expect(prompt).toContain('1 approved, 1 rejected, 0 pending')
  })

  it('omits plan state when no proposals exist', () => {
    const prompt = buildSystemPrompt('basil', makeSession(), testDir)
    expect(prompt).not.toContain('Current Plan State')
  })

  it('handles unknown agent gracefully', () => {
    const prompt = buildSystemPrompt('unknown-agent', makeSession({ agentId: 'unknown-agent' }), testDir)
    expect(prompt).toContain('You are unknown-agent')
  })
})

describe('buildMessages', () => {
  it('returns system + new user message for empty session', () => {
    const messages = buildMessages(makeSession(), 'Plan next week')
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

    const messages = buildMessages(session, 'Now plan Tuesday')
    expect(messages.length).toBe(4) // system + 2 history + new user
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
          contentType: 'recipe', tone: 'energetic', brief: 'Test',
          status: 'proposed',
        },
      ],
    })

    const messages = buildMessages(session, 'What do you think?')
    expect(messages[0].content).toContain('Current Plan State')
    expect(messages[0].content).toContain('Test Item')
  })
})
