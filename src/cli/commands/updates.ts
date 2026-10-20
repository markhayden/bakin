/**
 * `bakin updates [--check] [--json] | updates skip <id> | updates apply <id> [--yes] [--json]`
 * — the updates engine from the terminal (#1007 D7.15).
 *
 * Reads go to the running server (`GET /api/updates`, `POST /api/updates/check?wait=1`);
 * with no server, `--check` builds the same engine in-process over this home
 * and runs the pass itself. Apply previews first (impact + any covering Health
 * approval's FULL scope), asks, then follows the operation; a plugin upgrade
 * that widens permissions or binaries asks again before committing with its
 * token; the Bakin binary rides `bakin update`'s own path (restart handoff +
 * verification). Operator identity is the shared CLI plumbing's (#898):
 * applying needs `--as human`, never an unconditional declaration.
 */
import { countAvailableUpdates, isUpdateSkipped, type UpdateRecord, type UpdateSubjectKind, UPDATE_SUBJECT_KINDS } from '@makinbakin/sdk/types'
import { apiGet, apiPost, cliFetch, isServerConnectionError, jsonObject, BakinNotRunningError, CLI_TARGET } from '../http'
import { confirmPrompt, exitCommandFailure, exitUnknownSubcommand, exitUsage } from '../help'
import { print, printTable } from '../output'
import { operationBody, startAndFollow } from '../operation-command'

const USAGE = 'bakin updates [--check] [--source <kind>] [--json] | updates skip <id> | updates apply <id> [--yes] [--json]'
const BAKIN_RECORD_ID = 'bakin:bakin'

interface UpdatesSnapshotBody {
  records: UpdateRecord[]
  generatedAt: string
  running: boolean
}

function flag(args: string[], name: string): boolean {
  return args.includes(name)
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index >= 0) return args[index + 1]
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  return inline?.slice(name.length + 1)
}

function statusOf(record: UpdateRecord): string {
  if (record.outcome === 'update-available') return isUpdateSkipped(record) ? 'skipped' : record.group === 'required' ? 'REQUIRED' : 'available'
  if (record.outcome === 'unknown') return record.attempt?.error ? 'could not check' : 'not checked'
  return record.outcome
}

function versionsOf(record: UpdateRecord): string {
  const installed = record.installed?.display ?? '-'
  return record.outcome === 'update-available' && record.available ? `${installed} → ${record.available.display}` : installed
}

function detailOf(record: UpdateRecord): string {
  if (record.outcome === 'blocked' || record.outcome === 'unsupported') return record.blockedReason ?? ''
  if (record.outcome === 'unknown') return record.attempt?.error ?? ''
  if (record.action?.kind === 'manual') return record.action.pointer
  return ''
}

function printRecords(snapshot: UpdatesSnapshotBody): void {
  const records = [...snapshot.records].sort((a, b) => Number(b.group === 'required') - Number(a.group === 'required') || a.subject.label.localeCompare(b.subject.label))
  // Required updates count on the tab label too (`countAvailableUpdates`); the summary line splits them.
  const required = records.filter((r) => r.group === 'required' && r.outcome !== 'current').length
  const available = countAvailableUpdates(records.filter((r) => r.group === 'available'))
  console.log(`${records.length} subject${records.length === 1 ? '' : 's'} — ${required} required, ${available} available${snapshot.running ? ' (a check is running)' : ''}`)
  if (records.length === 0) return
  console.log('')
  printTable(records.map((record) => ({
    id: record.id,
    status: statusOf(record),
    versions: versionsOf(record),
    checked: record.observedAt ?? record.attempt?.at ?? 'never',
    detail: detailOf(record),
  })), ['id', 'status', 'versions', 'checked', 'detail'])
  const manual = records.filter((r) => r.outcome !== 'current' && r.action?.kind === 'manual')
  if (manual.length > 0) console.log(`\n${manual.length} ${manual.length === 1 ? 'needs' : 'need'} a manual step (see detail).`)
  if (countAvailableUpdates(records) > 0) console.log('\nApply one with: bakin updates apply <id> --as human')
}

