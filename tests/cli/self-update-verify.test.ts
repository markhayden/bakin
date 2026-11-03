/** The CLI verification twin (#1007 D7.11): the same verifier, one line each way. */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-cli-verify-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { verifySelfUpdateFromCli } from '../../src/cli/self-update-verify'

function scripted(list: Array<{ version: string; bootId: string; state: 'starting' | 'serving' } | 'down'>) {
  let index = 0
  const urls: string[] = []
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url)
      const answer = list[Math.min(index, list.length - 1)]!
      index += 1
      if (answer === 'down') throw new Error('ECONNREFUSED')
      return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } })
    },
  }
}

describe('verifySelfUpdateFromCli', () => {
  it('polls the given base URL and prints "verified <version>"', async () => {
    const s = scripted(['down', { version: '0.1.1', bootId: 'new', state: 'serving' }])
    const lines: string[] = []
    const result = await verifySelfUpdateFromCli({ expectedVersion: '0.1.1', oldBootId: 'old', log: (line) => lines.push(line), baseUrl: 'http://127.0.0.1:3799', fetch: s.fetch, pollMs: 1 })
    expect(result.status).toBe('verified')
    expect(s.urls[0]).toBe('http://127.0.0.1:3799/api/version')
    expect(lines).toEqual(['Waiting for Bakin 0.1.1 to come back…', 'verified 0.1.1'])
  })

  it('prints the wrong-version and unreachable lines', async () => {
    const lines: string[] = []
    const wrong = scripted([{ version: '0.1.0', bootId: 'new', state: 'serving' }])
    expect((await verifySelfUpdateFromCli({ expectedVersion: '0.1.1', oldBootId: 'old', log: (l) => lines.push(l), baseUrl: 'http://127.0.0.1:1', fetch: wrong.fetch, pollMs: 1 })).status).toBe('wrong-version')
    const down = scripted(['down'])
    expect((await verifySelfUpdateFromCli({ expectedVersion: '0.1.1', oldBootId: 'old', log: (l) => lines.push(l), baseUrl: 'http://127.0.0.1:1', fetch: down.fetch, timeoutMs: 20, pollMs: 1 })).status).toBe('unreachable')
    expect(lines.filter((l) => !l.startsWith('Waiting'))).toEqual(['wrong version 0.1.0 (expected 0.1.1)', 'unreachable — verify by hand (ECONNREFUSED)'])
  })
})
