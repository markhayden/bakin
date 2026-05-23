import { describe, expect, it } from 'bun:test'

import { parseInstanceArgs } from '../../../scripts/instance/args'
import { instancePaths } from '../../../scripts/instance/paths'
import { resolvePlan } from '../../../scripts/instance/modes'
import type { CommandRunner, RunResult } from '../../../scripts/instance/runner'
import {
  codexAuthRunArgs,
  composeDownArgs,
  composeUpArgs,
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
function fakeDeps(over: Partial<{ results: (argv: string[]) => RunResult; env: Record<string, string | undefined> }> = {}) {
  const calls: string[][] = []
  const wiped: string[] = []
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
    rmrf: async (p) => { wiped.push(p) },
    sleep: async () => {},
    log: () => {},
    env: over.env ?? { OP_SERVICE_ACCOUNT_TOKEN: 'tok' },
  }
  return { deps, calls, wiped }
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
  it('codexAuthRunArgs: dedicated docker run publishes the 1455 OAuth callback port (matches proven setup.sh path)', () => {
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
    const { args, paths, plan } = planFor(['up'])
    const { deps, calls } = fakeDeps()
    await up(plan, paths, 'BRAVE_API_KEY=op://V/brave/cred', deps)

    const order = calls.map((c) => c.join(' '))
    const opIdx = order.findIndex((c) => c.includes('op read'))
    const upIdx = order.findIndex((c) => c.includes('compose -f') && c.includes('up -d'))
    const braveIdx = order.findIndex((c) => c.includes('mcp set brave-search'))
    expect(opIdx).toBeGreaterThanOrEqual(0)
    expect(upIdx).toBeGreaterThan(opIdx)
    expect(braveIdx).toBeGreaterThan(upIdx)
    // resolved brave key is injected into the mcp set command
    expect(order.find((c) => c.includes('mcp set brave-search'))).toContain('brave-secret')
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
