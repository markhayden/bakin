/**
 * `startAndFollow` on a terminal shows the waiting line the moment the
 * request goes out — before the server has answered — so a slow start never
 * looks like a hang; a failed start erases it.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-cli-op-waiting-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { startAndFollow } from '../../src/cli/operation-command'

describe('startAndFollow waiting line', () => {
  it('is on the terminal while the start request is still in flight', async () => {
    const written: string[] = []
    let answer!: (value: unknown) => void
    const pending = startAndFollow(() => new Promise((resolve) => { answer = resolve }), {
      json: false,
      stdout: { isTTY: true, write: (s: string) => { written.push(s) } },
    }).catch((err: unknown) => err)
    await Promise.resolve()
    expect(written.join('')).toContain('Starting · waiting for Bakin to answer · 0s')
    answer({ nope: true })
    const err = await pending
    expect(String(err)).toContain('did not start an operation')
    expect(written.at(-1)).toBe('\x1b[1F\x1b[J')
  })

  it('a piped run prints no waiting line on stdout', async () => {
    const written: string[] = []
    await startAndFollow(async () => ({ nope: true }), {
      json: false,
      stdout: { isTTY: false, write: (s: string) => { written.push(s) } },
    }).catch(() => undefined)
    expect(written).toEqual([])
  })
})
