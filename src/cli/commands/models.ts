/**
 * `bakin models restore <snapshot.json>` — undo a Models-page Reset (#907).
 *
 * A snapshot is FULL STATE, not a request body: restore fetches the CURRENT
 * selections + revision, diffs the snapshot against them into ops, and
 * submits through the ONE validated write path (`POST /selections`) under
 * the current revision — valid immediately after a Reset and after later
 * edits alike. One retry on a 409 stale revision (something else saved in
 * between); every other refusal is printed verbatim.
 *
 * `plan` (recommended two-lane plan) joins this module in PR 3.
 */
import { readFileSync } from 'fs'
import { BASE_URL, apiGet } from '../http'
import { print } from '../output'
import { exitUnknownSubcommand, exitUsage } from '../help'
import { buildRestoreOps, type MutationOp } from '../../core/model-mutations'
import type { SelectionState } from '../../core/model-selections'

interface SelectionsPayload { revision: string; states: SelectionState[] }
interface SnapshotFile { takenAt?: number; revision?: string; states: SelectionState[] }

async function postSelections(body: { revision: string; ops: MutationOp[] }): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}/api/plugins/models/selections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

export async function cmdRestore(file: string | undefined, json: boolean): Promise<void> {
  if (!file) return exitUsage('bakin models restore <snapshot.json>')
  let snapshot: SnapshotFile
  try {
    snapshot = JSON.parse(readFileSync(file, 'utf8')) as SnapshotFile
  } catch (err) {
    console.error(`Cannot read snapshot ${file}: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
  if (!Array.isArray(snapshot.states)) {
    console.error(`${file} is not a selections snapshot (no states[]).`)
    process.exit(1)
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const current = (await apiGet('/api/plugins/models/selections')) as SelectionsPayload
    const ops = buildRestoreOps(snapshot.states, current.states)
    if (ops.length === 0) {
      if (json) print({ ok: true, applied: [], failed: [], pending: [], message: 'already matches the snapshot' })
      else console.log('Nothing to restore — the current configuration already matches the snapshot.')
      return
    }
    const { status, json: result } = await postSelections({ revision: current.revision, ops })
    if (status === 409 && result.error === 'stale_revision' && attempt === 0) continue
    if (status >= 400) {
      console.error(`Restore refused (${status}): ${String(result.message ?? result.error ?? 'unknown error')}`)
      if (result.proposal) console.error(`  Proposal: ${JSON.stringify(result.proposal)}`)
      process.exit(1)
    }
    if (json) {
      print(result)
    } else {
      const applied = (result.applied as string[]) ?? []
      const failed = (result.failed as Array<{ ref: string; error: { message: string } }>) ?? []
      const pending = (result.pending as Array<{ ref: string }>) ?? []
      console.log(`Restored ${applied.length} selection${applied.length === 1 ? '' : 's'} from ${file}.`)
      for (const f of failed) console.log(`  ✗ ${f.ref}: ${f.error.message}`)
      for (const p of pending) console.log(`  … ${p.ref}: write pending — the runtime has not confirmed it yet`)
      if (failed.length > 0) process.exit(1)
    }
    return
  }
  console.error('Restore refused: the configuration kept changing while restoring. Try again.')
  process.exit(1)
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  const json = args.includes('--json')
  if (sub === 'restore') {
    await cmdRestore(args.find((a, i) => i >= 2 && !a.startsWith('--')), json)
    return
  }
  await exitUnknownSubcommand('models', sub, ['restore'])
}
