/**
 * Home-scoped `bakin stop` / `bakin restart` (#898 K — spec
 * `.claude/specs/lifecycle-home-scope.md`, owner-confirmed 2026-10-19).
 *
 * The rules, each a consequence of the review that killed `pgrep`-and-kill:
 *   - Identity is the server's OWN answer: this home's `server.lock` names a
 *     port; `GET /api/version` there must answer the lock's pid AND bootId.
 *   - The CLI never signals a pid. A server is stopped by REQUEST
 *     (`POST /api/server/shutdown` with the lock's per-boot secret + bootId,
 *     checked by the server against itself), or by its owning service
 *     manager — and a service owns this home's server only when the
 *     manager's pid IS the pid that just proved its identity.
 *   - Wedged (alive, no answer), foreign (another generation answers) and
 *     unprovable states FAIL CLOSED: reported, non-zero, nothing touched.
 *   - A restart proves a NEW boot (and, for a spawn, the pid it spawned)
 *     before reporting success; a pending start (dev build, restart child)
 *     is reported and never raced.
 * Every side effect goes through `LifecycleIo`, so tests can prove nothing
 * real is ever signalled or controlled.
 */

import { BAKIN_SERVICE_LABEL, parseLaunchctlPid, parseSystemdMainPid } from '../core/service-manager'

export const SERVICE_LABEL = BAKIN_SERVICE_LABEL
/** Monotonic deadline for a handoff (shutdown, manager restart, startup). */
export const HANDOFF_BUDGET_MS = 20_000
/** How long a lock holder may take to start answering before it is called wedged. */
const IDENTITY_GRACE_MS = 5_000
const POLL_MS = 250
const FETCH_TIMEOUT_MS = 1_500

export interface LockInfo {
  pid: number
  port: number
  bootId: string
  cliSecret?: string
}

export interface ProcessInfo {
  pid: number
  command: string
}

export interface HttpAnswer {
  status: number
  body: unknown
}

export interface LifecycleIo {
  platform: string
  /** This home, absolute and canonical. */
  home: string
  selfPid: number
  readLock(): LockInfo | null
  pidAlive(pid: number): boolean
  /** One bounded request to 127.0.0.1; null on any network error/timeout. Never follows redirects. */
  http(method: 'GET' | 'POST', port: number, path: string, opts?: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number }): Promise<HttpAnswer | null>
  /** Every process on the machine; null when discovery failed (unknown — never "none"). */
  listProcesses(): ProcessInfo[] | null
  /** A service-manager command; never throws. */
  exec(cmd: string, args: string[]): { ok: boolean; output: string }
  uid(): string
  readFile(path: string): string | null
  launchAgentPath(): string
  systemdUnitPath(): string
  /** Start a detached server with this env; reports early exit. */
  spawnServer(env: Record<string, string>): { pid: number | null; exitedEarly: () => boolean; error: () => string | null }
  now(): number
  sleep(ms: number): Promise<void>
}

// ─── Identity ────────────────────────────────────────────────────────────────

export type Identity =
  | { kind: 'none' }
  | { kind: 'owned'; pid: number; bootId: string; port: number; state: string; secret?: string }
  | { kind: 'old-protocol'; pid: number; port: number }
  | { kind: 'wedged'; pid: number; port: number }
  | { kind: 'foreign'; lockPid: number; port: number; answeredPid: number | null }

interface VersionAnswer { pid: number; bootId: string; state: string }

function parseVersion(answer: HttpAnswer | null): VersionAnswer | 'old' | null {
  if (!answer || answer.status !== 200 || typeof answer.body !== 'object' || answer.body === null) return null
  const body = answer.body as Record<string, unknown>
  if (body.pid === undefined && body.bootId === undefined) return typeof body.version === 'string' ? 'old' : null
  if (!Number.isInteger(body.pid) || (body.pid as number) <= 0) return null
  if (typeof body.bootId !== 'string' || body.bootId.length === 0) return null
  return { pid: body.pid as number, bootId: body.bootId, state: typeof body.state === 'string' ? body.state : 'unknown' }
}

export async function askVersion(io: LifecycleIo, port: number): Promise<VersionAnswer | 'old' | null> {
  return parseVersion(await io.http('GET', port, '/api/version', { timeoutMs: FETCH_TIMEOUT_MS }))
}

/**
 * This home's server, proved by its own answer. A live lock holder that does
 * not answer yet is given a short grace (it may be starting) before it is
 * called wedged.
 */
