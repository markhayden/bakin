/**
 * Tests for the in-binary user plugin builder (#147 TE14).
 *
 * Copies tests/fixtures/sample-user-plugin/ into an isolated temp dir,
 * invokes buildUserPlugin(), and asserts:
 *   1. dist/index.js + dist/client.js appear
 *   2. the outputs retain unresolved imports for the shell's externals
 *      (`react`, `react/jsx-runtime`, `@bakin/sdk/*`)
 *
 * Per CLAUDE.md testing rules, getContentDir is mocked to a temp dir so
 * nothing leaks into ~/.bakin/ even though buildUserPlugin operates on
 * explicit paths. Logger is mocked for noise suppression.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'fs'
import { join } from 'path'

const testDir = vi.hoisted(() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-plugin-build-${Date.now()}`)
})

vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { buildUserPlugin } from '../../packages/host/src/plugin-host/user-plugin-builder'

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'sample-user-plugin')
const targetDir = join(testDir, 'plugins', 'sample')

beforeAll(() => {
  mkdirSync(targetDir, { recursive: true })
  cpSync(FIXTURE_DIR, targetDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('buildUserPlugin', () => {
  it('produces dist/index.js and dist/client.js', async () => {
    await buildUserPlugin(targetDir)
    expect(existsSync(join(targetDir, 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(targetDir, 'dist', 'client.js'))).toBe(true)
  }, 60_000)

  it('preserves externals for @bakin/sdk/* in client.js', () => {
    const client = readFileSync(join(targetDir, 'dist', 'client.js'), 'utf-8')
    // The `@bakin/sdk/slots` import must survive so the runtime loader can
    // resolve it via the browser import map (not get bundled into client.js).
    expect(client).toMatch(/from\s+["']@bakin\/sdk\/slots["']/)
  }, 60_000)

  it('preserves externals for react + react/jsx-runtime in client.js', () => {
    const client = readFileSync(join(targetDir, 'dist', 'client.js'), 'utf-8')
    // React hooks must stay external — plugins share the shell's React via
    // the import map. Bundling react would break hooks dispatcher identity.
    expect(client).toMatch(/from\s+["']react["']/)
    // The JSX runtime must also stay external.
    expect(client).toMatch(/from\s+["']react\/jsx-runtime["']/)
  }, 60_000)

  it('does not bundle react into dist/client.js', () => {
    // A real-size React bundle is > 100 KB. If our externals list failed,
    // client.js would balloon. The fixture client is trivially small, so
    // the absence of React's internal sentinels confirms externals held.
    const client = readFileSync(join(targetDir, 'dist', 'client.js'), 'utf-8')
    expect(client).not.toMatch(/React\.createElement\s*=\s*function/)
    expect(client).not.toMatch(/__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/)
  }, 60_000)
})
