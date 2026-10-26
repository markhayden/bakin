import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LaunchError, runLaunch, type LaunchDeps } from '../../src/cli/launch'

const binDir = mkdtempSync(join(tmpdir(), 'bakin-test-launch-bin-'))
writeFileSync(join(binDir, 'tmux'), '#!/bin/sh\n', { mode: 0o755 })

function deps(overrides: Partial<LaunchDeps> = {}): LaunchDeps & { posts: Array<{ path: string; body: unknown }>; spawned: string[][]; state: { killed: number } } {
  const posts: Array<{ path: string; body: unknown }> = []
  const spawned: string[][] = []
  const state = { killed: 0 }
  const base: LaunchDeps = {
    interactive: true,
    localServer: true,
    binDir,
    cwd: '/work/repo',
    env: {},
    identity: async () => ({ agentContext: null, operatorDeclared: true }),
    post: async (path, body) => {
      posts.push({ path, body })
      return path.endsWith('/confirm') ? { ok: true } : { args: ['-S', '/tmp/x.sock', 'attach-session', '-t', 's1'], confirm: { path: '/cli/confirm', token: 'tok-0123456789abcdef' } }
    },
    spawn: (argv) => {
      spawned.push(argv)
      return { pid: 4242, exited: Promise.resolve(3), kill: () => { state.killed++ } }
    },
    ...overrides,
  }
  return Object.assign(base, { posts, spawned, state })
}

const command = { pluginId: 'terminal', path: '/cli/attach', bin: 'tmux' }

describe('runLaunch', () => {
  it('posts the params, spawns the declared bin from the Bakin bin dir, confirms the pid and returns the child exit code', async () => {
    const d = deps()

    expect(await runLaunch(command, { ref: 's1' }, d)).toBe(3)

    expect(d.posts[0]).toEqual({ path: '/api/plugins/terminal/cli/attach', body: { params: { ref: 's1' }, caller: { cwd: '/work/repo' } } })
    expect(d.spawned).toEqual([[join(binDir, 'tmux'), '-S', '/tmp/x.sock', 'attach-session', '-t', 's1']])
    expect(d.posts[1]).toEqual({ path: '/api/plugins/terminal/cli/confirm', body: { token: 'tok-0123456789abcdef', pid: 4242 } })
  })

  it('refuses before sending anything without an interactive terminal', async () => {
    const d = deps({ interactive: false })
    await expect(runLaunch(command, {}, d)).rejects.toThrow(new LaunchError('This command takes over your terminal; run it from an interactive terminal.'))
    expect(d.posts).toHaveLength(0)
  })

  it('refuses before sending anything when the target is not this machine\'s server', async () => {
    const d = deps({ localServer: false })
    await expect(runLaunch(command, {}, d)).rejects.toThrow(/this machine's running Bakin/)
    expect(d.posts).toHaveLength(0)
  })

  it('refuses agent contexts and undeclared callers before sending anything', async () => {
    const agent = deps({ identity: async () => ({ agentContext: 'patch', operatorDeclared: true }) })
    await expect(runLaunch(command, {}, agent)).rejects.toThrow(/agent context \(patch\)/)
    const undeclared = deps({ identity: async () => ({ agentContext: null, operatorDeclared: false }) })
    await expect(runLaunch(command, {}, undeclared)).rejects.toThrow(/--as human/)
    expect([...agent.posts, ...undeclared.posts]).toHaveLength(0)
  })

  it('refuses before sending anything when a refuseEnv variable is set (already inside the binary)', async () => {
    const d = deps({ env: { TMUX: '/tmp/tmux-501/default,1,0' } })
    await expect(runLaunch({ ...command, refuseEnv: ['TMUX'] }, {}, d)).rejects.toThrow(new LaunchError('This terminal is already inside tmux ($TMUX is set). Run this from a new terminal window.'))
    expect(d.posts).toHaveLength(0)
    const empty = deps({ env: { TMUX: '' } })
    expect(await runLaunch({ ...command, refuseEnv: ['TMUX'] }, {}, empty)).toBe(3)
  })

  it('refuses a missing managed binary before sending anything', async () => {
    const d = deps()
    await expect(runLaunch({ ...command, bin: 'absent' }, {}, d)).rejects.toThrow(/bakin install plugin-assets/)
    expect(d.posts).toHaveLength(0)
  })

  it('rejects a malformed route answer without spawning', async () => {
    const d = deps({ post: async () => ({ args: 'attach' }) })
    await expect(runLaunch(command, {}, d)).rejects.toThrow(/unexpected launch answer/)
    expect(d.spawned).toHaveLength(0)
  })

  it('kills the child and fails when the confirm step fails', async () => {
    const d = deps({ post: async (path) => {
      if (path.endsWith('/confirm')) throw new Error('reservation expired')
      return { args: ['attach'], confirm: { path: '/cli/confirm', token: 'tok-0123456789abcdef' } }
    } })
    await expect(runLaunch(command, {}, d)).rejects.toThrow(/reservation expired/)
    expect(d.state.killed).toBe(1)
  })
})

describe('spawnInherited', () => {
  it('gives the child this terminal (stdin and stdout are TTYs) and its exit code', async () => {
    const script = join(binDir, 'probe.ts')
    writeFileSync(script, `import { spawnInherited } from ${JSON.stringify(join(import.meta.dir, '../../src/cli/launch'))}
process.exit(await spawnInherited(['/bin/sh', '-c', 'test -t 0 && test -t 1 && exit 7']).exited)
`)
    const outer = Bun.spawn([process.execPath, script], { terminal: { cols: 80, rows: 24, data: () => {} } })
    expect(await outer.exited).toBe(7)
  })
})
