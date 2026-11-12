/**
 * readMcpCredential: the check-only twin of getMcpCredential. Same answer
 * when a secret exists; never creates one.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = join(tmpdir(), `bakin-test-mcp-credentials-read-${Date.now()}-${randomUUID()}`)
let testDir = root
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { getMcpCredential, readMcpCredential, UNPROVISIONED_MCP_CREDENTIAL, verifyMcpCredential } from '../../src/core/mcp-credentials'

beforeEach(() => {
  testDir = join(root, randomUUID())
  mkdirSync(testDir, { recursive: true })
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('readMcpCredential', () => {
  test('with no secret on disk it answers a value no entry can match, and creates nothing', () => {
    expect(readMcpCredential('main')).toBe(UNPROVISIONED_MCP_CREDENTIAL)
    expect(readdirSync(testDir)).toEqual([])
    expect(verifyMcpCredential('main', `Bearer ${UNPROVISIONED_MCP_CREDENTIAL}`)).toBe(false)
  })

  test('with a secret it answers exactly what getMcpCredential issues, per agent', () => {
    const issued = getMcpCredential('main')
    expect(existsSync(join(testDir, 'mcp-secret'))).toBe(true)
    expect(readMcpCredential('main')).toBe(issued)
    expect(readMcpCredential('other')).toBe(getMcpCredential('other'))
    expect(readMcpCredential('other')).not.toBe(issued)
  })

  test('a damaged secret is an error, not a silent mismatch', () => {
    writeFileSync(join(testDir, 'mcp-secret'), 'short')
    expect(() => readMcpCredential('main')).toThrow('Invalid MCP credential secret')
  })
})
