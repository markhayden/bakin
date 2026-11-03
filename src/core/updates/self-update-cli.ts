/**
 * The `bakin update` verb's two routes to the ONE self-update operation
 * (#1007 D7.11, R3′/R3″/R3‴):
 *
 * - A live server in this home (`server.lock` names a live pid): POST the
 *   apply service, follow the operation, and when the server restarts (or
 *   the operation reaches `restarting`) run the explicit verification.
 *   A server that is alive but not yet listening is waited for (30 s) —
 *   never worked around by replacing the binary beside it.
 * - No server: run the operation in-process (install-state owned through
 *   the swap), re-checking liveness once the resource is held; a server that
 *   came alive meanwhile refuses the local path.
 */
import { withSilentConsoleLogs } from '../logger'
import { APP_VERSION } from '@bakin/core/constants'
import type { OperationView, UpdateRecord } from '@makinbakin/sdk/types'
import { verifySelfUpdateFromCli } from '../../cli/self-update-verify'
import { startAndFollow, type CommandOperationResult } from '../../cli/operation-command'
import { readLiveServerLock, type ServerLock, resolveCliTarget, type CliTarget } from '../server-lock'

export type UpdateCommandResult =
  | { kind: 'current'; message: string }
  | { kind: 'verified'; message: string }
  | { kind: 'failed'; code: string; message: string; detail?: string }

export interface UpdateCommandDeps {
  echo: (line: string) => void
  stdout?: { isTTY?: boolean }
  liveLock?: () => ServerLock | null
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  listenWaitMs?: number
  pollMs?: number
  /** The in-process operation (no server). Resolves to the operation's outcome. */
  runLocal?: () => Promise<UpdateCommandResult>
  /** Start + follow the server's operation (the CLI's renderer); `onUpdate` returning true stops the follow. Tests inject a scripted follow. */
  startAndFollow?: (start: () => Promise<unknown>, opts: { onUpdate: (operation: OperationView) => boolean; baseUrl: string; json: boolean; signal: AbortSignal }) => Promise<CommandOperationResult>
  /** The identity headers this invocation carries (#898); the shared CLI plumbing by default. */
  identityHeaders?: () => Promise<Record<string, string>>
  /**
   * The ONE server this invocation talks to (review r14 #1): the CLI's
   * resolved target — `BAKIN_URL` as given (never a local replacement, never
   * the local lock's secret), else this home's live `server.lock`, else no
   * server (the in-process replacement). Resolved from the environment and
   * the live lock by default.
   */
  target?: CliTarget
  /** `--json`: stdout stays ONE document — the follow renders nothing (review r15 #3). */
  json?: boolean
}

const BAKIN_RECORD_ID = 'bakin:bakin'
const CLI_HEADERS: Record<string, string> = { 'X-Bakin-Origin': 'cli', 'Content-Type': 'application/json' }

/** This invocation's identity headers (#898): an agent context, or the operator declaration `--as human` earned. */
async function defaultIdentityHeaders(): Promise<Record<string, string>> {
  const [{ cliIdentity }, { identityHeaders }] = await Promise.all([import('../../cli/http'), import('../../cli/identity')])
  return identityHeaders(await cliIdentity())
}

/** Wait (bounded) for a live-but-not-listening server to answer `/api/version`. */
async function waitForListening(baseUrl: string, deps: Required<Pick<UpdateCommandDeps, 'fetch' | 'listenWaitMs' | 'pollMs'>>): Promise<boolean> {
  const deadline = Date.now() + deps.listenWaitMs
  for (;;) {
    try {
      const res = await deps.fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(2_000) })
      if (res.ok) return true
    } catch {
      // not listening yet
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, deps.pollMs))
  }
}

/** The apply route refused to start (the operator policy, a changed scope, nothing to apply): the answer IS the result. */
export class UpdateApplyRefusedError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown> | null) {
    super(typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : `HTTP ${status}`)
    this.name = 'UpdateApplyRefusedError'
  }
  result(): UpdateCommandResult {
    const refusal = this.body?.refusalCode
    if (this.status === 403 && refusal === 'undeclared') {
      return { kind: 'failed', code: 'OPERATOR_REQUIRED', message: 'Updating Bakin is an operator action.', detail: 'Run it as the operator: bakin update --as human' }
    }
    if (this.status === 403) {
      return { kind: 'failed', code: 'OPERATOR_REQUIRED', message: 'Agents cannot update Bakin.', detail: this.message }
    }
    return { kind: 'failed', code: 'UPDATE_FAILED', message: this.message, detail: typeof this.body?.error === 'string' ? this.body.error : `HTTP ${this.status}` }
  }
}

