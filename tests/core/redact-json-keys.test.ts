/**
 * Redaction of secrets under JSON-quoted keys — the shape tool output takes.
 *
 * Pure function: no filesystem, no app services.
 */
import { describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-redact-json-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { redactSensitiveText } from '../../packages/core/src/redact'

describe('redactSensitiveText', () => {
  test('redacts a value under a JSON-quoted key', () => {
    const out = redactSensitiveText('{ "api_key": "sk-live-123", "discord.botToken": "abc", "name": "ok" }')
    expect(out).not.toContain('sk-live-123')
    expect(out).not.toContain('"abc"')
    expect(out).toContain('"name": "ok"')
  })

  test('still redacts the unquoted forms', () => {
    expect(redactSensitiveText('password=hunter2 token: abc')).toBe('password=[redacted] token: [redacted]')
  })

  test('leaves a tool receipt envelope readable', () => {
    const envelope = '{\n  "receipt": "bakin-receipt:r_0123456789abcdef",\n  "result": {}\n}'
    expect(redactSensitiveText(envelope)).toBe(envelope)
  })
})
