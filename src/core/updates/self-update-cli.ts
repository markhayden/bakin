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
import { APP_VERSION } from '@bakin/core/constants'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import { verifySelfUpdateFromCli } from '../../cli/self-update-verify'
import { startAndFollow, type CommandOperationResult } from '../../cli/operation-command'
import { readLiveServerLock, type ServerLock } from '../server-lock'

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
  /** Start + follow the server's operation (the CLI's renderer); tests inject a scripted follow. */
  startAndFollow?: (start: () => Promise<unknown>) => Promise<CommandOperationResult>
  /** The identity headers this invocation carries (#898); the shared CLI plumbing by default. */
  identityHeaders?: () => Promise<Record<string, string>>
}

const BAKIN_RECORD_ID = 'bakin:bakin'
const CLI_HEADERS: Record<string, string> = { 'X-Bakin-Origin': 'cli', 'Content-Type': 'application/json' }

/** This invocation's identity headers (#898): an agent context, or the operator declaration `--as human` earned. */
async function defaultIdentityHeaders(): Promise<Record<string, string>> {
  const [{ cliIdentity }, { identityHeaders }] = await Promise.all([import('../../cli/http'), import('../../cli/identity')])
  return identityHeaders(await cliIdentity())
}

function baseUrlOf(lock: ServerLock): string {
  return `http://localhost:${lock.port}`
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
  if (!lock) {
    const local = input.runLocal ?? (async () => runLocalSelfUpdate(input.echo))
    return local()
  }
  const baseUrl = baseUrlOf(lock)
  if (!(await waitForListening(baseUrl, deps))) {
    return { kind: 'failed', code: 'SERVER_STARTING', message: 'Bakin is starting — retry.', detail: `server.lock names pid ${lock.pid} on port ${lock.port}, but it did not answer within ${Math.round(deps.listenWaitMs / 1000)}s. The binary is never replaced beside a live server.` }
  }
  const headers = { ...CLI_HEADERS, ...(await (input.identityHeaders ?? defaultIdentityHeaders)()), ...(lock.cliSecret ? { 'X-Bakin-Cli-Secret': lock.cliSecret } : {}) }
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
  const follow = input.startAndFollow ?? ((start) => startAndFollow(start, { json: false, stdout: input.stdout }))
  const followed = await follow(async () => {
    const res = await deps.fetch(`${baseUrl}/api/updates/${encodeURIComponent(BAKIN_RECORD_ID)}/apply`, { method: 'POST', headers, body: '{}' })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) throw new UpdateApplyRefusedError(res.status, body)
    handoff = { operationId: String(body?.operationId), bootId: String(body?.bootId) }
    return body
  }).catch((error: unknown) => {
    if (error instanceof UpdateApplyRefusedError) return error
    throw error
  })
  if (followed instanceof UpdateApplyRefusedError) return followed.result()
  const restartHandoff = handoff as { operationId: string; bootId: string } | null
  const reachedRestart = followed.follow.phase === 'restarted'
    || followed.follow.operation?.stages.some((stage) => stage.id === 'restarting' && stage.status !== 'pending') === true
  if (!reachedRestart || !restartHandoff) {
    const message = followed.follow.operation?.outcome?.message ?? 'Bakin update did not reach the restart.'
    return { kind: 'failed', code: 'UPDATE_FAILED', message, detail: followed.follow.operation?.outcome?.code }
  }
  const verification = await verifySelfUpdateFromCli({ expectedVersion, oldBootId: restartHandoff.bootId, log: input.echo, baseUrl, fetch: (url, init) => deps.fetch(url, init) })
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
