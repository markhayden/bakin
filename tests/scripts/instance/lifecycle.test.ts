import { describe, expect, it } from 'bun:test'

import { parseInstanceArgs } from '../../../scripts/instance/args'
import { instancePaths } from '../../../scripts/instance/paths'
import { resolvePlan } from '../../../scripts/instance/modes'
import type { CommandRunner, RunResult } from '../../../scripts/instance/runner'
import {
  bootstrapCommands,
  codexLoginExecArgs,
  codexLoginRunArgs,
  composeDownArgs,
  composeUpArgs,
  oneOffRunArgs,
  openclawExecArgs,
  preflight,
  reset,
  up,
  type LifecycleDeps,
} from '../../../scripts/instance/lifecycle'
import { CODEX_CLI_ENTRY } from '../../../scripts/instance/codex'

const ROOT = '/tmp/fake-repo'
const COMPOSE = '/tmp/fake-repo/dev/docker/docker-compose.yml'

function planFor(argv: string[]) {
  const args = parseInstanceArgs(argv)
  const paths = instancePaths(ROOT, args.mode)
  return { args, paths, plan: resolvePlan(args, paths) }
}

/** Fake runner that returns canned results by argv prefix and records all calls. */
function fakeDeps(over: Partial<{
  results: (argv: string[]) => RunResult
  env: Record<string, string | undefined>
  exists: boolean | ((p: string) => boolean)
  configText: string | ((p: string) => string)
  piDefaultModels: Record<string, string> | null
}> = {}) {
  const calls: string[][] = []
  const wiped: string[] = []
  const mkdirs: string[] = []
  const writes: Array<{ path: string; content: string; beforeCallCount: number }> = []
  const logs: string[] = []
  const runner: CommandRunner = {
    async run(argv) {
      calls.push(argv)
      if (over.results) return over.results(argv)
      const j = argv.join(' ')
      if (j.includes('op read')) return { code: 0, stdout: 'brave-secret\n', stderr: '' }
      if (j.includes('healthz')) return { code: 0, stdout: 'ok', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
  const deps: LifecycleDeps = {
    runner,
    emptyDir: async (p) => { wiped.push(p) },
    mkdirp: async (p) => { mkdirs.push(p) },
    // default: config already present (init skipped)
    exists: (p) => (typeof over.exists === 'function' ? over.exists(p) : over.exists ?? true),
    ensureDevice: () => {},
    readTextFile: (p) => (typeof over.configText === 'function' ? over.configText(p) : over.configText ?? '{}'),
    writeTextFile: (path, content) => { writes.push({ path, content, beforeCallCount: calls.length }) },
    sleep: async () => {},
    log: (m) => { logs.push(m) },
    env: over.env ?? { OP_SERVICE_ACCOUNT_TOKEN: 'tok' },
    piDefaultModels: async () => (over.piDefaultModels === undefined ? { 'anthropic': 'claude-opus-4-8', 'openai-codex': 'gpt-5.5' } : over.piDefaultModels),
  }
  return { deps, calls, wiped, mkdirs, writes, logs }
}

describe('compose argv builders', () => {
  it('composeUpArgs: default gateway, no profile', () => {
    expect(composeUpArgs(COMPOSE, ['openclaw-gateway'], null)).toEqual([
      'docker', 'compose', '-f', COMPOSE, 'up', '-d', 'openclaw-gateway',
    ])
  })
  it('composeUpArgs: threads --profile before the subcommand', () => {
    expect(composeUpArgs(COMPOSE, ['sandbox'], 'sandbox')).toEqual([
      'docker', 'compose', '--profile', 'sandbox', '-f', COMPOSE, 'up', '-d', 'sandbox',
    ])
  })
  it('composeDownArgs', () => {
    expect(composeDownArgs(COMPOSE)).toEqual(['docker', 'compose', '-f', COMPOSE, 'down'])
  })
  it('openclawExecArgs: non-interactive commands run -T through the cli service', () => {
    expect(openclawExecArgs(COMPOSE, ['mcp', 'set', 'x', '{}'])).toEqual([
      'docker', 'compose', '-f', COMPOSE, 'run', '--rm', '-T', 'openclaw-cli', 'mcp', 'set', 'x', '{}',
    ])
  })
  it('oneOffRunArgs: docker run of an openclaw command against the mounted home', () => {
    expect(oneOffRunArgs('img', '/tmp/fake-repo/dev/openclaw-home', ['config', 'set', 'gateway.bind', 'lan'])).toEqual([
      'docker', 'run', '--rm',
      '-v', '/tmp/fake-repo/dev/openclaw-home:/home/node/.openclaw',
      '--entrypoint', 'node', 'img',
      'dist/index.js', 'config', 'set', 'gateway.bind', 'lan',
    ])
  })
  it('bootstrapCommands: onboard, bind=lan, and matching gateway auth/remote tokens', () => {
    const cmds = bootstrapCommands()
    expect(cmds[0]).toEqual(['onboard', '--non-interactive', '--accept-risk', '--mode', 'local', '--auth-choice', 'skip', '--skip-health'])
    expect(cmds).toContainEqual(['config', 'set', 'gateway.bind', 'lan'])
    // auth.token and remote.token must be pinned equal so the loopback CLI connects
    const auth = cmds.find((c) => c[2] === 'gateway.auth.token')
    const remote = cmds.find((c) => c[2] === 'gateway.remote.token')
    expect(auth).toBeDefined()
    expect(remote).toBeDefined()
    expect(auth![3]).toBe(remote![3])
  })
  it('codexLoginRunArgs: device-code login (no port publish) with CODEX_HOME in the mounted home', () => {
    expect(codexLoginRunArgs('ghcr.io/openclaw/openclaw:latest', '/tmp/fake-repo/dev/openclaw-home')).toEqual([
      'docker', 'run', '--rm', '-it',
      '-e', 'CODEX_HOME=/home/node/.openclaw/codex',
      '-v', '/tmp/fake-repo/dev/openclaw-home:/home/node/.openclaw',
      '--entrypoint', 'node', 'ghcr.io/openclaw/openclaw:latest',
      CODEX_CLI_ENTRY, 'login', '--device-auth',
    ])
  })
  it('codexLoginExecArgs: sandbox execs the Codex CLI login into the running container', () => {
    expect(codexLoginExecArgs(COMPOSE, 'sandbox')).toEqual([
      'docker', 'compose', '-f', COMPOSE, 'exec', 'sandbox', 'node', CODEX_CLI_ENTRY, 'login', '--device-auth',
    ])
  })
})

describe('preflight', () => {
  it('passes when docker + op + token are present', async () => {
    const { deps } = fakeDeps()
    await expect(preflight(deps)).resolves.toBeUndefined()
  })
  it('fails with remediation when OP_SERVICE_ACCOUNT_TOKEN is unset', async () => {
    const { deps } = fakeDeps({ env: {} })
    await expect(preflight(deps)).rejects.toThrow(/OP_SERVICE_ACCOUNT_TOKEN/)
  })
  it('fails when docker is not running', async () => {
    const { deps } = fakeDeps({
      results: (argv) => (argv.join(' ').startsWith('docker info')
        ? { code: 1, stdout: '', stderr: 'cannot connect' }
        : { code: 0, stdout: '', stderr: '' }),
      env: { OP_SERVICE_ACCOUNT_TOKEN: 'tok' },
    })
    await expect(preflight(deps)).rejects.toThrow(/docker/i)
  })
})

describe('up — native', () => {
  it('resolves secrets, brings up the gateway, then configures via openclaw CLI', async () => {
    const { paths, plan } = planFor(['up'])
    const { deps, calls, mkdirs } = fakeDeps()
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)

    const order = calls.map((c) => c.join(' '))
    const opIdx = order.findIndex((c) => c.includes('op read'))
    const upIdx = order.findIndex((c) => c.includes('compose -f') && c.includes('up -d'))
    const braveIdx = order.findIndex((c) => c.includes('mcp set brave-search'))
    expect(opIdx).toBeGreaterThanOrEqual(0)
    expect(upIdx).toBeGreaterThan(opIdx)
    expect(braveIdx).toBeGreaterThan(upIdx)
    expect(order.find((c) => c.includes('mcp set brave-search'))).toContain('brave-secret')
    // bind-mount target is ensured before bringing the container up
    expect(mkdirs).toContain('/tmp/fake-repo/dev/openclaw-home')
  })

  it('skips config init when openclaw.json already exists', async () => {
    const { paths, plan } = planFor(['up'])
    const { deps, calls } = fakeDeps({ exists: true })
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)
    expect(calls.some((c) => c.join(' ').includes('onboard --non-interactive'))).toBe(false)
  })

  it('initializes config before compose up when openclaw.json is absent', async () => {
    const { paths, plan } = planFor(['up'])
    const { deps, calls } = fakeDeps({ exists: false })
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)
    const order = calls.map((c) => c.join(' '))
    const initIdx = order.findIndex((c) => c.includes('onboard --non-interactive') && c.includes('--skip-health'))
    const upIdx = order.findIndex((c) => c.includes('up -d'))
    expect(initIdx).toBeGreaterThanOrEqual(0)
    expect(upIdx).toBeGreaterThan(initIdx)
  })
})

