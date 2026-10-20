/**
 * Self-update as an operation (#1007 D7.11, C3/R3/R7): install-state owned,
 * staging keyed by the operation id, the restart PROVEN before the swap and
 * ARMED only after it (P19). The point of no return is the binary swap; the
 * last stage is `restarting`, and the operation ends with the old process —
 * a client that follows it sees `restarted` (outcome unknown) and runs the
 * explicit version verification (`src/lib/self-update-verify.ts`).
 */
import type { OperationOrigin, OperationOutcome, OperationPlan, StartOperationInput } from '@bakin/core/operations'
import type { GithubRelease, SelfUpdateOptions, SelfUpdateReporter, SelfUpdateStage } from '../self-update'
import type { PreparedRestart, RestartScheduleResult } from '../server-restart'

export const SELF_UPDATE_PLAN: OperationPlan = {
  stages: [
    { id: 'download', kind: 'downloading', label: 'Download the release' },
    { id: 'verify', kind: 'verifying', label: 'Verify the checksum and unpack' },
    { id: 'prepare-restart', kind: 'preparing', label: 'Prove the restart path' },
    { id: 'swap', kind: 'committing', label: 'Replace the binary' },
    { id: 'restarting', kind: 'verifying', label: 'Restart into the new version' },
  ],
  pointOfNoReturn: 'swap',
}

export interface SelfUpdateResultBody {
  ok: boolean
  version?: string
  message: string
  restart?: RestartScheduleResult
}

export interface SelfUpdateOperationDeps {
  currentVersion: () => string
  execPath: () => string
  selfUpdate: (reporter: SelfUpdateReporter, options: SelfUpdateOptions) => Promise<number>
  prepareRestart: () => PreparedRestart
  activateRestart: (prepared: PreparedRestart) => RestartScheduleResult
  /** Resolves only when the process is gone — never, in production (the restart kills us). Tests resolve it. */
  awaitProcessExit?: () => Promise<void>
  /**
   * `server`: this process IS the server — prove the restart before the swap
   * and restart after it. `none`: the offline CLI with no server running —
   * swap and finish; nothing to restart.
   */
  restart?: 'server' | 'none'
  /**
   * The in-process CLI's guard (R3″): called once install-state is held,
   * before anything downloads; a non-null reason refuses the update (a
   * server came alive meanwhile — the update must go through it).
   */
  refuseIfServerLive?: () => string | null
  /** Mirrors the updater's log lines (the CLI prints them). */
  echo?: (line: string) => void
  /** The release the operator approved; the updater refuses any other (#1007 review). */
  expectedVersion?: string
}

const STAGE_OF: Record<SelfUpdateStage, string> = { download: 'download', verify: 'verify', extract: 'verify', replace: 'swap' }

export function selfUpdateOperation(origin: OperationOrigin, deps: SelfUpdateOperationDeps): StartOperationInput<SelfUpdateResultBody> {
  return {
    kind: 'updates:self-update',
    owner: 'core',
    origin,
    title: 'Update Bakin',
    href: '/health?tab=updates',
    // One operation per approved release: a request for another version never attaches to this one.
    fingerprint: `updates:self-update:${deps.expectedVersion ?? 'latest'}`,
    resources: ['install-state'],
    plan: SELF_UPDATE_PLAN,
    run: async (op): Promise<OperationOutcome<SelfUpdateResultBody>> => {
      const restartMode = deps.restart ?? 'server'
      const refusal = deps.refuseIfServerLive?.() ?? null
      if (refusal) {
        return { status: 'failed', code: 'server_live', message: refusal, httpStatus: 200, body: { ok: false, message: refusal } }
      }
      const errors: string[] = []
      let release: GithubRelease | null = null
      let prepared: PreparedRestart | null = null
      const reporter: SelfUpdateReporter = {
        log: (message) => { op.log(message); deps.echo?.(message) },
        error: (message) => { errors.push(message); op.log(message, 'error'); deps.echo?.(message) },
      }
      const exitCode = await deps.selfUpdate(reporter, {
        execPath: deps.execPath(),
        stagingSuffix: `${op.id}.new`,
        ...(deps.expectedVersion !== undefined ? { expectedVersion: deps.expectedVersion } : {}),
        onStage: (stage) => op.stage(STAGE_OF[stage]),
        beforeReplace: async (staged) => {
          release = staged.release
          if (restartMode === 'none') {
            op.skip('prepare-restart', 'no server is running — nothing to restart')
            op.throwIfCancelled()
            return
          }
          op.stage('prepare-restart')
          const candidate = deps.prepareRestart()
          if (!candidate.ok) throw new Error(`the restart cannot be scheduled (${candidate.error}); the running binary was left untouched`)
          prepared = candidate
          op.throwIfCancelled()
        },
      })
      if (exitCode !== 0 || (restartMode === 'server' && !prepared)) {
        const message = errors.at(-1) ?? 'Bakin update failed.'
        return { status: 'failed', code: 'update_failed', message, httpStatus: 200, body: { ok: false, message } }
      }
      const version = release ? (release as GithubRelease).tag_name : undefined
      if (restartMode === 'none' || !prepared) {
        op.skip('restarting', 'no server is running — start Bakin to run the new version')
        const message = `Updated to ${version ?? 'the new version'}. Start Bakin to run it.`
        return { status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true, version, message } }
      }
      // The restart is ARMED first; only a successful activation is the
      // handoff milestone (`restarting` active) a follower may act on — a
      // failed activation is a terminal failure, never a handoff (R2 #7).
      const restart = deps.activateRestart(prepared)
      if (!restart.ok) {
        const message = `Updated to ${version ?? 'the new version'}, but the restart could not be scheduled (${restart.error ?? 'unknown'}). Restart Bakin by hand to run it.`
        return { status: 'failed', code: 'restart_failed', message, httpStatus: 200, body: { ok: false, version, message, restart } }
      }
      op.stage('restarting', version ? `Restarting into ${version}` : 'Restarting')
      // The old process ends here; a follower sees `restarted` and verifies.
      // A deferred restart command that FAILS leaves this process alive: the
      // operation must end as restart_failed and release install-state, not
      // wait forever on an exit that never comes (R3 #3).
      const exit = (deps.awaitProcessExit ?? (() => new Promise<void>(() => {})))().then(() => null)
      const deferredFailure = restart.settled ? restart.settled.then((outcome) => (outcome.ok ? null : outcome.error)) : null
      const failure = await (deferredFailure ? Promise.race([exit, deferredFailure.then((error) => (error === null ? exit : error))]) : exit)
      if (typeof failure === 'string') {
        const message = `Updated to ${version ?? 'the new version'}, but the restart failed (${failure}). Restart Bakin by hand to run it.`
        return { status: 'failed', code: 'restart_failed', message, httpStatus: 200, body: { ok: false, version, message, restart: { ...restart, settled: undefined } } }
      }
      const message = `Updated to ${version ?? 'the new version'}; restarting.`
      return { status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true, version, message, restart: { ...restart, settled: undefined } } }
    },
  }
}
