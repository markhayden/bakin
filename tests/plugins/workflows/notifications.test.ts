import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Defensive mocks: notifications doesn't read content-dir or call flow-store,
// but enforce isolation rules across the suite.
vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => '/tmp/bakin-test-notifications',
  getBakinPaths: () => ({}),
}))

vi.mock('../../../plugins/tasks/lib/flow-store', () => ({
  createTask: vi.fn(() => Promise.resolve({ id: 'mock' })),
  addTaskLog: vi.fn(() => Promise.resolve()),
  moveTask: vi.fn(() => Promise.resolve()),
  readTaskboard: vi.fn(() => ({ columns: {} })),
  getTask: vi.fn(() => null),
}))

// Mock post-discord config and channel resolution
vi.mock('../../../scripts/lib/post-discord', () => ({
  loadDiscordConfig: vi.fn(() => ({
    botToken: 'test-bot-token',
    guildId: 'test-guild-id',
  })),
  resolveChannelId: vi.fn(() => Promise.resolve({ id: 'ch-123', available: ['general', 'approvals'] })),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  sendDiscordGateAlert,
  editDiscordGateMessage,
  setDiscordGateSettings,
  type DiscordGateSettings,
} from '@bakin/workflows/lib/notifications'
import { loadDiscordConfig, resolveChannelId } from '../../../scripts/lib/post-discord'
import type { WorkflowInstance } from '@bakin/workflows/types'

describe('Discord gate notifications', () => {
  const mockInstance: WorkflowInstance = {
    instanceId: 'wf_abc123',
    workflowId: 'content-pipeline',
    taskId: 'task-42',
    currentStepId: 'review-gate',
    status: 'pending_approval',
    stepStates: {},
    history: [],
    createdAt: '2026-04-11T10:00:00Z',
    updatedAt: '2026-04-11T10:00:00Z',
  }

  const enabledSettings: DiscordGateSettings = {
    discordGateAlerts: true,
    discordGateChannel: 'approvals',
    requireRejectReason: true,
  }

  beforeEach(() => {
    mockFetch.mockReset()
    vi.mocked(loadDiscordConfig).mockReturnValue({ botToken: 'test-bot-token', guildId: 'test-guild-id' })
    vi.mocked(resolveChannelId).mockResolvedValue({ id: 'ch-123', available: ['general', 'approvals'] })
  })

  describe('sendDiscordGateAlert', () => {
    it('sends message with embed and buttons when enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'msg-789' }),
      })

      const result = await sendDiscordGateAlert(
        mockInstance,
        'review-gate',
        'Review Draft',
        { 'draft-step': { caption: 'Hello world' } },
        enabledSettings,
      )

      expect(result).toBe('msg-789')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toBe('https://discord.com/api/v10/channels/ch-123/messages')
      expect(opts.method).toBe('POST')
      expect(opts.headers.Authorization).toBe('Bot test-bot-token')

      const body = JSON.parse(opts.body)
      expect(body.embeds).toHaveLength(1)
      expect(body.embeds[0].title).toBe('Gate: Review Draft')
      expect(body.embeds[0].color).toBe(16776960) // Yellow

      // Verify buttons
      expect(body.components).toHaveLength(1)
      const buttons = body.components[0].components
      expect(buttons).toHaveLength(2)
      expect(buttons[0].label).toBe('Approve')
      expect(buttons[0].custom_id).toBe('gate:approve:task-42:review-gate')
      expect(buttons[0].style).toBe(3) // Green
      expect(buttons[1].label).toBe('Reject')
      expect(buttons[1].custom_id).toBe('gate:reject:task-42:review-gate')
      expect(buttons[1].style).toBe(4) // Red
    })

    it('returns null when alerts are disabled', async () => {
      const result = await sendDiscordGateAlert(
        mockInstance,
        'review-gate',
        'Review Draft',
        undefined,
        { ...enabledSettings, discordGateAlerts: false },
      )

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns null when Discord is not configured', async () => {
      vi.mocked(loadDiscordConfig).mockReturnValue(null)

      const result = await sendDiscordGateAlert(
        mockInstance,
        'review-gate',
        'Review Draft',
        undefined,
        enabledSettings,
      )

      expect(result).toBeNull()
    })

    it('returns null when channel not found', async () => {
      vi.mocked(resolveChannelId).mockResolvedValue({ id: null, available: ['general'] })

      const result = await sendDiscordGateAlert(
        mockInstance,
        'review-gate',
        'Review Draft',
        undefined,
        enabledSettings,
      )

      expect(result).toBeNull()
    })

    it('includes prior output in embed fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'msg-001' }),
      })

      await sendDiscordGateAlert(
        mockInstance,
        'review-gate',
        'Review Draft',
        { 'generate-step': 'A very long caption about the generated content' },
        enabledSettings,
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      const priorField = body.embeds[0].fields.find((f: { name: string }) => f.name === 'Prior Output')
      expect(priorField).toBeDefined()
      expect(priorField.value).toContain('generate-step')
    })

    it('handles API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Missing permissions'),
      })

      const result = await sendDiscordGateAlert(
        mockInstance,
        'review-gate',
        'Review Draft',
        undefined,
        enabledSettings,
      )

      expect(result).toBeNull()
    })
  })

  describe('editDiscordGateMessage', () => {
    const approver: import('@bakin/core/plugin-types').ApprovalActor = {
      source: 'discord',
      id: '111',
      displayName: 'Mark',
    }
    const decidedAt = '2026-04-13T12:34:56Z'

    it('GET-preserves original embed fields and appends Decision + Decided by', async () => {
      // First fetch: GET returns the existing message with original fields
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          embeds: [{
            title: 'Gate: Review Draft',
            description: 'Workflow content-pipeline has reached a gate.',
            color: 16776960,
            fields: [
              { name: 'Task', value: 'task-42', inline: true },
              { name: 'Step', value: 'review-gate', inline: true },
              { name: 'Prior Output', value: '**caption:** Hello' },
            ],
          }],
        }),
      })
      // Second fetch: PATCH succeeds
      mockFetch.mockResolvedValueOnce({ ok: true })

      await editDiscordGateMessage('approvals', 'msg-789', 'approved', approver, decidedAt)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      const [getUrl, getOpts] = mockFetch.mock.calls[0]
      expect(getUrl).toBe('https://discord.com/api/v10/channels/ch-123/messages/msg-789')
      expect(getOpts.method ?? 'GET').toBe('GET')

      const [patchUrl, patchOpts] = mockFetch.mock.calls[1]
      expect(patchUrl).toBe('https://discord.com/api/v10/channels/ch-123/messages/msg-789')
      expect(patchOpts.method).toBe('PATCH')

      const body = JSON.parse(patchOpts.body)
      const embed = body.embeds[0]
      expect(embed.title).toBe('Gate: Review Draft') // preserved
      expect(embed.color).toBe(5763719) // updated to green
      const fieldNames = embed.fields.map((f: { name: string }) => f.name)
      expect(fieldNames).toContain('Task')
      expect(fieldNames).toContain('Step')
      expect(fieldNames).toContain('Prior Output')
      expect(fieldNames).toContain('Decision')
      expect(fieldNames).toContain('Decided by')

      const decisionField = embed.fields.find((f: { name: string }) => f.name === 'Decision')
      expect(decisionField.value).toBe('Approved')
      const byField = embed.fields.find((f: { name: string }) => f.name === 'Decided by')
      expect(byField.value).toContain('Mark')
      expect(byField.value).toContain('discord')

      expect(body.components).toEqual([])
    })

    it('uses red color and includes Reason field on reject', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ embeds: [{ title: 'Gate: Review Draft', fields: [] }] }),
      })
      mockFetch.mockResolvedValueOnce({ ok: true })

      await editDiscordGateMessage('approvals', 'msg-789', 'rejected', approver, decidedAt, 'Off-brand colors')

      const body = JSON.parse(mockFetch.mock.calls[1][1].body)
      const embed = body.embeds[0]
      expect(embed.color).toBe(15548997) // Red
      const fieldNames = embed.fields.map((f: { name: string }) => f.name)
      expect(fieldNames).toContain('Decision')
      expect(fieldNames).toContain('Reason')
      const reasonField = embed.fields.find((f: { name: string }) => f.name === 'Reason')
      expect(reasonField.value).toBe('Off-brand colors')
    })

    it('falls back to stripped embed when GET fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: () => Promise.resolve('Missing perms') })
      mockFetch.mockResolvedValueOnce({ ok: true })

      await editDiscordGateMessage('approvals', 'msg-789', 'approved', approver, decidedAt)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      const body = JSON.parse(mockFetch.mock.calls[1][1].body)
      const embed = body.embeds[0]
      // Fallback shape: still updates color and shows decision in title/description
      expect(embed.color).toBe(5763719)
      expect(embed.title).toContain('Gate Approved')
      expect(body.components).toEqual([])
    })

    it('skips edit when Discord is not configured', async () => {
      vi.mocked(loadDiscordConfig).mockReturnValue(null)

      await editDiscordGateMessage('approvals', 'msg-789', 'approved', approver, decidedAt)

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