describe('up — agent-path normalization', () => {
  const HOST_HOME = '/tmp/fake-repo/dev/openclaw-home'

  it('rewrites stored host agent paths to the container home before the gateway starts', async () => {
    const { paths, plan } = planFor(['up'])
    const config = {
      agents: {
        list: [{ id: 'main', agentDir: `${HOST_HOME}/agents/main/agent`, workspace: `${HOST_HOME}/workspace` }],
      },
    }
    const { deps, calls, writes } = fakeDeps({ exists: true, configText: JSON.stringify(config) })
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)

    expect(writes).toHaveLength(1)
    expect(writes[0]!.path).toBe(`${HOST_HOME}/openclaw.json`)
    const written = JSON.parse(writes[0]!.content) as typeof config
    expect(written.agents.list[0]!.agentDir).toBe('/home/node/.openclaw/agents/main/agent')
    expect(written.agents.list[0]!.workspace).toBe('/home/node/.openclaw/workspace')

    // rewrite happens before docker compose up (gateway reads config on start)
    const upIdx = calls.findIndex((c) => c.join(' ').includes('up -d'))
    expect(upIdx).toBeGreaterThanOrEqual(0)
    expect(writes[0]!.beforeCallCount).toBeLessThanOrEqual(upIdx)
  })

  it('writes nothing when stored paths are already container-form', async () => {
    const { paths, plan } = planFor(['up'])
    const config = { agents: { list: [{ id: 'main', agentDir: '/home/node/.openclaw/agents/main/agent' }] } }
    const { deps, writes } = fakeDeps({ exists: true, configText: JSON.stringify(config) })
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)
    expect(writes).toHaveLength(0)
  })

  it('skips normalization on fresh state (no openclaw.json)', async () => {
    const { paths, plan } = planFor(['up'])
    const { deps, writes } = fakeDeps({ exists: false })
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)
    expect(writes).toHaveLength(0)
  })
})