export async function resolveIdentity(io: LifecycleIo): Promise<Identity> {
  // A holder that dies while we ask may already have a successor in the lock:
  // "none" only when the lock itself shows no live holder.
  for (let attempt = 0; attempt < IDENTITY_ATTEMPTS; attempt++) {
    const lock = io.readLock()
    if (!lock || !io.pidAlive(lock.pid)) {
      const again = io.readLock()
      if (!again || (again.bootId === lock?.bootId && !io.pidAlive(again.pid))) return { kind: 'none' }
      continue
    }
    const identity = await identityOf(io, lock)
    if (identity.kind !== 'none') return identity
  }
  // The home kept changing hands while we looked: report it, touch nothing.
  const lock = io.readLock()
  return lock && io.pidAlive(lock.pid) ? { kind: 'wedged', pid: lock.pid, port: lock.port } : { kind: 'none' }
}

const IDENTITY_ATTEMPTS = 3

async function identityOf(io: LifecycleIo, lock: LockInfo): Promise<Identity> {
  if (!Number.isInteger(lock.port) || lock.port <= 0) return { kind: 'wedged', pid: lock.pid, port: 0 }
  const deadline = io.now() + IDENTITY_GRACE_MS
  for (;;) {
    const answer = await askVersion(io, lock.port)
    if (answer === 'old') return { kind: 'old-protocol', pid: lock.pid, port: lock.port }
    if (answer) {
      if (answer.pid === lock.pid && answer.bootId === lock.bootId) {
        return { kind: 'owned', pid: lock.pid, bootId: lock.bootId, port: lock.port, state: answer.state, ...(lock.cliSecret ? { secret: lock.cliSecret } : {}) }
      }
      // The home changed hands while we asked: the caller re-reads the lock.
      if (io.readLock()?.bootId !== lock.bootId) return { kind: 'none' }
      return { kind: 'foreign', lockPid: lock.pid, port: lock.port, answeredPid: answer.pid }
    }
    if (io.now() >= deadline || !io.pidAlive(lock.pid)) break
    await io.sleep(POLL_MS)
  }
  // Died during the grace: the caller re-reads the lock for a successor.
  if (!io.pidAlive(lock.pid)) return { kind: 'none' }
  return { kind: 'wedged', pid: lock.pid, port: lock.port }
}

// ─── Service (the LOADED job, never just the file) ───────────────────────────

export type ServiceState =
  | { kind: 'absent' }
  /** Installed on disk but not loaded; `home` from the file (config for the NEXT launch only). */
  | { kind: 'unloaded'; home: string | null }
  /**
   * Loaded; `pid` null when not running. `idle` only when the manager says
   * plainly that nothing is starting (a job mid-spawn / `activating` is NOT
   * idle). `home` from the loaded job's environment (null = unknown or
   * overridable, e.g. a systemd EnvironmentFile).
   */
  | { kind: 'loaded'; pid: number | null; idle: boolean; home: string | null }
  | { kind: 'unknown'; reason: string }

