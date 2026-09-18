import { afterAll, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'bakin-mcp-credentials-'))
const contentDir = () => ({ getContentDir: () => home })
mock.module('../../src/core/content-dir', contentDir)
mock.module('../../packages/core/src/content-dir', contentDir)
const { getMcpCredential, verifyMcpCredential } = await import('../../src/core/mcp-credentials')
afterAll(() => rmSync(home, { recursive: true, force: true }))

test('credentials bind one agent and persist with private permissions', () => {
  const token = getMcpCredential('chef')
  expect(getMcpCredential('chef')).toBe(token)
  expect(verifyMcpCredential('chef', `Bearer ${token}`)).toBe(true)
  expect(verifyMcpCredential('other', `Bearer ${token}`)).toBe(false)
  expect(verifyMcpCredential('chef', undefined)).toBe(false)
  expect(verifyMcpCredential('chef', 'Bearer forged')).toBe(false)
  expect(statSync(join(home, 'mcp-secret')).mode & 0o777).toBe(0o600)
})
