/**
 * The engine version probe (#1007 review r1 #5): a probe the deadline or the
 * caller's signal interrupted did NOT answer — it throws, so the setup check
 * records a failed attempt instead of reporting "wrong version".
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-antfly-probe-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media'), antfly: join(testDir, 'antfly') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...p: string[]) => join(testDir, 'openclaw', ...p), resetOpenClawHome: () => {} }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { antflyBinaryVersion, CommandInterruptedError, runCommand } from '../../packages/adapter-antfly/src/installer'

function script(name: string, body: string): string {
  const path = join(testDir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

describe('antflyBinaryVersion', () => {
  it('a binary that answers gives its version; one that prints nothing recognizable (or fails) gives null', async () => {
    expect(await antflyBinaryVersion(script('ok.sh', 'echo "antfly 0.2.5 (zig)"'))).toBe('0.2.5')
    expect(await antflyBinaryVersion(script('blank.sh', 'echo "no version here"'))).toBeNull()
    expect(await antflyBinaryVersion(script('fail.sh', 'exit 3'))).toBeNull()
  })

  it('a probe the caller\'s signal interrupts throws — it did not answer, and the child is reaped', async () => {
    const controller = new AbortController()
    const probe = antflyBinaryVersion(script('hang.sh', 'sleep 30'), { signal: controller.signal })
    setTimeout(() => controller.abort(new Error('check timed out after 20s')), 50)
    await expect(probe).rejects.toBeInstanceOf(CommandInterruptedError)
    await expect(probe).rejects.toMatchObject({ reason: 'abort', message: 'check timed out after 20s' })
  })

  it('the probe\'s own deadline is the same interruption, named', async () => {
    await expect(runCommand(script('hang2.sh', 'sleep 30'), [], { timeoutMs: 40 })).rejects.toMatchObject({ name: 'CommandInterruptedError', reason: 'timeout' })
  })
})
