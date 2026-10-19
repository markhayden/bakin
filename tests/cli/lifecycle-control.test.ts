/**
 * #898 K — home-scoped stop/restart against a FAKE LifecycleIo: nothing real
 * is ever signalled, controlled, spawned or fetched. Each case is a finding
 * from the J reviews (r2 #2, r3 #1–#5, r4 #1–#6) or the K design review.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'bun:test'
import { readServiceState, restartHome, stopHome, type HttpAnswer, type LifecycleIo, type LockInfo, type ProcessInfo } from '../../src/cli/lifecycle-control'

interface Server { pid: number; bootId: string; port: number; state: string; protocol?: 'new' | 'old'; secret: string; alive: boolean; answers: boolean }

function harness(opts: { home?: string; platform?: string; lock?: LockInfo | null; servers?: Server[]; processes?: ProcessInfo[]; launchctl?: { ok: boolean; output: string }; plist?: string | null; spawnBoots?: boolean; psFails?: boolean } = {}) {
  const servers = opts.servers ?? []
  let lock: LockInfo | null = opts.lock ?? null
  let launchctl = opts.launchctl ?? { ok: false, output: 'Could not find service' }
  let clock = 0
  const execs: string[] = []
  const shutdownRequests: Array<{ port: number; secret?: string; bootId?: string }> = []
  const spawns: Array<Record<string, string>> = []
  let nextPid = 9000
  const byPort = (port: number) => servers.find((s) => s.port === port && s.alive && s.answers)
  const io: LifecycleIo = {
    platform: opts.platform ?? 'darwin',
    home: opts.home ?? '/home/me/.bakin',
    selfPid: 1,
    readLock: () => lock,
    pidAlive: (pid) => servers.some((s) => s.pid === pid && s.alive) || (opts.processes ?? []).some((p) => p.pid === pid),
    http: async (method, port, path, o): Promise<HttpAnswer | null> => {
      const s = byPort(port)
      if (!s) return null
      if (method === 'GET' && path === '/api/version') {
        return { status: 200, body: s.protocol === 'old' ? { version: '1' } : { version: '1', pid: s.pid, bootId: s.bootId, state: s.state } }
      }
      if (method === 'POST' && path === '/api/server/shutdown') {
        const secret = o?.headers?.['X-Bakin-Cli-Secret']
        const bootId = (o?.body as { bootId?: string } | undefined)?.bootId
        shutdownRequests.push({ port, secret, bootId })
        if (secret !== s.secret) return { status: 403, body: {} }
        if (bootId !== s.bootId) return { status: 409, body: {} }
        s.state = 'stopping'
        // It exits promptly and releases its lock.
        queueMicrotask(() => { s.alive = false; if (lock?.bootId === s.bootId) lock = null })
        return { status: 202, body: { ok: true } }
      }
      return null
    },
    listProcesses: () => (opts.psFails ? null : opts.processes ?? []),
    exec: (cmd, args) => {
      execs.push(`${cmd} ${args.join(' ')}`)
      if (cmd === 'launchctl' && args[0] === 'print') return launchctl
      return { ok: true, output: '' }
    },
    uid: () => '501',
    readFile: (p) => (p.endsWith('.plist') ? opts.plist ?? null : null),
    launchAgentPath: () => '/Users/me/Library/LaunchAgents/com.makinbakin.bakin.plist',
    systemdUnitPath: () => '/home/me/.config/systemd/user/com.makinbakin.bakin.service',
    spawnServer: (env) => {
      spawns.push(env)
      const pid = nextPid++
      if (opts.spawnBoots !== false) {
        const s: Server = { pid, bootId: `boot-${pid}`, port: Number(env.PORT ?? 3737), state: 'serving', secret: 'new', alive: true, answers: true }
        servers.push(s)
        lock = { pid, port: s.port, bootId: s.bootId, cliSecret: 'new' }
      }
      return { pid, exitedEarly: () => opts.spawnBoots === false, error: () => (opts.spawnBoots === false ? 'boom' : null) }
    },
    now: () => clock,
    sleep: async (ms) => { clock += ms; await Promise.resolve() },
  }
  return {
    io, execs, shutdownRequests, spawns, servers,
    getLock: () => lock,
    setLock: (next: LockInfo | null) => { lock = next },
    /** What the manager reports from now on (a kickstart changes its pid). */
    setService: (pid: number | null, home = '/home/me/.bakin') => {
      launchctl = { ok: true, output: `gui/501/com.makinbakin.bakin = {\n${pid ? `\tstate = running\n\tpid = ${pid}\n` : '\tstate = not running\n'}\tenvironment = {\n\t\tBAKIN_HOME => ${home}\n\t}\n}` }
    },
  }
}