/** This home's live server lock, re-read now (a pid that is alive owns the home even before it listens). */
async function liveServerLockNow(): Promise<{ pid: number; port: number } | null> {
  const { readLiveServerLock } = await import('../../core/server-lock')
  return readLiveServerLock()
}

/** The engine's pass without a server: the same sources over this home, in-process. */
async function checkInProcess(kind: UpdateSubjectKind | undefined): Promise<UpdatesSnapshotBody> {
  const [{ getContentDir }, { readRuntimeAdapterStrict }, { createRuntimeAdapter }, { registerCoreUpdateSources }, { startUpdates, stopUpdates, getUpdatesTimer }] = await Promise.all([
    import('../../core/content-dir'),
    import('../../../packages/core/src/settings'),
    import('../../core/runtime-adapter-factory'),
    import('../../core/updates/sources'),
    import('../../core/updates/service'),
  ])
  // A BARE adapter (constructed, never initialized): the gateway's
  // compatibility is whatever it already knows — serverless, that is "unknown".
  const runtime = createRuntimeAdapter(readRuntimeAdapterStrict())
  registerCoreUpdateSources({ runtime: () => runtime })
  // Ownership re-checked at the last moment: a server that came alive since the first probe owns this home's engine.
  const live = await liveServerLockNow()
  if (live) await exitCommandFailure('Bakin is starting — retry.', { command: 'bakin updates', detail: `server.lock names pid ${live.pid} on port ${live.port}; the home is that server's to check.`, code: 'SERVER_STARTING' })
  const engine = startUpdates(getContentDir())
  try {
    await engine.ready
    await getUpdatesTimer()!.check(kind ? { kind } : {})
    return await engine.snapshot()
  } finally {
    stopUpdates()
  }
}

async function cmdUpdatesList(args: string[]): Promise<void> {
  const json = flag(args, '--json')
  const check = flag(args, '--check')
  const source = flagValue(args, '--source')
  if (source !== undefined && !(UPDATE_SUBJECT_KINDS as readonly string[]).includes(source)) {
    await exitUsage(USAGE, `--source must be one of ${UPDATE_SUBJECT_KINDS.join(', ')}`)
  }
  const kind = source as UpdateSubjectKind | undefined
  let snapshot: UpdatesSnapshotBody
  try {
    if (check) {
      const query = new URLSearchParams({ wait: '1', ...(kind ? { source: kind } : {}) })
      await apiPost(`/api/updates/check?${query}`)
    }
    snapshot = await apiGet('/api/updates') as UpdatesSnapshotBody
  } catch (err) {
    if (!(err instanceof BakinNotRunningError) && !isServerConnectionError(err)) throw err
    // The in-process engine is for a home with NO server (review r14 #2): an
    // explicit remote target is not this home, and a live lock whose server
    // is not answering yet owns `updates.json` — a second engine would write
    // over its observations.
    if (CLI_TARGET.source === 'env') {
      await exitCommandFailure(`Bakin at ${CLI_TARGET.baseUrl} (BAKIN_URL) is unreachable.`, { command: 'bakin updates', detail: 'An explicit BAKIN_URL is never checked in-process: this home is not that server\'s home. Check the URL, or unset it to check this home.', code: 'SERVER_UNREACHABLE' })
    }
    const live = await liveServerLockNow()
    if (live) {
      await exitCommandFailure('Bakin is starting — retry.', { command: 'bakin updates', detail: `server.lock names pid ${live.pid} on port ${live.port}, but it is not answering yet. The home is that server's to check.`, code: 'SERVER_STARTING' })
    }
    if (!check) {
      await exitCommandFailure('Bakin is not running.', { command: 'bakin updates', detail: 'Start it, or run `bakin updates --check` to check this home in-process.', code: 'SERVER_UNAVAILABLE' })
    }
    snapshot = await checkInProcess(kind)
  }
  if (json) {
    print(snapshot)
    return
  }
  printRecords(snapshot)
}

