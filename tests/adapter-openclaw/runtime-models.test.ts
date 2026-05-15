import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('OpenClaw runtime models adapter', () => {
  let testDir: string
  let openclaw: string
  let callsFile: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-models-test-'))
    const binDir = join(testDir, 'bin')
    mkdirSync(binDir, { recursive: true })
    openclaw = join(binDir, 'openclaw')
    callsFile = join(testDir, 'calls.txt')
    writeFileSync(openclaw, `#!/bin/sh
printf '%s\\n' "$@" >> "${callsFile}"
cat <<'JSON'
{"models":[{"key":"configured/model","name":"Configured Model","available":true},{"key":"unavailable/model","name":"Unavailable Model","available":false}]}
JSON
`, 'utf-8')
    chmodSync(openclaw, 0o755)
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('lists configured available models without requesting the full catalogue', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })

    const models = await runtime.models.listAvailable()

    expect(models).toEqual([
      expect.objectContaining({ id: 'configured/model', available: true }),
    ])
    expect(readFileSync(callsFile, 'utf-8').split('\n').filter(Boolean)).toEqual([
      'models',
      'list',
      '--json',
    ])
  })

  it('uses a larger stdout buffer only when requesting unavailable models too', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })

    const models = await runtime.models.listAvailable({ includeUnavailable: true })

    expect(models.map(model => model.id)).toEqual(['configured/model', 'unavailable/model'])
    expect(readFileSync(callsFile, 'utf-8').split('\n').filter(Boolean)).toEqual([
      'models',
      'list',
      '--all',
      '--json',
    ])
  })
})