function single(values: string[]): string | null {
  return values.length === 1 && values[0] && !/["'\\]/.test(values[0]) ? values[0] : null
}

export function readServiceState(io: LifecycleIo): ServiceState {
  if (io.platform === 'darwin') {
    const plist = io.readFile(io.launchAgentPath())
    const plistHome = plist ? single([...plist.matchAll(/<key>BAKIN_HOME<\/key>\s*<string>([^<]*)<\/string>/g)].map((m) => m[1]!)) : null
    const printed = io.exec('launchctl', ['print', `gui/${io.uid()}/${SERVICE_LABEL}`])
    if (!printed.ok) {
      // Not loaded (launchctl exits non-zero for an unknown service).
      if (/could not find service|not find/i.test(printed.output) || printed.output.trim() === '') {
        return plist ? { kind: 'unloaded', home: plistHome } : { kind: 'absent' }
      }
      return { kind: 'unknown', reason: `launchctl print failed: ${printed.output.trim().slice(0, 200)}` }
    }
    // `launchctl print` is not an API: read only what is unambiguous, and only
    // the JOB's own top-level keys (exactly one tab deep) — nested blocks such
    // as resource/jetsam coalitions carry their own `state = active`.
    const pids = [...printed.output.matchAll(/^\tpid = (\d+)\s*$/gm)]
    if (pids.length > 1) return { kind: 'unknown', reason: 'launchctl print reported more than one pid' }
    // The job's OWN `environment = {` block — never `inherited environment` / `default environment`.
    const envBlocks = [...printed.output.matchAll(/^\tenvironment = \{\n([\s\S]*?)\n\t\}/gm)].map((m) => m[1]!)
    const homes = envBlocks.length === 1 ? [...envBlocks[0]!.matchAll(/^\s*BAKIN_HOME => (.+?)\s*$/gm)].map((m) => m[1]!) : []
    const states = [...printed.output.matchAll(/^\tstate = (.+?)\s*$/gm)].map((m) => m[1]!)
    const pid = parseLaunchctlPid(printed.output)
    // An unsupported or truncated layout (no single state, or running without a pid) is unknown.
    if (states.length !== 1) return { kind: 'unknown', reason: 'launchctl print reported no single job state' }
    if (pid === null && states[0] === 'running') return { kind: 'unknown', reason: 'launchctl print reported a running job without a pid' }
    return { kind: 'loaded', pid, idle: pid === null && states[0] === 'not running', home: single(homes) }
  }
  if (io.platform === 'linux') {
    const unit = io.readFile(io.systemdUnitPath())
    const shown = io.exec('systemctl', ['--user', 'show', `${SERVICE_LABEL}.service`, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'Environment', '-p', 'EnvironmentFiles', '-p', 'UnsetEnvironment'])
    if (!shown.ok) {
      // No user manager at all (Docker/CI): nothing can be running under it.
      if (NO_USER_MANAGER.test(shown.output)) return { kind: 'absent' }
      return { kind: 'unknown', reason: `systemctl show failed: ${shown.output.trim().slice(0, 200)}` }
    }
    const prop = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(shown.output)?.[1] ?? ''
    const load = prop('LoadState')
    const unitHome = (text: string) => (/^(EnvironmentFile|UnsetEnvironment)=/m.test(text) ? null : single([...text.matchAll(/^Environment="?BAKIN_HOME=([^"\n]*)"?$/gm)].map((m) => m[1]!)))
    if (load === 'not-found' || load === '') {
      return unit ? { kind: 'unloaded', home: unitHome(unit) } : { kind: 'absent' }
    }
    // An EnvironmentFile can override Environment= and UnsetEnvironment= removes
    // from it (applied last): either makes the effective home unknowable here.
    const homes = prop('EnvironmentFiles').trim() || prop('UnsetEnvironment').trim() ? [] : [...prop('Environment').matchAll(/(?:^|\s)BAKIN_HOME=(\S+)/g)].map((m) => m[1]!)
    const pid = parseSystemdMainPid(shown.output)
    const active = prop('ActiveState')
    if (pid === null && (active === 'active' || active === 'reloading')) return { kind: 'unknown', reason: `systemd reports ${active} without a main pid` }
    return { kind: 'loaded', pid, idle: pid === null && (active === 'inactive' || active === 'failed'), home: single(homes) }
  }
  return { kind: 'absent' }
}

/** systemctl's own words when there is no user manager to ask (containers, CI, no systemd). */
// Never a bare "Failed to connect to bus": `Permission denied` there can hide a RUNNING user manager.
const NO_USER_MANAGER = /Failed to connect to bus: (No such file or directory|No medium found|\$DBUS_SESSION_BUS_ADDRESS and \$XDG_RUNTIME_DIR not defined)|System has not been booted with systemd|spawnSync systemctl ENOENT/

function stopServiceCommand(io: LifecycleIo): [string, string[]] {
  return io.platform === 'darwin'
    ? ['launchctl', ['bootout', `gui/${io.uid()}/${SERVICE_LABEL}`]]
    : ['systemctl', ['--user', 'stop', `${SERVICE_LABEL}.service`]]
}

function restartServiceCommands(io: LifecycleIo, state: ServiceState): Array<[string, string[]]> {
  if (io.platform === 'darwin') {
    const kick: [string, string[]] = ['launchctl', ['kickstart', '-k', `gui/${io.uid()}/${SERVICE_LABEL}`]]
    return state.kind === 'unloaded' ? [['launchctl', ['bootstrap', `gui/${io.uid()}`, io.launchAgentPath()]], kick] : [kick]
  }
  return [['systemctl', ['--user', 'restart', `${SERVICE_LABEL}.service`]]]
}

// ─── Pending starts + other servers (reported, never touched) ────────────────

const SERVER_LIKE = /(server\.ts\b.*\bserve\b|\bbakin\b.*\b(start|serve)\b|__bakin-restart-child|scripts\/dev\.ts)/

const RESTART_CHILD = /__bakin-restart-child(?:\s+(\d+))?/

/**
 * Starts that may already be on their way; null when processes can't be
 * listed (callers fail closed). A restart child (`__bakin-restart-child
 * <parentPid>`, spawned by a server's own /api/restart) keeps that argv for
 * life, so it is judged by its PARENT:
 *   - `waitingFor` a running server: only children whose parent IS that server
 *     (they would start it again the moment it exits);
 *   - no server here: children whose parent is gone (starting now — or a
 *     finished child serving some home, which can't be told apart; restart
 *     has --force) and dev coordinators.
 */
export function pendingStarts(io: LifecycleIo, opts: { exclude: number[]; waitingFor?: number }): ProcessInfo[] | null {
  const procs = io.listProcesses()
  if (procs === null) return null
  return procs.filter((p) => {
    if (opts.exclude.includes(p.pid)) return false
    const child = RESTART_CHILD.exec(p.command)
    if (child) {
      const parent = child[1] ? Number(child[1]) : null
      if (opts.waitingFor !== undefined) return parent === null || parent === opts.waitingFor
      return parent === null || !io.pidAlive(parent)
    }
    return opts.waitingFor === undefined && /scripts\/dev\.ts/.test(p.command)
  })
}

export function otherServers(io: LifecycleIo, exclude: number[]): ProcessInfo[] {
  // Reports only: a failed listing just reports nothing.
  return (io.listProcesses() ?? []).filter((p) => !exclude.includes(p.pid) && SERVER_LIKE.test(p.command) && !/__bakin-restart-child|scripts\/dev\.ts/.test(p.command))
}

/** The manager must still report exactly what ownership was judged on before Bakin drives it. */
function serviceUnchanged(io: LifecycleIo, judged: ServiceState): boolean {
  const now = readServiceState(io)
  if (now.kind !== judged.kind) return false
  if (now.kind === 'loaded' && judged.kind === 'loaded') return now.pid === judged.pid && now.home === judged.home && now.idle === judged.idle
  if (now.kind === 'unloaded' && judged.kind === 'unloaded') return now.home === judged.home
  return true
}

const SERVICE_CHANGED: LifecycleOutcome = {
  ok: false,
  status: 'error',
  message: 'The Bakin service changed while Bakin was checking it, so it was not touched.',
  notes: ['Something else is managing the service right now (setup, another bakin command). Run the command again once it settles.'],
}

// ─── Outcomes ────────────────────────────────────────────────────────────────

export interface LifecycleOutcome {
  ok: boolean
  status: 'ok' | 'warn' | 'error'
  message: string
  /** Every diagnostic — printed in BOTH output modes. */
  notes: string[]
  /** For restart: the proven new boot. */
  boot?: { pid: number; bootId: string; version?: string }
}

function refusal(identity: Identity): LifecycleOutcome | null {
  switch (identity.kind) {
    case 'wedged':
      return {
        ok: false,
        status: 'error',
        message: `This home's lock records Bakin pid ${identity.pid}${identity.port ? ` on port ${identity.port}` : ''}, but it is not answering, so Bakin cannot prove it is this home's server and will not touch it.`,
        notes: [`Inspect it before doing anything (e.g. ps -p ${identity.pid} -o pid,lstart,command); if it is this home's wedged server, stop it yourself, then run the command again.`],
      }
    case 'foreign':
      return {
        ok: false,
        status: 'error',
        message: `Port ${identity.port} answers as a different Bakin generation${identity.answeredPid ? ` (pid ${identity.answeredPid})` : ''} than this home's lock records (pid ${identity.lockPid}). Bakin will not stop either.`,
        notes: ['Another home may be on that port. Check which Bakin you meant (BAKIN_HOME) and stop it from that home.'],
      }
    default:
      return null
  }
}

/**
 * Await the end of one generation: no answer from that boot AND its lock
 * released/replaced (or its pid gone). `successor` is a live lock holder of a
 * DIFFERENT generation already in this home's lock when it went — a respawn or
 * a start that raced us — which the caller must never treat as "stopped" nor
 * launch a competitor beside.
 */
async function awaitGenerationGone(io: LifecycleIo, gen: { pid: number; bootId: string; port: number }, deadline: number): Promise<{ gone: false } | { gone: true; successor: LockInfo | null }> {
  for (;;) {
    const answer = await askVersion(io, gen.port)
    const stillAnswering = answer !== null && answer !== 'old' && answer.bootId === gen.bootId
    if (!stillAnswering) {
      const lock = io.readLock()
      if (!lock || lock.bootId !== gen.bootId || !io.pidAlive(gen.pid)) {
        const successor = lock && lock.bootId !== gen.bootId && io.pidAlive(lock.pid) ? lock : null
        return { gone: true, successor }
      }
    }
    if (io.now() >= deadline) return { gone: false }
    await io.sleep(POLL_MS)
  }
}

function stoppedOutcome(io: LifecycleIo, gone: { gone: false } | { gone: true; successor: LockInfo | null }, pid: number, notes: string[]): LifecycleOutcome {
  if (!gone.gone) return { ok: false, status: 'error', message: `Bakin (pid ${pid}) is still shutting down after 20s.`, notes }
  if (gone.successor) {
    return {
      ok: false,
      status: 'error',
      message: `The server stopped, but another Bakin (pid ${gone.successor.pid}) took this home straight away — a service manager or another start may own it.`,
      notes: [...notes, 'Check `bakin status`; if a service respawned it, `bakin stop` again stops the service.'],
    }
  }
  return { ok: true, status: 'ok', message: 'Bakin stopped.', notes: [...notes, ...othersNote(io, [io.selfPid])] }
}

/** Await a NEW boot for this home: lock + own answer agree, state serving, and (when given) the pid we started. */
async function awaitNewBoot(io: LifecycleIo, oldBootId: string | null, deadline: number, expect: { pid?: number | null; spawned?: ReturnType<LifecycleIo['spawnServer']>; service?: boolean }): Promise<LifecycleOutcome['boot'] | { failed: string } | null> {
  let notTheService: number | null = null
  for (;;) {
    if (expect.spawned?.exitedEarly()) return { failed: `the new server exited during startup${expect.spawned.error() ? `: ${expect.spawned.error()}` : ''}` }
    const lock = io.readLock()
    if (lock && lock.bootId && lock.bootId !== oldBootId && io.pidAlive(lock.pid) && lock.port > 0) {
      const raw = await io.http('GET', lock.port, '/api/version', { timeoutMs: FETCH_TIMEOUT_MS })
      const answer = parseVersion(raw)
      if (answer && answer !== 'old' && answer.pid === lock.pid && answer.bootId === lock.bootId && answer.state === 'serving') {
        if (expect.pid && answer.pid !== expect.pid) return { failed: `a different server (pid ${answer.pid}) took this home instead of the one just started (pid ${expect.pid})` }
        // A service restart is proved only by the MANAGER's own pid answering.
        const service = expect.service ? readServiceState(io) : null
        if (!service || (service.kind === 'loaded' && service.pid === answer.pid)) {
          const version = typeof (raw?.body as { version?: unknown })?.version === 'string' ? (raw!.body as { version: string }).version : undefined
          return { pid: answer.pid, bootId: answer.bootId, ...(version ? { version } : {}) }
        }
        notTheService = answer.pid
      }
    }
    if (io.now() >= deadline) return notTheService !== null ? { failed: `a server that is not the service's (pid ${notTheService}) took this home` } : null
    await io.sleep(POLL_MS)
  }
}

function othersNote(io: LifecycleIo, exclude: number[]): string[] {
  const others = otherServers(io, exclude)
  return others.length === 0 ? [] : [`Other Bakin processes on this machine were left alone (not this home's, or not provably so): ${others.map((p) => `pid ${p.pid}`).join(', ')}.`]
}

// ─── stop ────────────────────────────────────────────────────────────────────

export async function stopHome(io: LifecycleIo): Promise<LifecycleOutcome> {
  const identity = await resolveIdentity(io)
  const refused = refusal(identity)
  if (refused) return { ...refused, notes: [...refused.notes, ...othersNote(io, [io.selfPid])] }

  if (identity.kind === 'none') {
    // No lock holder — but a service that is starting (or unreadable) may be
    // about to bring this home back: never call that "stopped".
    const service = readServiceState(io)
    const serviceMayStart = service.kind === 'unknown' || (service.kind === 'loaded' && !service.idle && (service.home === null || service.home === io.home))
    if (serviceMayStart) {
      return {
        ok: false,
        status: 'error',
        message: service.kind === 'unknown'
          ? `No Bakin holds this home's lock, but the Bakin service state could not be read (${service.reason}), so Bakin can't tell whether it is about to start one.`
          : `No Bakin holds this home's lock, but the Bakin service is ${service.kind === 'loaded' && service.pid !== null ? `running pid ${service.pid}` : 'starting'} — it may be about to bring this home back.`,
        notes: ['Run `bakin status` in a moment; once it answers, `bakin stop` stops the service with it.'],
      }
    }
    const pending = pendingStarts(io, { exclude: [io.selfPid] })
    const pendingNote = pending === null
      ? 'A start may be pending: processes could not be listed, so a dev build or a restart waiting to boot can\'t be ruled out.'
      : pending.length > 0 ? `A start may be pending (${pending.map((p) => `pid ${p.pid}`).join(', ')}): a dev build or a restart waiting to boot. If it is this home's, stop it before it starts.` : null
    return {
      ok: true,
      status: pendingNote ? 'warn' : 'ok',
      message: 'No running Bakin server for this home.',
      notes: [
        ...(pendingNote ? [pendingNote] : []),
        ...othersNote(io, [io.selfPid]),
      ],
    }
  }

  // A restart child waiting for THIS server to exit would start it again.
  // (The verified server itself may carry the restart-child argv: it is a finished child.)
  const serverPid = identity.kind === 'owned' || identity.kind === 'old-protocol' ? identity.pid : -1
  const restarting = pendingStarts(io, { exclude: [io.selfPid, serverPid], waitingFor: serverPid })
  if (restarting === null) {
    return { ok: false, status: 'error', message: 'Processes could not be listed, so Bakin can\'t rule out a restart waiting to undo this stop. Nothing was stopped.', notes: ['Run the command again.'] }
  }
  if (restarting.length > 0) {
    return {
      ok: false,
      status: 'error',
      message: 'A Bakin restart is in progress, so stopping now would only be undone by the restart. Nothing was stopped.',
      notes: [`Restarting: ${restarting.map((p) => `pid ${p.pid}`).join(', ')}. Wait for it to finish (\`bakin status\`), then run \`bakin stop\`.`],
    }
  }
  const service = readServiceState(io)
  const deadline = io.now() + HANDOFF_BUDGET_MS
  const notes: string[] = []
  if (identity.kind === 'old-protocol') {
    // The generation being stopped, captured BEFORE anything changes it.
    const bootId = io.readLock()?.bootId ?? ''
    // An older server can't take a shutdown request. Only its own service
    // manager — proved to run exactly this lock holder — may stop it.
    if (serviceRunsOldServer(io, service, identity)) {
      if (!serviceUnchanged(io, service)) return SERVICE_CHANGED
      const [cmd, args] = stopServiceCommand(io)
      const done = io.exec(cmd, args)
      if (!done.ok) return { ok: false, status: 'error', message: `Could not stop the Bakin service: ${done.output.trim()}`, notes }
      notes.push('Stopped the Bakin service (an older server version; it will not restart until `bakin restart` or `bakin setup service`).')
    } else {
      return {
        ok: false,
        status: 'error',
        message: `This home's server (pid ${identity.pid}) is an older Bakin that cannot be stopped by request.`,
        notes: [`Stop it once yourself (it is this home's lock holder: kill ${identity.pid}); every later stop/restart is by request.`],
      }
    }
    return stoppedOutcome(io, await awaitGenerationGone(io, { pid: identity.pid, bootId, port: identity.port }, deadline), identity.pid, notes)
  }

  if (identity.kind !== 'owned') return { ok: false, status: 'error', message: 'Unexpected server state.', notes }
  if (service.kind === 'loaded' && service.pid === identity.pid) {
    // Service-managed: stop the SERVICE, or KeepAlive respawns the server.
    if (!serviceUnchanged(io, service)) return SERVICE_CHANGED
    const [cmd, args] = stopServiceCommand(io)
    const done = io.exec(cmd, args)
    if (!done.ok) return { ok: false, status: 'error', message: `Could not stop the Bakin service: ${done.output.trim()}`, notes }
    notes.push('Stopped the Bakin service so it does not respawn; `bakin restart` or `bakin setup service` brings it back.')
  } else {
    if (service.kind === 'unknown') {
      return {
        ok: false,
        status: 'error',
        message: `The Bakin service state could not be read (${service.reason}), so Bakin can't tell whether a service would respawn this server. Nothing was stopped.`,
        notes: ['Check the service manager (launchctl / systemctl --user), then run the command again.'],
      }
    }
    if (!identity.secret) return { ok: false, status: 'error', message: 'This home\'s lock carries no shutdown secret (a server from before the secret existed); it cannot be stopped by request.', notes }
    const answer = await io.http('POST', identity.port, '/api/server/shutdown', { headers: { 'X-Bakin-Cli-Secret': identity.secret }, body: { bootId: identity.bootId }, timeoutMs: FETCH_TIMEOUT_MS })
    if (!answer || answer.status !== 202) {
      return { ok: false, status: 'error', message: `The server refused the shutdown request${answer ? ` (HTTP ${answer.status})` : ' (no answer)'}.`, notes }
    }
  }
  return stoppedOutcome(io, await awaitGenerationGone(io, identity, deadline), identity.pid, notes)
}

/**
 * An old-protocol server answers only `{version}`, proving neither pid nor
 * boot: its service may be driven only when the LOADED job both runs exactly
 * this lock holder and is configured for this home.
 */
function serviceRunsOldServer(io: LifecycleIo, service: ServiceState, identity: { pid: number }): boolean {
  return service.kind === 'loaded' && service.pid === identity.pid && service.home === io.home
}

// ─── restart ─────────────────────────────────────────────────────────────────

export interface RestartOptions {
  /** Proceed even though a start may be pending (it may belong to another home). */
  force?: boolean
  /** Env for a spawned replacement (BAKIN_HOME/PORT are set here, absolute). */
  baseEnv: Record<string, string>
}

export async function restartHome(io: LifecycleIo, opts: RestartOptions): Promise<LifecycleOutcome> {
  const identity = await resolveIdentity(io)
  const refused = refusal(identity)
  if (refused) return { ...refused, notes: [...refused.notes, ...othersNote(io, [io.selfPid])] }
  const notes: string[] = []
  const service = readServiceState(io)
  const deadline = () => io.now() + HANDOFF_BUDGET_MS

  // A start may already be on its way (dev build, restart child): never race it.
  const serverPid = identity.kind === 'owned' || identity.kind === 'old-protocol' ? identity.pid : undefined
  const pending = pendingStarts(io, { exclude: serverPid === undefined ? [io.selfPid] : [io.selfPid, serverPid], ...(serverPid === undefined ? {} : { waitingFor: serverPid }) })
  if ((pending === null || pending.length > 0) && !opts.force) {
    return {
      ok: false,
      status: 'error',
      message: 'A Bakin start may already be pending, so Bakin will not launch a competing server.',
      notes: [pending === null
        ? 'Processes could not be listed, so a pending start can\'t be ruled out. Run the command again, or `bakin restart --force` if you are sure.'
        : `Pending: ${pending.map((p) => `pid ${p.pid} (${p.command.slice(0, 80)})`).join('; ')}. If that is another home's, run \`bakin restart --force\`.`],
    }
  }

  const oldBootId = io.readLock()?.bootId ?? null
  const ownsService = identity.kind === 'owned'
    ? service.kind === 'loaded' && service.pid === identity.pid
    : identity.kind === 'old-protocol' && serviceRunsOldServer(io, service, identity)
  // With nothing running here, this home's own service may be STARTED — but
  // only one that is not running anything (a running job holding no lock for
  // this home is unproven: starting, wedged, or another home's).
  const idleServiceForThisHome = (service.kind === 'unloaded' || (service.kind === 'loaded' && service.idle)) && service.home === io.home
  if (identity.kind === 'none' && service.kind === 'loaded' && !service.idle) {
    return {
      ok: false,
      status: 'error',
      message: service.pid !== null
        ? `The Bakin service is running pid ${service.pid}, but it does not hold this home's lock, so Bakin can't prove what it is and will not restart it.`
        : 'The Bakin service is starting (or its state is unclear), so Bakin will not launch a competing server.',
      notes: ['It may still be starting — run `bakin status` in a moment. If it is wedged, inspect it before stopping it yourself.'],
    }
  }
  if (service.kind === 'unknown') {
    return {
      ok: false,
      status: 'error',
      message: `The Bakin service state could not be read (${service.reason}), so Bakin can't tell who owns or is starting this server. Nothing was restarted.`,
      notes: ['Check the service manager (launchctl / systemctl --user), then run the command again.'],
    }
  }

  // 1. The service manager restarts what it owns (or starts this home's own idle service).
  if (ownsService || (identity.kind === 'none' && idleServiceForThisHome)) {
    if (!serviceUnchanged(io, service)) return SERVICE_CHANGED
    for (const [cmd, args] of restartServiceCommands(io, service)) {
      const done = io.exec(cmd, args)
      if (!done.ok) return { ok: false, status: 'error', message: `Could not restart the Bakin service: ${done.output.trim()}`, notes }
    }
    notes.push(`Restarted through the Bakin service (${SERVICE_LABEL}).`)
    const boot = await awaitNewBoot(io, oldBootId, deadline(), { service: true })
    if (boot && 'failed' in boot) return { ok: false, status: 'error', message: `Restart failed: ${boot.failed}.`, notes }
    if (!boot) return { ok: false, status: 'error', message: 'The service did not bring up a new Bakin within 20s — check the logs.', notes }
    return { ok: true, status: 'ok', message: 'Bakin restarted.', notes: [...notes, ...othersNote(io, [io.selfPid, boot.pid])], boot }
  }

  // 2. A manual server: stop it by request and await the handoff.
  let port: string | undefined
  if (identity.kind === 'old-protocol') {
    return {
      ok: false,
      status: 'error',
      message: `This home's server (pid ${identity.pid}) is an older Bakin that cannot be restarted by request.`,
      notes: [`Stop it once yourself (kill ${identity.pid}), then run \`bakin restart\`.`],
    }
  }
  if (identity.kind === 'owned') {
    if (!identity.secret) return { ok: false, status: 'error', message: 'This home\'s lock carries no shutdown secret; it cannot be restarted by request.', notes }
    const answer = await io.http('POST', identity.port, '/api/server/shutdown', { headers: { 'X-Bakin-Cli-Secret': identity.secret }, body: { bootId: identity.bootId }, timeoutMs: FETCH_TIMEOUT_MS })
    if (!answer || answer.status !== 202) return { ok: false, status: 'error', message: `The server refused the shutdown request${answer ? ` (HTTP ${answer.status})` : ' (no answer)'}.`, notes }
    const gone = await awaitGenerationGone(io, identity, deadline())
    if (!gone.gone) {
      return { ok: false, status: 'error', message: `The old server (pid ${identity.pid}) is still shutting down after 20s — not starting a competitor.`, notes }
    }
    if (gone.successor) {
      // Something else started this home meanwhile: reconcile with it, never race it.
      notes.push(`Another start took this home as the old server exited (pid ${gone.successor.pid}); no second server was launched.`)
      const boot = await awaitNewBoot(io, oldBootId, deadline(), { pid: gone.successor.pid })
      if (boot && 'failed' in boot) return { ok: false, status: 'error', message: `Restart failed: ${boot.failed}.`, notes }
      if (!boot) return { ok: false, status: 'error', message: `The server that took over (pid ${gone.successor.pid}) did not finish starting within 20s — check the logs.`, notes }
      return { ok: true, status: 'warn', message: 'Bakin restarted (by another start).', notes: [...notes, ...othersNote(io, [io.selfPid, boot.pid])], boot }
    }
    port = String(identity.port) // the replacement keeps the port it had
  }
  if (service.kind === 'loaded' && service.home !== io.home) {
    notes.push(service.home ? `A Bakin service is loaded for another home (${service.home}); it was left alone.` : 'A Bakin service is loaded whose home could not be read; it was left alone.')
  }

  // 3. Start the replacement with an ABSOLUTE home, and prove it is the one we started.
  const env = { ...opts.baseEnv, BAKIN_HOME: io.home, ...(port ? { PORT: port } : {}) }
  const spawned = io.spawnServer(env)
  if (spawned.pid === null) return { ok: false, status: 'error', message: `Could not start Bakin${spawned.error() ? `: ${spawned.error()}` : ''}.`, notes }
  notes.push(`Started process ${spawned.pid}.`)
  const boot = await awaitNewBoot(io, oldBootId, deadline(), { pid: spawned.pid, spawned })
  if (boot && 'failed' in boot) return { ok: false, status: 'error', message: `Restart failed: ${boot.failed}.`, notes }
  if (!boot) return { ok: false, status: 'error', message: 'The new server did not come up within 20s — check the logs.', notes }
  return { ok: true, status: 'ok', message: 'Bakin restarted.', notes: [...notes, ...othersNote(io, [io.selfPid, boot.pid])], boot }
}
