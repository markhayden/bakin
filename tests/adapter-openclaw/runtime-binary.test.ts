import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('OpenClaw runtime binary resolution', () => {
  let testDir: string
  let originalPath: string | undefined
  let originalOpenClawPath: string | undefined
  let originalOpenClawHome: string | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-binary-test-'))
    originalPath = process.env.PATH
    originalOpenClawPath = process.env.OPENCLAW_PATH
    originalOpenClawHome = process.env.OPENCLAW_HOME
    delete process.env.OPENCLAW_PATH
    delete process.env.OPENCLAW_HOME
  })

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    if (originalOpenClawPath === undefined) delete process.env.OPENCLAW_PATH
    else process.env.OPENCLAW_PATH = originalOpenClawPath
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(testDir, { recursive: true, force: true })
  })

  it('falls back to openclaw on PATH when the configured binary path is missing', async () => {
    const binDir = join(testDir, 'bin')
    const callsFile = join(testDir, 'calls.txt')
    const missingConfiguredPath = join(testDir, 'missing', 'openclaw')
    mkdirSync(binDir, { recursive: true })
    const shim = join(binDir, 'openclaw')
    writeFileSync(shim, `#!/bin/sh\necho "$@" >> "${callsFile}"\n`, 'utf-8')
    chmodSync(shim, 0o755)
    process.env.PATH = `${binDir}:${originalPath ?? ''}`

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({
      settings: { binaryPath: missingConfiguredPath },
    })

    await runtime.initialize({ contentDir: testDir })
    await runtime.restart()

    expect(readFileSync(callsFile, 'utf-8')).toContain('gateway restart')
  })

  it('writes agent config directly when OpenClaw blocks agent add on plugin allow warning', async () => {
    const binDir = join(testDir, 'bin')
    const callsFile = join(testDir, 'calls.txt')
    const openClawHome = join(testDir, 'openclaw')
    mkdirSync(binDir, { recursive: true })
    const shim = join(binDir, 'openclaw')
    writeFileSync(shim, `#!/bin/sh
echo "$@" >> "${callsFile}"
if [ "$1" = "agents" ] && [ "$2" = "add" ]; then
  echo "[plugins] plugins.allow is empty; discovered non-bundled plugins may auto-load: codex (${testDir}/codex.js). Set plugins.allow to explicit trusted ids." >&2
  exit 1
fi
echo "{}"
`, 'utf-8')
    chmodSync(shim, 0o755)
    process.env.OPENCLAW_HOME = openClawHome

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({
      settings: { binaryPath: shim },
    })

    await runtime.initialize({ contentDir: testDir })
    const agent = await runtime.agents.create({ id: 'pixel', name: 'Pixel' })

    const config = JSON.parse(readFileSync(join(openClawHome, 'openclaw.json'), 'utf-8')) as {
      agents?: { list?: Array<Record<string, unknown>> }
    }
    const configured = config.agents?.list?.find((entry) => entry.id === 'pixel')
    expect(agent.id).toBe('pixel')
    expect(agent.name).toBe('Pixel')
    expect(configured).toMatchObject({
      id: 'pixel',
      name: 'Pixel',
      workspace: join(openClawHome, 'workspaces', 'pixel'),
      agentDir: join(openClawHome, 'agents', 'pixel', 'agent'),
      identity: { name: 'Pixel' },
    })
    expect(readFileSync(callsFile, 'utf-8')).toContain('agents add pixel')
  })
})