export async function runUpdateCommand(input: UpdateCommandDeps): Promise<UpdateCommandResult> {
  const deps = {
    liveLock: input.liveLock ?? readLiveServerLock,
    fetch: input.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init)),
    listenWaitMs: input.listenWaitMs ?? 30_000,
    pollMs: input.pollMs ?? 500,
  }
  const lock = deps.liveLock()
  const server = input.target ?? resolveCliTarget(process.env, lock)
  if (server.source === 'none') {
    const local = input.runLocal ?? (async () => runLocalSelfUpdate(input.echo))
    // `--json`: stdout stays ONE document — the runtime logger's console lines
    // (`Started: Update Bakin`, …) are silenced for the local operation (review r16 #1).
    return input.json ? withSilentConsoleLogs(local) : local()
  }
  const baseUrl = server.baseUrl
  if (server.source === 'env') {
    // An explicit remote target is used as given: unreachable is an error,
    // never a fallback to replacing THIS machine's binary.
    if (!(await waitForListening(baseUrl, { ...deps, listenWaitMs: 0 }))) {
      return { kind: 'failed', code: 'SERVER_UNREACHABLE', message: `Bakin at ${baseUrl} (BAKIN_URL) did not answer.`, detail: 'The binary is never replaced for a target set by BAKIN_URL — check the URL, or unset it to update this home.' }
    }
  } else if (!(await waitForListening(baseUrl, deps))) {
    return { kind: 'failed', code: 'SERVER_STARTING', message: 'Bakin is starting — retry.', detail: `server.lock names pid ${server.pid ?? lock?.pid ?? '?'} on port ${lock?.port ?? '?'}, but it did not answer within ${Math.round(deps.listenWaitMs / 1000)}s. The binary is never replaced beside a live server.` }
  }
  // The per-boot CLI secret belongs to THIS home's server; a remote target never sees it.
  const secret = server.source === 'lock' ? lock?.cliSecret : undefined
  const headers = { ...CLI_HEADERS, ...(await (input.identityHeaders ?? defaultIdentityHeaders)()), ...(secret ? { 'X-Bakin-Cli-Secret': secret } : {}) }
  const listed = await deps.fetch(`${baseUrl}/api/updates`, { headers })
  if (!listed.ok) return { kind: 'failed', code: 'UPDATE_FAILED', message: 'Could not read the update records.', detail: `GET /api/updates answered HTTP ${listed.status}` }
  const records = ((await listed.json()) as { records?: UpdateRecord[] }).records ?? []
  const record = records.find((row) => row.id === BAKIN_RECORD_ID)
  if (!record) return { kind: 'failed', code: 'UPDATE_FAILED', message: 'The server tracks no Bakin release.', detail: 'Run `bakin updates --check` and try again.' }
  if (record.outcome === 'current') return { kind: 'current', message: `Bakin ${record.installed?.display ?? APP_VERSION} is current.` }
  if (record.outcome !== 'update-available') {
    return { kind: 'failed', code: 'UPDATE_UNAVAILABLE', message: `Bakin update is ${record.outcome}.`, detail: record.blockedReason ?? record.attempt?.error }
  }
  const expectedVersion = record.available?.version ?? record.available?.display ?? ''
  input.echo(`Updating Bakin ${record.installed?.display ?? ''} → ${record.available?.display ?? expectedVersion}`.trim())
  let handoff: { operationId: string; bootId: string } | null = null
  // The restart milestone IS the handoff: the moment the `restarting` stage
  // goes active the follow stops and the bounded verification starts —
  // waiting for a terminal outcome would wait on a process that is ending.
  let restartSeen = false
  const atRestart = (operation: OperationView): boolean => {
    // A terminal failure (restart_failed) is reported as such; only a live
    // restart in progress is the handoff.
    if (operation.status === 'running' && operation.stages.some((stage) => stage.id === 'restarting' && stage.status === 'active')) restartSeen = true
    return restartSeen
  }
  const target = { ...(record.available?.version ? { version: record.available.version } : {}), ...(record.available?.sha ? { sha: record.available.sha } : {}), ...(record.available?.digest ? { digest: record.available.digest } : {}) }
  // The follow rides the SAME resolved server as the reads, the apply and the verification (review r15 #2).
  const follow = input.startAndFollow ?? ((start, opts) => startAndFollow(start, { json: input.json ?? false, stdout: input.stdout, onUpdate: opts.onUpdate, baseUrl, signal: opts.signal }))
  // A lock-selected server may come back on ANOTHER port (review r16 #2): the
  // live lock is the successor's announcement. When its boot id moves past the
  // one the operation STARTED on — the apply's answer, never the lock read
  // before it (a restart between that read and the apply is not a successor
  // of the operation, review r17 #2) — the follow stops (the old operation is
  // never cancelled) and the bounded verification runs at the successor's
  // port. An explicit BAKIN_URL target stays fixed — it is not this home.
  const stop = new AbortController()
  let successor: { bootId: string; port: number } | null = null
  const watchSuccessor = server.source === 'lock'
    ? setInterval(() => {
      const startedBoot = handoff?.bootId
      if (!startedBoot) return
      const live = deps.liveLock()
      if (live && live.bootId !== startedBoot && Number.isInteger(live.port) && live.port > 0) {
        successor = { bootId: live.bootId, port: live.port }
        stop.abort()
      }
    }, deps.pollMs)
    : null
  watchSuccessor?.unref?.()
  let followed: CommandOperationResult | UpdateApplyRefusedError
  try {
    followed = await follow(async () => {
      const res = await deps.fetch(`${baseUrl}/api/updates/${encodeURIComponent(BAKIN_RECORD_ID)}/apply`, { method: 'POST', headers, body: JSON.stringify({ target }) })
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) throw new UpdateApplyRefusedError(res.status, body)
      handoff = { operationId: String(body?.operationId), bootId: String(body?.bootId) }
      return body
    }, { onUpdate: atRestart, baseUrl, json: input.json ?? false, signal: stop.signal }).catch((error: unknown) => {
      if (error instanceof UpdateApplyRefusedError) return error
      throw error
    })
  } finally {
    if (watchSuccessor) clearInterval(watchSuccessor)
  }
  if (followed instanceof UpdateApplyRefusedError) return followed.result()
  const restartHandoff = handoff as { operationId: string; bootId: string } | null
  const successorBoot = successor as { bootId: string; port: number } | null
  const reachedRestart = restartSeen || successorBoot !== null || followed.follow.phase === 'restarted'
    || (followed.follow.operation?.status === 'running' && followed.follow.operation.stages.some((stage) => stage.id === 'restarting' && stage.status === 'active'))
  if (!reachedRestart || !restartHandoff) {
    const message = followed.follow.operation?.outcome?.message ?? 'Bakin update did not reach the restart.'
    return { kind: 'failed', code: 'UPDATE_FAILED', message, detail: followed.follow.operation?.outcome?.code }
  }
  if (successorBoot) input.echo(`Bakin came back on port ${successorBoot.port}; verifying there.`)
  const verifyBaseUrl = successorBoot ? `http://localhost:${successorBoot.port}` : baseUrl
  // Successor discovery continues THROUGH the verification for a lock-selected
  // server (review r17 #1): the restart milestone may arrive before the
  // successor publishes its port, so every poll goes to where the live lock
  // says Bakin is now. An explicit BAKIN_URL target stays fixed.
  const liveBaseUrl = (): string => {
    if (server.source !== 'lock') return verifyBaseUrl
    const live = deps.liveLock()
    return live && Number.isInteger(live.port) && live.port > 0 ? `http://localhost:${live.port}` : verifyBaseUrl
  }
  const verification = await verifySelfUpdateFromCli({ expectedVersion, oldBootId: restartHandoff.bootId, log: input.echo, baseUrl: verifyBaseUrl, fetch: (url, init) => deps.fetch(url.startsWith(verifyBaseUrl) ? `${liveBaseUrl()}${url.slice(verifyBaseUrl.length)}` : url, init) })
  if (verification.status === 'verified') return { kind: 'verified', message: `Updated to ${verification.version} and verified.` }
  if (verification.status === 'wrong-version') return { kind: 'failed', code: 'UPDATE_WRONG_VERSION', message: `Bakin came back as ${verification.version}, not ${expectedVersion}.` }
  return { kind: 'failed', code: 'UPDATE_UNVERIFIED', message: 'Bakin did not come back within 90s — verify by hand.', detail: verification.lastError }
}

