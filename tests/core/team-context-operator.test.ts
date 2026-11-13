/** What agents call the person they work with: one block in global context, everything else untouched. */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-operator-context-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { effectiveContextContent, getGlobalContextPath, getOperatorName, setOperatorName } from '../../src/core/team-context'

const read = () => readFileSync(getGlobalContextPath(), 'utf-8')
beforeEach(() => rmSync(testDir, { recursive: true, force: true }))
afterAll(() => { delete process.env.BAKIN_HOME; rmSync(testDir, { recursive: true, force: true }) })

describe('setOperatorName', () => {
  it('creates global context when there is none, and agents are told the name', () => {
    expect(getOperatorName()).toBeNull()
    expect(setOperatorName('Mark')).toBe(true)
    expect(effectiveContextContent(read())).toContain('You work with Mark. Call them Mark.')
    expect(getOperatorName()).toBe('Mark')
  })

  it('keeps everything the person wrote, byte for byte, and replaces only its own block', () => {
    mkdirSync(dirname(getGlobalContextPath()), { recursive: true })
    const own = '# House rules\n\nAlways cite sources.\n'
    writeFileSync(getGlobalContextPath(), own)
    setOperatorName('Mark')
    expect(read()).toStartWith(own)
    setOperatorName('Margo')
    expect(read()).toStartWith(own)
    expect(read()).not.toContain('Mark')
    expect(getOperatorName()).toBe('Margo')
  })

  it('writing the same name twice changes nothing', () => {
    setOperatorName('Mark')
    const before = read()
    expect(setOperatorName('  Mark ')).toBe(false)
    expect(read()).toBe(before)
  })

  it('refuses an empty name', () => {
    expect(() => setOperatorName('   ')).toThrow()
  })
})
