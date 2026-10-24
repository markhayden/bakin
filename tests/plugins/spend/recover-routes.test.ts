/**
 * spend.json recover routes (self-healing PR1 slice 1.4b; rows 40/161): the
 * file as it is on disk with its issues, a validated write, and the
 * move-aside reset — Bakin never overwrites the file on its own.
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-spend-recover-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { inspectSpendPolicyFile, resetSpendPolicyFile, writeSpendPolicyText } from '../../../plugins/spend/lib/recover'
import { spendSettingsFile } from '../../../plugins/spend/lib/settings'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(join(testDir, 'plugin-settings'), { recursive: true }) })

describe('spend.json recover engine', () => {
  it('reports absent / invalid JSON / invalid policy / ok, with the raw text and the issues named', () => {
    expect(inspectSpendPolicyFile()).toMatchObject({ status: 'absent', text: null, issues: [] })
    writeFileSync(spendSettingsFile(), '{ nope')
    const broken = inspectSpendPolicyFile()
    expect(broken.status).toBe('invalid')
    expect(broken.text).toBe('{ nope')
    expect(broken.issues[0]).toMatch(/not JSON/)
    writeFileSync(spendSettingsFile(), JSON.stringify({ limits: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 'ten' }] }, billing: { overrides: [] } }))
    const invalid = inspectSpendPolicyFile()
    expect(invalid.status).toBe('invalid')
    expect(invalid.issues.join(' ')).toMatch(/dailyCap/)
    writeFileSync(spendSettingsFile(), JSON.stringify({ limits: { rules: [] }, billing: { overrides: [] } }))
    expect(inspectSpendPolicyFile().status).toBe('ok')
  })
  it('a write lands only when the text is a valid policy; otherwise the issues come back and the file is untouched', () => {
    writeFileSync(spendSettingsFile(), '{ nope')
    expect(writeSpendPolicyText('{ still nope')).toMatchObject({ ok: false, issues: [expect.stringMatching(/not JSON/)] })
    expect(writeSpendPolicyText(JSON.stringify({ limits: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 'ten' }] }, billing: { overrides: [] } }))).toMatchObject({ ok: false })
    expect(readFileSync(spendSettingsFile(), 'utf-8')).toBe('{ nope')
    expect(writeSpendPolicyText(JSON.stringify({ limits: { rules: [{ id: 'g1', scope: 'global', lane: 'metered', dailyCap: 10 }] }, billing: { overrides: [] } }))).toEqual({ ok: true })
    expect(inspectSpendPolicyFile().status).toBe('ok')
    expect(JSON.parse(readFileSync(spendSettingsFile(), 'utf-8')).limits.rules[0].dailyCap).toBe(10)
  })
  it('reset moves the file to a dated .rejected copy and never deletes it; nothing to move is honest', () => {
    expect(resetSpendPolicyFile()).toEqual({ movedTo: null })
    writeFileSync(spendSettingsFile(), '{ nope')
    const { movedTo } = resetSpendPolicyFile()
    expect(movedTo).toMatch(/spend\.json\.rejected-/)
    expect(existsSync(spendSettingsFile())).toBe(false)
    expect(readFileSync(movedTo!, 'utf-8')).toBe('{ nope')
    expect(readdirSync(join(testDir, 'plugin-settings')).filter((f) => f.startsWith('spend.json.rejected-'))).toHaveLength(1)
    expect(inspectSpendPolicyFile().status).toBe('absent')
  })
})
