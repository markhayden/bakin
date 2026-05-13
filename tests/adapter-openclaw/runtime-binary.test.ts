import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('OpenClaw runtime binary resolution', () => {
  let testDir: string
  let originalPath: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-binary-test-'))
    originalPath = process.env.PATH
  })

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    rmSync(testDir, { recursive: true, force: true })
  })

  it('falls back to openclaw on PATH when the configured Homebrew path is missing', async () => {
    const binDir = join(testDir, 'bin')
    const callsFile = join(testDir, 'calls.txt')
    mkdirSync(binDir, { recursive: true })
    const shim = join(binDir, 'openclaw')
    writeFileSync(shim, `#!/bin/sh\necho "$@" >> "${callsFile}"\n`, 'utf-8')
    chmodSync(shim, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ''}`

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({
      settings: { binaryPath: '/opt/homebrew/bin/openclaw' },
    })

    await runtime.initialize({ contentDir: testDir })
    await runtime.restart()

    expect(readFileSync(callsFile, 'utf-8')).toContain('gateway restart')
  })
})
