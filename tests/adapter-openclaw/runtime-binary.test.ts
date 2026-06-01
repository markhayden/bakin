import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
  printf '\\033[35m[plugins]\\033[0m plugins.allow is empty; discovered non-bundled plugins may auto-load: codex (${testDir}/codex.js). Set plugins.allow to explicit trusted ids.\\n' >&2
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

  it('removes OpenClaw-owned agent state after agent delete', async () => {
    const binDir = join(testDir, 'bin')
    const callsFile = join(testDir, 'calls.txt')
    const openClawHome = join(testDir, 'openclaw')
    const workspace = join(openClawHome, 'workspaces', 'pixel')
    const agentRoot = join(openClawHome, 'agents', 'pixel')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(workspace, { recursive: true })
    mkdirSync(join(agentRoot, 'sessions'), { recursive: true })
    mkdirSync(join(openClawHome, 'cron', 'runs'), { recursive: true })
    const shim = join(binDir, 'openclaw')
    writeFileSync(shim, `#!/bin/sh
echo "$@" >> "${callsFile}"
echo "{}"
`, 'utf-8')
    chmodSync(shim, 0o755)
    writeFileSync(join(workspace, 'SOUL.md'), '# Pixel soul\n', 'utf-8')
    writeFileSync(join(agentRoot, 'sessions', 'sessions.json'), '{}\n', 'utf-8')
    writeFileSync(join(openClawHome, 'cron', 'runs', 'pixel-daily.jsonl'), '{}\n', 'utf-8')
    writeFileSync(join(openClawHome, 'openclaw.json'), JSON.stringify({
      agents: {
        list: [
          { id: 'main', subagents: { allowAgents: ['pixel'] } },
          { id: 'pixel', workspace, agentDir: join(agentRoot, 'agent') },
        ],
      },
    }), 'utf-8')
    writeFileSync(join(openClawHome, 'cron', 'jobs.json'), JSON.stringify({
      version: 1,
      jobs: [
        { id: 'pixel-daily', agentId: 'pixel' },
        { id: 'main-daily', agentId: 'main' },
      ],
    }), 'utf-8')
    process.env.OPENCLAW_HOME = openClawHome

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({
      settings: { binaryPath: shim },
    })

    await runtime.initialize({ contentDir: testDir })
    await runtime.agents.remove('pixel')

    const config = JSON.parse(readFileSync(join(openClawHome, 'openclaw.json'), 'utf-8')) as {
      agents?: { list?: Array<{ id?: string; subagents?: { allowAgents?: string[] } }> }
    }
    const cron = JSON.parse(readFileSync(join(openClawHome, 'cron', 'jobs.json'), 'utf-8')) as {
      jobs?: Array<{ id?: string; agentId?: string }>
    }
    expect(readFileSync(callsFile, 'utf-8')).toContain('agents delete pixel --force --json')
    expect(config.agents?.list?.some((entry) => entry.id === 'pixel')).toBe(false)
    expect(config.agents?.list?.find((entry) => entry.id === 'main')?.subagents?.allowAgents ?? []).not.toContain('pixel')
    expect(existsSync(workspace)).toBe(false)
    expect(existsSync(agentRoot)).toBe(false)
    expect(cron.jobs?.some((job) => job.agentId === 'pixel')).toBe(false)
    expect(cron.jobs?.some((job) => job.agentId === 'main')).toBe(true)
    expect(existsSync(join(openClawHome, 'cron', 'runs', 'pixel-daily.jsonl'))).toBe(false)
  })
})