const mine: Server = { pid: 500, bootId: 'boot-A', port: 3737, state: 'serving', secret: 'secret-A', alive: true, answers: true }
const lockFor = (s: Server): LockInfo => ({ pid: s.pid, port: s.port, bootId: s.bootId, cliSecret: s.secret })
const fresh = (over: Partial<Server> = {}): Server => ({ ...mine, ...over })

describe('stop', () => {
  it('stops this home\'s server by REQUEST (secret + bootId) — never a signal — and leaves other homes\' servers alone (J r2 #2)', async () => {
    const me = fresh(); const other = fresh({ pid: 600, bootId: 'boot-B', port: 3738, secret: 'secret-B' })
    const h = harness({ lock: lockFor(me), servers: [me, other], processes: [{ pid: 600, command: 'bun /x/server.ts serve' }] })
    const out = await stopHome(h.io)
    expect(out).toMatchObject({ ok: true, message: 'Bakin stopped.' })
    expect(h.shutdownRequests).toEqual([{ port: 3737, secret: 'secret-A', bootId: 'boot-A' }])
    expect(other.alive).toBe(true)
    expect(out.notes.join(' ')).toContain('pid 600') // reported, never touched (r4 #6: in the outcome, printed in both modes)
  })

  it('a recycled lock pid (a different process answers nothing) is wedged → fail closed, nothing signalled (J r3 #1, r4 #2)', async () => {
    const h = harness({ lock: { pid: 777, port: 3737, bootId: 'boot-dead', cliSecret: 's' }, processes: [{ pid: 777, command: 'vim /home/me/bakin/server.ts' }] })
    const out = await stopHome(h.io)
    expect(out).toMatchObject({ ok: false, status: 'error' })
    expect(out.message).toContain('not answering')
    expect(h.shutdownRequests).toEqual([])
    expect(h.execs.filter((e) => !e.startsWith('launchctl print'))).toEqual([])
  })

  it('another home answering on the recorded port is foreign → fail closed', async () => {
    const other = fresh({ pid: 600, bootId: 'boot-B' })
    const h = harness({ lock: { pid: 500, port: 3737, bootId: 'boot-A', cliSecret: 'secret-A' }, servers: [other], processes: [{ pid: 500, command: 'bakin serve' }] })
    const out = await stopHome(h.io)
    expect(out.message).toContain('different Bakin generation')
    expect(h.shutdownRequests).toEqual([])
  })

  it('a service-managed server: stops the SERVICE (no KeepAlive respawn), only when the manager pid IS the proved pid (J r3 #2, r4 #4)', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], launchctl: { ok: true, output: `gui/501/com.makinbakin.bakin = {\n\tstate = running\n\tpid = 500\n\tenvironment = {\n\t\tBAKIN_HOME => /home/me/.bakin\n\t}\n}` } })
    // The bootout stops the process.
    const origExec = h.io.exec
    h.io.exec = (cmd, args) => { if (args[0] === 'bootout') me.alive = false; return origExec(cmd, args) }
    const out = await stopHome(h.io)
    expect(out.ok).toBe(true)
    expect(h.execs).toContain('launchctl bootout gui/501/com.makinbakin.bakin')
    expect(h.shutdownRequests).toEqual([])
  })

  it('a loaded service running ANOTHER pid (another home) is never controlled — this home is stopped by request (J r4 #4)', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], launchctl: { ok: true, output: `x = {\n\tstate = running\n\tpid = 4242\n\tenvironment = {\n\t\tBAKIN_HOME => /home/me/.bakin\n\t}\n}` } })
    const out = await stopHome(h.io)
    expect(out.ok).toBe(true)
    expect(h.execs.some((e) => e.includes('bootout'))).toBe(false)
    expect(h.shutdownRequests).toHaveLength(1)
  })

  it('nothing running: says so, and reports a start that may be pending', async () => {
    const h = harness({ processes: [{ pid: 321, command: 'bakin __bakin-restart-child 300' }] })
    const out = await stopHome(h.io)
    expect(out).toMatchObject({ ok: true, status: 'warn', message: 'No running Bakin server for this home.' })
    expect(out.notes[0]).toContain('A start may be pending')
  })

  it('an older server that cannot take a request is never signalled unless its own service manager stops it', async () => {
    const me = fresh({ protocol: 'old' })
    const h = harness({ lock: lockFor(me), servers: [me] })
    const out = await stopHome(h.io)
    expect(out.ok).toBe(false)
    expect(out.notes[0]).toContain('kill 500')
    expect(h.shutdownRequests).toEqual([])
  })
})

