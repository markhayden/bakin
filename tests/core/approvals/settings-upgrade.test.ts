/**
 * One-shot approvals settings upgrade (spec D8, plan review R5b): workflows
 * plugin approval keys → settings.approvals; doctor.escalation string →
 * boolean. Idempotent, crash-resumable, fails closed on an unreadable source.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-approvals-settings-upgrade-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, pluginSettings: join(testDir, 'plugin-settings'), settings: join(testDir, 'settings.json') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { upgradeApprovalSettings } from '../../../src/core/approvals/settings-upgrade'
import { getSettings, resetSettingsCache } from '../../../src/core/settings'
import { pluginSettingsPath } from '../../../packages/core/src/plugins/settings-store'

const settingsFile = () => join(testDir, 'settings.json')
const workflowsFile = () => pluginSettingsPath('workflows')
const backupFile = () => `${workflowsFile()}.pre-approvals.bak`

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  resetSettingsCache()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  resetSettingsCache()
})

describe('upgradeApprovalSettings', () => {
  it('is a noop with no source keys and no legacy escalation string, and writes nothing', () => {
    writeJson(workflowsFile(), { gateTimeout: 24 })
    writeJson(settingsFile(), { doctor: { sensitivity: 'quiet' } })
    expect(upgradeApprovalSettings()).toEqual({ status: 'noop' })
    expect(existsSync(backupFile())).toBe(false)
    expect(readJson(settingsFile())).toEqual({ doctor: { sensitivity: 'quiet' } })
    expect(getSettings().approvals).toEqual({ channelAlerts: false, channel: 'general', requireRejectReason: true })
    expect(getSettings().doctor.escalation).toBe(true)
  })

  it('moves the four workflows keys into settings.approvals, backs the source up once, and strips it', () => {
    writeJson(workflowsFile(), { gateTimeout: 24, notifyOnGate: true, approvalChannelAlerts: true, approvalChannel: 'discord:ops', requireRejectReason: false })
    expect(upgradeApprovalSettings()).toEqual({ status: 'upgraded', movedApprovals: true, rewroteEscalation: false })

    expect(readJson(settingsFile()).approvals).toEqual({ channelAlerts: true, channel: 'discord:ops', requireRejectReason: false })
    expect(readJson(workflowsFile())).toEqual({ gateTimeout: 24 }) // notifyOnGate dropped, not moved
    expect(readJson(backupFile())).toMatchObject({ approvalChannel: 'discord:ops', notifyOnGate: true })
    expect(getSettings().approvals.channel).toBe('discord:ops')

    // Second run: nothing left to do, backup untouched.
    const backupBefore = readFileSync(backupFile(), 'utf-8')
    expect(upgradeApprovalSettings()).toEqual({ status: 'noop' })
    expect(readFileSync(backupFile(), 'utf-8')).toBe(backupBefore)
  })

  it.each([
    ['off', false],
    ['notify', true],
    ['task', true],
  ])('rewrites doctor.escalation %p to %p', (legacy, expected) => {
    writeJson(settingsFile(), { doctor: { escalation: legacy, sensitivity: 'standard' } })
    expect(upgradeApprovalSettings()).toEqual({ status: 'upgraded', movedApprovals: false, rewroteEscalation: true })
    expect((readJson(settingsFile()).doctor as Record<string, unknown>).escalation).toBe(expected)
    expect(getSettings().doctor.escalation).toBe(expected)
    expect(upgradeApprovalSettings()).toEqual({ status: 'noop' })
  })

  it('coerces a legacy string on load even before the upgrade has run', () => {
    writeJson(settingsFile(), { doctor: { escalation: 'off' } })
    expect(getSettings().doctor.escalation).toBe(false)
    resetSettingsCache()
    writeJson(settingsFile(), { doctor: { escalation: 'notify' } })
    expect(getSettings().doctor.escalation).toBe(true)
  })

  it('resumes an interrupted run: destination present, source keys still there → strip only, destination wins', () => {
    writeJson(settingsFile(), { approvals: { channelAlerts: false, channel: 'already-moved', requireRejectReason: true } })
    writeJson(workflowsFile(), { approvalChannelAlerts: true, approvalChannel: 'discord:ops' })
    writeJson(backupFile(), { approvalChannelAlerts: true, approvalChannel: 'discord:ops' })

    expect(upgradeApprovalSettings()).toEqual({ status: 'resumed' })
    expect(readJson(settingsFile()).approvals).toEqual({ channelAlerts: false, channel: 'already-moved', requireRejectReason: true })
    expect(readJson(workflowsFile())).toEqual({})
  })

  it('is blocked by an unreadable workflows.json and writes nothing', () => {
    mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
    writeFileSync(workflowsFile(), '{ not json')
    writeJson(settingsFile(), { doctor: { escalation: 'off' } })
    const result = upgradeApprovalSettings()
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') expect(result.reason).toContain('workflows.json')
    expect(existsSync(backupFile())).toBe(false)
    expect(readJson(settingsFile())).toEqual({ doctor: { escalation: 'off' } })
  })
})