describe('up — fresh', () => {
  it('brings the container down before wiping (releases the bind mount)', async () => {
    const { paths, plan } = planFor(['up', '--fresh'])
    const { deps, calls, wiped } = fakeDeps()
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)
    expect(calls.some((c) => c.join(' ').includes('compose -f') && c.join(' ').includes('down'))).toBe(true)
    expect(wiped).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/pi-home',
    ])
  })
})

describe('up — pi (host modes)', () => {
  const PI_AUTH = '/tmp/fake-repo/dev/pi-home/agent/auth.json'
  const PI_SETTINGS = '/tmp/fake-repo/dev/pi-home/agent/settings.json'
  const AUTHED = JSON.stringify({ anthropic: { type: 'api_key', key: 'sk' } })

  it('native: touches neither docker nor op — only the pi home and the TUI', async () => {
    const { paths, plan } = planFor(['up', '--runtime', 'pi'])
    let authExists = false
    const { deps, calls, mkdirs } = fakeDeps({
      exists: (p) => (p === PI_AUTH ? authExists : false),
      configText: () => AUTHED,
      results: (argv) => {
        if (argv[0] === 'node') authExists = true // the TUI /login wrote auth.json
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    await up(plan, paths, '', deps)

    expect(mkdirs).toContain('/tmp/fake-repo/dev/pi-home/agent')
    // The ONLY spawned command is the interactive TUI (node <sdk cli>).
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toBe('node')
    expect(calls[0]![1]!.endsWith('/dist/cli.js')).toBe(true)
    const flat = calls.map((c) => c.join(' ')).join('\n')
    expect(flat).not.toContain('docker')
    expect(flat).not.toContain('op ')
  })

  it('skips the TUI when auth.json already exists (idempotent up)', async () => {
    const { paths, plan } = planFor(['up', '--runtime', 'pi'])
    const { deps, calls } = fakeDeps({
      exists: (p) => p === PI_AUTH,
      configText: () => AUTHED,
    })
    await up(plan, paths, '', deps)
    expect(calls.filter((c) => c[0] === 'node')).toHaveLength(0)
  })

  it('throws actionably when the TUI exits without writing auth.json', async () => {
    const { paths, plan } = planFor(['up', '--runtime', 'pi'])
    const { deps } = fakeDeps({ exists: () => false })
    // TUI runs (code 0) but auth.json still absent afterwards.
    await expect(up(plan, paths, '', deps)).rejects.toThrow(/\/login/)
  })

  it('writes routing.defaultModel from the authed provider (warn-don\'t-fail path)', async () => {
    const { paths, plan } = planFor(['up', '--runtime', 'pi'])
    const { deps, writes } = fakeDeps({
      exists: (p) => p === PI_AUTH, // settings.json absent
      configText: () => AUTHED,
    })
    await up(plan, paths, '', deps)
    const settingsWrite = writes.find((w) => w.path === PI_SETTINGS)
    expect(settingsWrite).toBeDefined()
    expect(JSON.parse(settingsWrite!.content)).toEqual({
      routing: { defaultModel: 'anthropic/claude-opus-4-8' },
    })
  })

  it('logs a warning instead of failing when no default model can be derived', async () => {
    const { paths, plan } = planFor(['up', '--runtime', 'pi'])
    const { deps, writes, logs } = fakeDeps({
      exists: (p) => p === PI_AUTH,
      configText: () => AUTHED,
      piDefaultModels: null, // SDK table unavailable
    })
    await up(plan, paths, '', deps)
    expect(writes.find((w) => w.path === PI_SETTINGS)).toBeUndefined()
    expect(logs.some((l) => /warning/i.test(l) && /model/i.test(l))).toBe(true)
  })

  it('isolated: writes the throwaway settings patch (adapter=pi + guest search url)', async () => {
    const { paths, plan } = planFor(['up', '--mode', 'isolated', '--runtime', 'pi'])
    const { deps, writes } = fakeDeps({
      exists: (p) => p === '/tmp/fake-repo/dev/pi-home/agent/auth.json',
      configText: (p) => (p.endsWith('auth.json') ? AUTHED : '{}'),
    })
    await up(plan, paths, '', deps)
    const settingsWrite = writes.find((w) => w.path === '/tmp/fake-repo/dev/bakin-instances/isolated/home/settings.json')
    expect(settingsWrite).toBeDefined()
    const parsed = JSON.parse(settingsWrite!.content)
    expect(parsed.runtime.adapter).toBe('pi')
    expect(parsed.search.settings.url).toBe('http://127.0.0.1:3838')
  })
})

describe('up — isolated × openclaw settings patch', () => {
  it('writes the guest-search patch for isolated openclaw too (the clobber fired there)', async () => {
    const { paths, plan } = planFor(['up', '--mode', 'isolated'])
    const { deps, writes } = fakeDeps()
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)
    const settingsWrite = writes.find((w) => w.path === '/tmp/fake-repo/dev/bakin-instances/isolated/home/settings.json')
    expect(settingsWrite).toBeDefined()
    const parsed = JSON.parse(settingsWrite!.content)
    expect(parsed.runtime.adapter).toBe('openclaw')
    expect(parsed.search.settings.url).toBe('http://127.0.0.1:3838')
  })
})

describe('reset', () => {
  it('wipes only the mode reset targets (all under dev/)', async () => {
    const { paths, plan } = planFor(['reset', '--mode', 'isolated'])
    const { deps, wiped } = fakeDeps()
    await reset(plan, paths, deps)
    expect(wiped).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/pi-home',
      '/tmp/fake-repo/dev/bakin-instances/isolated/home',
      '/tmp/fake-repo/dev/bakin-instances/isolated/antfly',
    ])
    for (const w of wiped) expect(w.startsWith('/tmp/fake-repo/dev/')).toBe(true)
  })
})