describe('restart', () => {
  it('manual server: request → await the handoff → spawn with the ABSOLUTE home and the SAME port → prove the new boot is the one spawned (J r3 #3)', async () => {
    const me = fresh({ port: 4000 })
    const h = harness({ lock: lockFor(me), servers: [me] })
    const out = await restartHome(h.io, { baseEnv: { PATH: '/usr/bin' } })
    expect(out).toMatchObject({ ok: true, message: 'Bakin restarted.' })
    expect(h.spawns).toEqual([{ PATH: '/usr/bin', BAKIN_HOME: '/home/me/.bakin', PORT: '4000' }])
    expect(out.boot?.bootId).not.toBe('boot-A')
    expect(out.boot?.pid).toBe(9000)
  })

  it('never reports success from the old server: a replacement that dies during startup is a failure', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], spawnBoots: false })
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(false)
    expect(out.message).toContain('exited during startup')
  })

  it('an old server still answering after the deadline: no competitor is started', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me] })
    // It accepts the request but never goes away.
    const http = h.io.http
    h.io.http = async (m, p, path, o) => (path === '/api/server/shutdown' ? { status: 202, body: {} } : http(m, p, path, o))
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(false)
    expect(out.message).toContain('still shutting down')
    expect(h.spawns).toEqual([])
  })

  it('a pending start is never raced; --force overrides (narrow + report)', async () => {
    const pending = [{ pid: 321, command: 'bun run scripts/dev.ts' }]
    let h = harness({ processes: pending })
    let out = await restartHome(h.io, { baseEnv: {} })
    expect(out).toMatchObject({ ok: false })
    expect(out.message).toContain('may already be pending')
    expect(h.spawns).toEqual([])
    h = harness({ processes: pending })
    out = await restartHome(h.io, { baseEnv: {}, force: true })
    expect(out.ok).toBe(true)
  })

  it('a service-owned server restarts through the manager and proves a NEW boot', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], launchctl: { ok: true, output: `x = {\n\tstate = running\n\tpid = 500\n}` } })
    const exec = h.io.exec
    h.io.exec = (cmd, args) => {
      const r = exec(cmd, args)
      if (args[0] === 'kickstart') {
        me.alive = false
        const next = { ...mine, pid: 501, bootId: 'boot-B', secret: 'b' }
        h.servers.push(next)
        h.setLock(lockFor(next))
        h.setService(501)
      }
      return r
    }
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out).toMatchObject({ ok: true, boot: { pid: 501, bootId: 'boot-B' } })
    expect(h.execs).toContain('launchctl kickstart -k gui/501/com.makinbakin.bakin')
    expect(h.spawns).toEqual([])
  })

  it('an unloaded service for ANOTHER home is never bootstrapped; nothing running here → a manual start (J r4 #5)', async () => {
    const h = harness({ plist: '<key>BAKIN_HOME</key>\n<string>/other/home</string>' })
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(true)
    expect(h.execs.some((e) => e.includes('bootstrap') || e.includes('kickstart'))).toBe(false)
    expect(h.spawns).toHaveLength(1)
  })

  it('this home\'s unloaded service is brought back when nothing runs (stop unloads it; restart restores it)', async () => {
    const h = harness({ plist: '<key>BAKIN_HOME</key>\n<string>/home/me/.bakin</string>' })
    const exec = h.io.exec
    h.io.exec = (cmd, args) => {
      const r = exec(cmd, args)
      if (args[0] === 'kickstart') {
        const s = { ...mine, pid: 777, bootId: 'boot-S', secret: 's' }
        h.servers.push(s)
        h.setLock(lockFor(s))
        h.setService(777)
      }
      return r
    }
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(true)
    expect(h.execs).toContain('launchctl bootstrap gui/501 /Users/me/Library/LaunchAgents/com.makinbakin.bakin.plist')
  })

  it('an ambiguous service home (two BAKIN_HOME values) is never treated as this home\'s (J r4 #3)', async () => {
    const h = harness({ plist: '<key>BAKIN_HOME</key>\n<string>/home/me/.bakin</string>\n<key>BAKIN_HOME</key>\n<string>/other</string>' })
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(true)
    expect(h.execs.some((e) => e.includes('bootstrap'))).toBe(false)
  })

  it('a service restart is proved only by the MANAGER\'s pid — a manual starter winning the home fails it (K r1 #6)', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me] })
    h.setService(500)
    const exec = h.io.exec
    h.io.exec = (cmd, args) => {
      const r = exec(cmd, args)
      if (args[0] === 'kickstart') {
        me.alive = false
        const interloper = { ...mine, pid: 8080, bootId: 'boot-X', secret: 'x' }
        h.servers.push(interloper)
        h.setLock(lockFor(interloper))
        h.setService(null) // the service's own replacement lost the lock and exited
      }
      return r
    }
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(false)
    expect(out.message).toContain('pid 8080')
  })

  it('a running service job that holds no lock for this home is unproven → no restart, nothing spawned (K r1 #3)', async () => {
    const h = harness()
    h.setService(4242)
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(false)
    expect(h.execs.some((e) => e.includes('kickstart') || e.includes('bootstrap'))).toBe(false)
    expect(h.spawns).toEqual([])
  })

  it('an old-protocol server is driven through a service only when the job is configured for THIS home (K r1 #2)', async () => {
    const me = fresh({ protocol: 'old' })
    const h = harness({ lock: lockFor(me), servers: [me] })
    h.setService(500, '/other/home')
    const restarted = await restartHome(h.io, { baseEnv: {} })
    expect(restarted.ok).toBe(false)
    const stopped = await stopHome(h.io)
    expect(stopped.ok).toBe(false)
    expect(h.execs.some((e) => e.includes('kickstart') || e.includes('bootout'))).toBe(false)
  })

  it('a successor that takes the home as the old server exits is reconciled with — no competing spawn (K r1 #8)', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me] })
    const http = h.io.http
    h.io.http = async (method, port, path, o) => {
      const r = await http(method, port, path, o)
      if (path === '/api/server/shutdown') {
        queueMicrotask(() => {
          const successor = { ...mine, pid: 6060, bootId: 'boot-Z', secret: 'z' }
          h.servers.push(successor)
          h.setLock(lockFor(successor))
        })
      }
      return r
    }
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out).toMatchObject({ ok: true, status: 'warn', boot: { pid: 6060 } })
    expect(h.spawns).toEqual([])
  })

  it('a pending restart child refuses restart even while the old server still answers (K r1 #9); --force overrides', async () => {
    const me = fresh()
    const child = { pid: 3030, command: 'bun server.ts __bakin-restart-child 500' }
    const h = harness({ lock: lockFor(me), servers: [me], processes: [child] })
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(false)
    expect(h.shutdownRequests).toEqual([])
    const forced = await restartHome(h.io, { baseEnv: {}, force: true })
    expect(forced.ok).toBe(true)
  })

  it('a dev coordinator running the current server does not block its restart', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], processes: [{ pid: 3131, command: 'bun scripts/dev.ts' }] })
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(true)
  })
})