/** No server: the same operation in-process, owning install-state through the swap. */
async function runLocalSelfUpdate(echo: (line: string) => void): Promise<UpdateCommandResult> {
  const [{ runLocal }, { selfUpdateOperation }, { selfUpdate }, { activateServerRestart, prepareServerRestart }] = await Promise.all([
    import('../operations'),
    import('./self-update-operation'),
    import('../self-update'),
    import('../server-restart'),
  ])
  const view = await runLocal(selfUpdateOperation('cli', {
    currentVersion: () => APP_VERSION,
    execPath: () => process.execPath,
    selfUpdate,
    prepareRestart: prepareServerRestart,
    activateRestart: activateServerRestart,
    restart: 'none',
    echo,
    // R3″: install-state is held now; a server that came alive since the
    // first check owns the binary — the update must go through it.
    refuseIfServerLive: () => {
      const live = readLiveServerLock()
      return live ? `A Bakin server (pid ${live.pid}) came alive while waiting for install-state — run bakin update again; it will go through the server.` : null
    },
  }))
  if (view.status === 'succeeded') return { kind: 'verified', message: view.outcome?.message ?? 'Updated. Start Bakin to run the new version.' }
  return { kind: 'failed', code: view.outcome?.code === 'server_live' ? 'SERVER_LIVE' : 'UPDATE_FAILED', message: view.outcome?.message ?? 'Bakin update failed.' }
}
