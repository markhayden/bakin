/**
 * The real `LifecycleIo` (#898 K): every side effect `lifecycle-control.ts`
 * may take, in one place. Requests go to 127.0.0.1 only and never follow
 * redirects; service commands never throw (the controller reads `ok`).
 */
import { execFileSync, spawn } from 'child_process'
import { existsSync, readFileSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { getContentDir } from '../core/content-dir'
import { readServerLock } from '../core/server-lock'
import { SERVICE_LABEL, type LifecycleIo, type ProcessInfo } from './lifecycle-control'

/** This home, absolute and canonical — frozen before anything changes directory. */
export function canonicalHome(): string {
  const home = resolve(getContentDir())
  try {
    return realpathSync(home)
  } catch {
    return home // not created yet: the resolved absolute path is the identity
  }
}

export async function realLifecycleIo(launch: () => Promise<{ programArgs: string[]; workingDir: string }>): Promise<LifecycleIo> {
  const home = canonicalHome()
  const spec = await launch()
  return {
    platform: process.platform,
    home,
    selfPid: process.pid,
    readLock: () => {
      const lock = readServerLock()
      return lock ? { pid: lock.pid, port: lock.port, bootId: lock.bootId, ...(lock.cliSecret ? { cliSecret: lock.cliSecret } : {}) } : null
    },
    pidAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (err) {
        return (err as { code?: string }).code === 'EPERM'
      }
    },
    http: async (method, port, path, opts = {}) => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          redirect: 'manual',
          headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers ?? {}) },
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 1500),
        })
        let body: unknown = null
        try {
          body = await res.json()
        } catch {
          body = null // a non-JSON answer is not this protocol
        }
        return { status: res.status, body }
      } catch {
        return null // refused / timed out: no answer
      }
    },
    listProcesses: () => {
      try {
        const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
        const procs: ProcessInfo[] = []
        for (const line of out.split('\n')) {
          const m = /^\s*(\d+)\s+(.*)$/.exec(line)
          if (m) procs.push({ pid: Number(m[1]), command: m[2]! })
        }
        return procs
      } catch {
        return [] // discovery is best-effort and only ever used for reports
      }
    },
    exec: (cmd, args) => {
      try {
        const output = execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
        return { ok: true, output }
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string }
        return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` || (e.message ?? '') }
      }
    },
    uid: () => String(process.getuid?.() ?? execFileSync('id', ['-u'], { encoding: 'utf-8' }).trim()),
    readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf-8') : null),
    launchAgentPath: () => join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`),
    systemdUnitPath: () => join(homedir(), '.config', 'systemd', 'user', `${SERVICE_LABEL}.service`),
    spawnServer: (env) => {
      let exited = false
      let error: string | null = null
      try {
        const child = spawn(spec.programArgs[0]!, spec.programArgs.slice(1), {
          cwd: spec.workingDir,
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore'],
          env: { ...process.env, ...env },
        })
        child.on('exit', () => { exited = true })
        child.on('error', (err) => { exited = true; error = err.message })
        child.unref()
        return { pid: child.pid ?? null, exitedEarly: () => exited, error: () => error }
      } catch (err) {
        return { pid: null, exitedEarly: () => true, error: () => (err instanceof Error ? err.message : String(err)) }
      }
    },
    now: () => performance.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }
}