describe('stop — fail closed on what it cannot see', () => {
  it('an unreadable service state stops nothing (a KeepAlive job could respawn it) (K r1 #5)', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], plist: '<key>BAKIN_HOME</key>\n<string>/home/me/.bakin</string>', launchctl: { ok: false, output: 'launchctl: internal error' } })
    const out = await stopHome(h.io)
    expect(out.ok).toBe(false)
    expect(h.shutdownRequests).toEqual([])
    expect(me.alive).toBe(true)
  })

  it('a replacement taking the home right after the stop is reported, never "stopped" (K r1 #5)', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me] })
    const http = h.io.http
    h.io.http = async (method, port, path, o) => {
      const r = await http(method, port, path, o)
      if (path === '/api/server/shutdown') {
        queueMicrotask(() => {
          const respawn = { ...mine, pid: 7070, bootId: 'boot-R', secret: 'r' }
          h.servers.push(respawn)
          h.setLock(lockFor(respawn))
        })
      }
      return r
    }
    const out = await stopHome(h.io)
    expect(out.ok).toBe(false)
    expect(out.message).toContain('pid 7070')
  })
})

describe('service state — read only what is unambiguous (K r2)', () => {
  it('launchd: the job\'s own environment block, never `inherited environment`', () => {
    const h = harness({
      launchctl: { ok: true, output: 'gui/501/com.makinbakin.bakin = {\n\tinherited environment = {\n\t\tBAKIN_HOME => /other/home\n\t}\n\tenvironment = {\n\t\tBAKIN_HOME => /home/me/.bakin\n\t}\n\tstate = not running\n}' },
    })
    expect(readServiceState(h.io)).toEqual({ kind: 'loaded', pid: null, idle: true, home: '/home/me/.bakin' })
  })

  it('launchd: a job mid-spawn is not idle', () => {
    const h = harness({ launchctl: { ok: true, output: 'x = {\n\tenvironment = {\n\t\tBAKIN_HOME => /home/me/.bakin\n\t}\n\tstate = spawn scheduled\n}' } })
    expect(readServiceState(h.io)).toMatchObject({ kind: 'loaded', pid: null, idle: false })
  })

  it('systemd: an EnvironmentFile makes the home unknowable; `activating` is not idle', () => {
    const h = harness({ platform: 'linux' })
    h.io.exec = () => ({ ok: true, output: 'LoadState=loaded\nActiveState=activating\nMainPID=0\nEnvironment=BAKIN_HOME=/home/me/.bakin\nEnvironmentFiles=/home/me/.bakin.env (ignore_errors=no)\n' })
    expect(readServiceState(h.io)).toEqual({ kind: 'loaded', pid: null, idle: false, home: null })
  })

  it('no unit installed + no reachable manager (Docker/CI) is absent, not unknown', () => {
    const h = harness({ platform: 'linux' })
    h.io.exec = () => ({ ok: false, output: 'Failed to connect to bus: No such file or directory' })
    expect(readServiceState(h.io)).toEqual({ kind: 'absent' })
  })
})

