/**
 * readRuntimeAdapterStrict (#898 D-H5): the CLI's agent-context check must
 * know which runtime this home uses — a bad settings.json throws instead of
 * silently defaulting to another runtime.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-adapter-strict-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const info = mock(() => {})
mock.module('../../packages/core/src/logger', () => ({ createLogger: () => ({ info, warn: mock(), error: mock(), debug: mock() }) }))

import { readRuntimeAdapterStrict } from '../../packages/core/src/settings'

const settingsPath = join(testDir, 'settings.json')
const savedEnv = process.env.BAKIN_RUNTIME_ADAPTER
beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  delete process.env.BAKIN_RUNTIME_ADAPTER
})
afterEach(() => {
  if (savedEnv === undefined) delete process.env.BAKIN_RUNTIME_ADAPTER
  else process.env.BAKIN_RUNTIME_ADAPTER = savedEnv
})
afterAll(() => {
  chmodSync(testDir, 0o755)
  rmSync(testDir, { recursive: true, force: true })
})

describe('readRuntimeAdapterStrict', () => {
  it('a missing file is the default; a named adapter is used; the env override wins', () => {
    expect(readRuntimeAdapterStrict()).toBe('openclaw')
    writeFileSync(settingsPath, JSON.stringify({ runtime: { adapter: 'pi' } }))
    expect(readRuntimeAdapterStrict()).toBe('pi')
    process.env.BAKIN_RUNTIME_ADAPTER = 'openclaw'
    expect(readRuntimeAdapterStrict()).toBe('openclaw')
    expect(info).not.toHaveBeenCalled()
  })

  it('unparseable, unreadable, or naming an unknown runtime throws — never a silent default', () => {
    writeFileSync(settingsPath, '{ nope')
    expect(() => readRuntimeAdapterStrict()).toThrow()
    writeFileSync(settingsPath, JSON.stringify({ runtime: { adapter: 'mystery' } }))
    expect(() => readRuntimeAdapterStrict()).toThrow('unknown runtime')
    process.env.BAKIN_RUNTIME_ADAPTER = 'mystery'
    expect(() => readRuntimeAdapterStrict()).toThrow('not a known runtime')
    delete process.env.BAKIN_RUNTIME_ADAPTER
    writeFileSync(settingsPath, JSON.stringify({ runtime: { adapter: 'pi' } }))
    chmodSync(testDir, 0o000)
    try {
      expect(() => readRuntimeAdapterStrict()).toThrow('could not be read')
    } finally {
      chmodSync(testDir, 0o755)
    }
  })
})
