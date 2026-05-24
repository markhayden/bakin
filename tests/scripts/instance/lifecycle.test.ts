import { describe, expect, it } from 'bun:test'

import { parseInstanceArgs } from '../../../scripts/instance/args'
import { instancePaths } from '../../../scripts/instance/paths'
import { resolvePlan } from '../../../scripts/instance/modes'
import type { CommandRunner, RunResult } from '../../../scripts/instance/runner'
import {
  bootstrapCommands,
  codexAuthRunArgs,
  composeDownArgs,
  composeUpArgs,
  oneOffRunArgs,
  openclawExecArgs,
  preflight,
  reset,
  up,
  type LifecycleDeps,
} from '../../../scripts/instance/lifecycle'

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
  exists: boolean
}> = {}) {
  const calls: string[][] = []
  const wiped: string[] = []
  const mkdirs: string[] = []
  const runner: CommandRunner = {
    async run(argv) {
      calls.push(argv)
      if (over.results) return over.results(argv)
      const j = argv.join(' ')
      if (j.includes('op read')) return { code: 0, stdout: 'brave-secret\n', stderr: '' }
      if (j.includes('models auth list')) return { code: 0, stdout: 'openai-codex (oauth)', stderr: '' }
      if (j.includes('healthz')) return { code: 0, stdout: 'ok', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
  const deps: LifecycleDeps = {
    runner,
    emptyDir: async (p) => { wiped.push(p) },
    mkdirp: async (p) => { mkdirs.push(p) },
    exists: () => over.exists ?? true, // default: config already present (init skipped)
    ensureDevice: () => {},
    sleep: async () => {},
    log: () => {},
    env: over.env ?? { OP_SERVICE_ACCOUNT_TOKEN: 'tok' },
  }
  return { deps, calls, wiped, mkdirs }
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
  it('codexAuthRunArgs: dedicated docker run publishes the 1455 OAuth callback port', () => {
    expect(codexAuthRunArgs('ghcr.io/openclaw/openclaw:latest', '/tmp/fake-repo/dev/openclaw-home', ['models', 'auth', 'login', '--provider', 'openai-codex'])).toEqual([
      'docker', 'run', '--rm', '-it', '-p', '1455:1455',
      '-v', '/tmp/fake-repo/dev/openclaw-home:/home/node/.openclaw',
      '--entrypoint', 'node', 'ghcr.io/openclaw/openclaw:latest',
      'dist/index.js', 'models', 'auth', 'login', '--provider', 'openai-codex',
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

describe('up — fresh', () => {
  it('brings the container down before wiping (releases the bind mount)', async () => {
    const { paths, plan } = planFor(['up', '--fresh'])
    const { deps, calls, wiped } = fakeDeps()
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)
    expect(calls.some((c) => c.join(' ').includes('compose -f') && c.join(' ').includes('down'))).toBe(true)
    expect(wiped).toEqual(['/tmp/fake-repo/dev/openclaw-home'])
  })
})

describe('reset', () => {
  it('wipes only the mode reset targets (all under dev/)', async () => {
    const { paths, plan } = planFor(['reset', '--mode', 'isolated'])
    const { deps, wiped } = fakeDeps()
    await reset(plan, paths, deps)
    expect(wiped).toEqual([
      '/tmp/fake-repo/dev/openclaw-home',
      '/tmp/fake-repo/dev/bakin-instances/isolated/home',
    ])
    for (const w of wiped) expect(w.startsWith('/tmp/fake-repo/dev/')).toBe(true)
  })
})