describe('K r2 — fail closed', () => {
  it('restart with nothing running refuses when an installed service\'s state is unreadable (it may be starting)', async () => {
    const h = harness({ plist: '<key>BAKIN_HOME</key>\n<string>/home/me/.bakin</string>', launchctl: { ok: false, output: 'launchctl: internal error' } })
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(false)
    expect(h.spawns).toEqual([])
  })

  it('restart never interrupts this home\'s service while it is starting', async () => {
    const h = harness({ launchctl: { ok: true, output: 'x = {\n\tenvironment = {\n\t\tBAKIN_HOME => /home/me/.bakin\n\t}\n\tstate = spawn scheduled\n}' } })
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(false)
    expect(h.execs.some((e) => e.includes('kickstart'))).toBe(false)
    expect(h.spawns).toEqual([])
  })

  it('stop refuses while a restart child waits for this server to exit (it would start it again)', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], processes: [{ pid: 3030, command: 'bun server.ts __bakin-restart-child 500' }] })
    const out = await stopHome(h.io)
    expect(out.ok).toBe(false)
    expect(h.shutdownRequests).toEqual([])
    expect(me.alive).toBe(true)
  })
})

describe('K r3', () => {
  it('launchd output without a single state, or running without a pid, is unknown — stop then touches nothing', async () => {
    for (const output of ['x = {\n\tstate = running\n}', 'x = {\n\tpid = 500\n}']) {
      const me = fresh()
      const h = harness({ lock: lockFor(me), servers: [me], launchctl: { ok: true, output } })
      expect(readServiceState(h.io).kind).toBe('unknown')
      const out = await stopHome(h.io)
      expect(out.ok).toBe(false)
      expect(h.shutdownRequests).toEqual([])
    }
  })

  it('a failing manager query is unknown even with no unit file on disk (a loaded job outlives its plist)', () => {
    const h = harness({ launchctl: { ok: false, output: 'launchctl: internal error' } })
    expect(readServiceState(h.io).kind).toBe('unknown')
  })

  it('systemd active without a main pid is unknown', () => {
    const h = harness({ platform: 'linux' })
    h.io.exec = () => ({ ok: true, output: 'LoadState=loaded\nActiveState=active\nMainPID=0\nEnvironment=BAKIN_HOME=/home/me/.bakin\nEnvironmentFiles=\n' })
    expect(readServiceState(h.io).kind).toBe('unknown')
  })

  it('stopping an old-protocol service judges the generation captured BEFORE the bootout (a fast successor is reported)', async () => {
    const me = fresh({ protocol: 'old' })
    const h = harness({ lock: lockFor(me), servers: [me] })
    h.setService(500)
    const exec = h.io.exec
    h.io.exec = (cmd, args) => {
      const r = exec(cmd, args)
      if (args[0] === 'bootout') {
        me.alive = false
        const successor = { ...mine, pid: 9191, bootId: 'boot-N', secret: 'n', answers: false }
        h.servers.push(successor)
        h.setLock(lockFor(successor))
      }
      return r
    }
    const out = await stopHome(h.io)
    expect(out.ok).toBe(false)
    expect(out.message).toContain('pid 9191')
  })
})