async function cmdUpdatesSkip(args: string[]): Promise<void> {
  const id = args[2]
  if (!id) await exitUsage(USAGE, 'skip needs an update id (see `bakin updates`)')
  const body = jsonObject(await apiPost(`/api/updates/${encodeURIComponent(id!)}/skip`)) ?? {}
  const record = jsonObject(body.record) as unknown as UpdateRecord | null
  if (flag(args, '--json')) {
    print(body)
    return
  }
  console.log(record ? `${record.subject.label} ${record.available?.display ?? ''} stays hidden until something newer appears.`.replace(/\s+/g, ' ') : `Skipped ${id}.`)
}

interface ApplyPreviewBody {
  preview: {
    id: string
    record: UpdateRecord
    action?: UpdateRecord['action']
    approval?: { approvalId: string; title: string; scopeHash: string; items: Array<{ changes: Array<{ description: string }> }> }
  }
}

const IMPACT_COPY: Record<string, string> = {
  'server-restart': 'Bakin restarts.',
  'search-interruption': 'Search is unavailable while the engine is replaced.',
  reindex: 'Search indexes are rebuilt afterwards.',
  download: 'Downloads an artifact from its pinned source and verifies it.',
}

/** POST the apply with this invocation's identity; a refusal is the answer, not an exception. */
async function postApply(id: string, body: Record<string, unknown>): Promise<{ ok: true; started: Record<string, unknown> } | { ok: false; status: number; body: Record<string, unknown> }> {
  const res = await cliFetch(`/api/updates/${encodeURIComponent(id)}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const parsed = jsonObject(await res.json().catch(() => null)) ?? {}
  if (!res.ok) return { ok: false, status: res.status, body: parsed }
  return { ok: true, started: parsed }
}

function describeRefusal(status: number, body: Record<string, unknown>): { message: string; detail: string; code: string } {
  const message = typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : `HTTP ${status}`
  if (status === 403 && body.refusalCode === 'undeclared') {
    return { message: 'Applying an update is an operator action.', detail: 'Run it as the operator: bakin updates apply <id> --as human', code: 'OPERATOR_REQUIRED' }
  }
  if (status === 403) return { message: 'Agents cannot apply updates.', detail: message, code: 'OPERATOR_REQUIRED' }
  return { message, detail: typeof body.error === 'string' ? body.error : `HTTP ${status}`, code: 'UPDATE_APPLY_REFUSED' }
}

async function cmdUpdatesApply(args: string[]): Promise<void> {
  const id = args[2]
  if (!id) await exitUsage(USAGE, 'apply needs an update id (see `bakin updates`)')
  const json = flag(args, '--json')
  const yes = flag(args, '--yes')

  // The Bakin binary has its own path: restart handoff + explicit verification (D7.11).
  if (id === BAKIN_RECORD_ID) {
    const { runUpdateCommand } = await import('../../core/updates/self-update-cli')
    // The same target the preview and the list used: a BAKIN_URL target is never a local replacement.
    const result = await runUpdateCommand({ echo: (line) => { if (!json) console.log(line) }, stdout: process.stdout, target: CLI_TARGET })
    if (json) print(result)
    else if (result.kind !== 'failed') console.log(result.message)
    // A failure exits non-zero in every output mode (JSON keeps its one document).
    if (result.kind === 'failed') await exitCommandFailure(result.message, { command: 'bakin updates apply', detail: result.detail, code: result.code, ...(json ? { plainLines: [] } : {}) })
    return
  }

  const { preview } = await apiGet(`/api/updates/${encodeURIComponent(id!)}/apply-preview`) as ApplyPreviewBody
  const record = preview.record
  if (record.outcome !== 'update-available') {
    await exitCommandFailure(`${id} is ${record.outcome}; nothing to apply.`, { command: 'bakin updates apply', detail: record.blockedReason ?? record.attempt?.error, code: 'NOTHING_TO_APPLY' })
  }
  const action = preview.action ?? record.action
  if (!action || action.kind === 'manual') {
    await exitCommandFailure(`${id} needs a manual step.`, { command: 'bakin updates apply', detail: action?.kind === 'manual' ? action.pointer : 'The record carries no action.', code: 'MANUAL_ACTION' })
  }
  if (!json) {
    console.log(`Update ${record.subject.label}: ${versionsOf(record)}`)
    for (const impact of action!.kind === 'operation' ? action!.impact : []) console.log(`  - ${IMPACT_COPY[impact] ?? impact}`)
    if (preview.approval) {
      console.log(`  Applying approves the pending Health repair "${preview.approval.title}" in full:`)
      for (const change of preview.approval.items.flatMap((item) => item.changes)) console.log(`    - ${change.description}`)
    }
  }
  if (!yes && !(await confirmPrompt(`Apply the ${record.subject.label} update?`))) {
    await exitCommandFailure('Not applied.', { command: 'bakin updates apply', detail: 'Confirm the prompt, or pass --yes.', code: 'NOT_CONFIRMED' })
  }

  const approval = preview.approval
  const target = { ...(record.available?.version ? { version: record.available.version } : {}), ...(record.available?.sha ? { sha: record.available.sha } : {}), ...(record.available?.digest ? { digest: record.available.digest } : {}) }
  let body: Record<string, unknown> = { target, ...(approval ? { approvalId: approval.approvalId, scopeHash: approval.scopeHash } : {}) }
  for (;;) {
    const started = await postApply(id!, body)
    if (!started.ok) {
      const refusal = describeRefusal(started.status, started.body)
      if (json) print({ ok: false, ...started.body })
      await exitCommandFailure(refusal.message, { command: 'bakin updates apply', detail: refusal.detail, code: refusal.code })
      return
    }
    const operation = await startAndFollow(async () => started.started, { json })
    const result = operationBody(operation)
    // A plugin upgrade's preview may stop for consent (permissions/binaries widened).
    if (operation.exitCode === 0 && result.awaitingConsent === true && typeof result.consentToken === 'string') {
      const permissions = Array.isArray(result.declaredPermissions) ? result.declaredPermissions.map(String) : []
      const bins = Array.isArray(result.declaredBins) ? result.declaredBins.map((bin) => { const b = jsonObject(bin); return b ? `${String(b.name)} ${String(b.version)}` : String(bin) }) : []
      if (!json) {
        console.log('This update asks for consent:')
        if (permissions.length > 0) console.log(`  permissions: ${permissions.join(', ')}`)
        if (bins.length > 0) console.log(`  binaries: ${bins.join(', ')}`)
      }
      if (!yes && !(await confirmPrompt('Approve and apply?'))) {
        await exitCommandFailure('Not applied.', { command: 'bakin updates apply', detail: 'The preview asked for consent; confirm it or pass --yes.', code: 'NOT_CONFIRMED' })
      }
      body = { target, consentToken: result.consentToken }
      continue
    }
    if (operation.exitCode === 0 && result.ready === true && typeof result.consentToken === 'string') {
      body = { target, consentToken: result.consentToken }
      continue
    }
    if (json) print(result)
    else if (operation.exitCode === 0) console.log(typeof result.message === 'string' ? result.message : `${record.subject.label} was updated.`)
    if (operation.exitCode !== 0) process.exit(operation.exitCode)
    return
  }
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (sub === undefined || sub.startsWith('--')) await cmdUpdatesList(args)
  else if (sub === 'skip') await cmdUpdatesSkip(args)
  else if (sub === 'apply') await cmdUpdatesApply(args)
  else await exitUnknownSubcommand('updates', sub, ['skip', 'apply'])
}