describe('K r4', () => {
  it('a holder that dies while asked, replaced by a successor, is never reported as "no server" (stop asks the successor)', async () => {
    const a = fresh({ answers: false })
    const b = fresh({ pid: 5151, bootId: 'boot-B', secret: 'secret-B' })
    const h = harness({ lock: lockFor(a), servers: [a] })
    const http = h.io.http
    let swapped = false
    h.io.http = async (method, port, path, o) => {
      if (!swapped && path === '/api/version') {
        swapped = true
        a.alive = false
        h.servers.push(b)
        h.setLock(lockFor(b))
        return null
      }
      return http(method, port, path, o)
    }
    const out = await stopHome(h.io)
    expect(out.ok).toBe(true)
    expect(h.shutdownRequests).toEqual([{ port: 3737, secret: 'secret-B', bootId: 'boot-B' }])
  })

  it('systemd "Permission denied" on the bus is unknown (a manager may be running), never absent', () => {
    const h = harness({ platform: 'linux' })
    h.io.exec = () => ({ ok: false, output: 'Failed to connect to bus: Permission denied' })
    expect(readServiceState(h.io).kind).toBe('unknown')
    h.io.exec = () => ({ ok: false, output: 'Failed to connect to bus: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined' })
    expect(readServiceState(h.io).kind).toBe('absent')
  })
})

describe('K r5', () => {
  it('a server started by a finished restart child (it keeps that argv) is not a pending start', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], processes: [{ pid: 500, command: 'bun server.ts __bakin-restart-child 400' }] })
    expect((await restartHome(h.io, { baseEnv: {} })).ok).toBe(true)
    const h2 = harness({ lock: lockFor(me), servers: [fresh()], processes: [{ pid: 500, command: 'bun server.ts __bakin-restart-child 400' }] })
    expect((await stopHome(h2.io)).ok).toBe(true)
  })

  it('stop with no lock holder while this home\'s service is starting is not "stopped"', async () => {
    const h = harness({ launchctl: { ok: true, output: 'x = {\n\tenvironment = {\n\t\tBAKIN_HOME => /home/me/.bakin\n\t}\n\tstate = spawn scheduled\n}' } })
    const out = await stopHome(h.io)
    expect(out.ok).toBe(false)
  })

  it('stop with no lock holder and an idle or other-home service is a plain "no server"', async () => {
    const idle = harness({ launchctl: { ok: true, output: 'x = {\n\tenvironment = {\n\t\tBAKIN_HOME => /home/me/.bakin\n\t}\n\tstate = not running\n}' } })
    expect((await stopHome(idle.io)).ok).toBe(true)
    const other = harness({ launchctl: { ok: true, output: 'x = {\n\tstate = running\n\tpid = 4242\n\tenvironment = {\n\t\tBAKIN_HOME => /other/home\n\t}\n}' } })
    expect((await stopHome(other.io)).ok).toBe(true)
  })
})

describe('K r6', () => {
  // Captured from a real `launchctl print` of a running LaunchAgent (sanitized): it
  // carries nested coalition blocks with their own `state = active`.
  const captured = readFileSync(join(import.meta.dir, '../fixtures/lifecycle/launchctl-print-running.txt'), 'utf-8')

  it('a real running job parses to its own pid/state/home — nested coalition states are ignored', () => {
    const h = harness({ launchctl: { ok: true, output: captured } })
    expect(readServiceState(h.io)).toEqual({ kind: 'loaded', pid: 500, idle: false, home: '/home/me/.bakin' })
  })

  it('a real service-managed server is stopped through the service', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], launchctl: { ok: true, output: captured } })
    const exec = h.io.exec
    h.io.exec = (cmd, args) => { if (args[0] === 'bootout') me.alive = false; return exec(cmd, args) }
    const out = await stopHome(h.io)
    expect(out.ok).toBe(true)
    expect(h.execs).toContain('launchctl bootout gui/501/com.makinbakin.bakin')
  })

  it('systemd UnsetEnvironment makes the home unknowable (it is applied after Environment=)', () => {
    const h = harness({ platform: 'linux' })
    h.io.exec = () => ({ ok: true, output: 'LoadState=loaded\nActiveState=active\nMainPID=500\nEnvironment=BAKIN_HOME=/home/me/.bakin\nEnvironmentFiles=\nUnsetEnvironment=BAKIN_HOME\n' })
    expect(readServiceState(h.io)).toMatchObject({ kind: 'loaded', pid: 500, home: null })
  })
})

describe('K r7', () => {
  it('another home\'s FINISHED restart child (its parent is gone) never blocks this home\'s stop', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], processes: [{ pid: 700, command: 'bun server.ts __bakin-restart-child 400' }] })
    expect((await stopHome(h.io)).ok).toBe(true)
  })

  it('a failed process listing is unknown: stop and restart refuse (restart --force overrides)', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me], psFails: true })
    expect((await stopHome(h.io)).ok).toBe(false)
    expect((await restartHome(h.io, { baseEnv: {} })).ok).toBe(false)
    expect(h.shutdownRequests).toEqual([])
    expect((await restartHome(h.io, { baseEnv: {}, force: true })).ok).toBe(true)
  })

  it('a service that changes between the ownership check and the command is not driven', async () => {
    const me = fresh()
    const h = harness({ lock: lockFor(me), servers: [me] })
    h.setService(500)
    const exec = h.io.exec
    let prints = 0
    h.io.exec = (cmd, args) => {
      if (args[0] === 'print' && ++prints === 2) h.setService(4242, '/other/home') // setup swapped the job meanwhile
      return exec(cmd, args)
    }
    const out = await restartHome(h.io, { baseEnv: {} })
    expect(out.ok).toBe(false)
    expect(h.execs.some((e) => e.includes('kickstart'))).toBe(false)
  })
})

