/**
 * `bakin models plan [--apply] [--json]` and `bakin models restore <snapshot.json>`.
 *
 * `plan` prints the recommended two-lane plan (agent model + background
 * chores) with its reasons and the changes that reach it; `--apply` submits
 * those changes through the ONE validated write path (`POST /selections`)
 * under the revision the plan was computed against — the only way the CLI
 * ever changes a model, and only on this explicit flag (never automatic).
 *
 * `restore` undoes a Models-page Reset (#907). A snapshot is FULL STATE, not
 * a request body: restore fetches the CURRENT selections + revision, diffs
 * the snapshot against them into ops, and submits under the current
 * revision — valid immediately after a Reset and after later edits alike.
 * Both verbs retry once on a 409 stale revision (something else saved in
 * between); every other refusal is printed verbatim.
 *
 * `pending [--ack <document>]` lists adapter writes the write path could not
 * confirm and is the operator's recovery for a conflicted one.
 */
import { readFileSync } from 'fs'
import { BASE_URL, apiGet } from '../http'
import { print } from '../output'
import { exitUnknownSubcommand, exitUsage } from '../help'
import { buildRestoreOps, type MutationOp } from '../../core/model-mutations'
import type { SelectionState } from '../../core/model-selections'
import type { PlanRecommendation } from '../../core/model-plan'

interface SelectionsPayload { revision: string; states: SelectionState[] }
interface PlanPayload {
  revision: string
  current: { agent: string | null; chores: { model: string | null; models: string[]; mixed: boolean }; enrichmentEnabled: boolean }
  recommended: PlanRecommendation
  candidates: number
}
interface SnapshotFile { takenAt?: number; revision?: string; states: SelectionState[] }

async function postSelections(body: { revision: string; ops: MutationOp[] }): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}/api/plugins/models/selections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

function enrichmentLine(plan: PlanRecommendation): string {
  switch (plan.enrichment) {
    case 'chores': return 'runs on the chores model'
    case 'agent': return `runs on the agent model (${plan.agent.model}) — the chores model cannot see images`
    case 'unset': return 'will fail until a vision-capable model is available'
    case 'disabled': return 'off (assets enrichment is disabled)'
  }
}

function printPlan(payload: PlanPayload): void {
  const { current, recommended } = payload
  const chores = current.chores.mixed ? `Mixed (${current.chores.models.length} models)` : current.chores.model ?? '(none)'
  console.log('Current')
  console.log(`  Agent model   ${current.agent ?? '(none)'}`)
  console.log(`  Chores model  ${chores}`)
  console.log('')
  console.log(`Recommended plan (${payload.candidates} eligible model${payload.candidates === 1 ? '' : 's'})`)
  console.log(`  Agent model   ${recommended.agent.model ?? '(none)'} — ${recommended.agent.why}`)
  console.log(`  Chores model  ${recommended.chores.model ?? '(none)'} — ${recommended.chores.why}`)
  console.log(`  Enrichment    ${enrichmentLine(recommended)}`)
  for (const note of recommended.notes) console.log(`  Note: ${note}`)
  console.log('')
  if (recommended.ops.length === 0) {
    console.log('You are already on this plan — nothing to change.')
    return
  }
  console.log(`Changes (${recommended.ops.length})`)
  for (const op of recommended.ops) console.log(`  ${op.ref} → ${op.set.model ?? 'inherit'}`)
}

export async function cmdPlan(apply: boolean, json: boolean): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const payload = (await apiGet('/api/plugins/models/plan')) as PlanPayload
    if (!apply) {
      if (json) print(payload)
      else {
        printPlan(payload)
        if (payload.recommended.ops.length > 0) console.log('\nRun `bakin models plan --apply` to apply these changes.')
      }
      return
    }
    const ops = payload.recommended.ops
    if (ops.length === 0) {
      if (json) print({ ok: true, applied: [], failed: [], pending: [], message: 'already on the recommended plan' })
      else console.log('You are already on the recommended plan — nothing to change.')
      return
    }
    const { status, json: result } = await postSelections({ revision: payload.revision, ops })
    if (status === 409 && result.error === 'stale_revision' && attempt === 0) continue
    if (status >= 400) {
      console.error(`Apply refused (${status}): ${String(result.message ?? result.error ?? 'unknown error')}`)
      if (result.proposal) console.error(`  Proposal: ${JSON.stringify(result.proposal)}`)
      process.exit(1)
    }
    if (json) {
      print(result)
    } else {
      const applied = (result.applied as string[]) ?? []
      const failed = (result.failed as Array<{ ref: string; error: { message: string } }>) ?? []
      const pending = (result.pending as Array<{ ref: string }>) ?? []
      console.log(`Applied ${applied.length} of ${ops.length} change${ops.length === 1 ? '' : 's'}.`)
      for (const f of failed) console.log(`  ✗ ${f.ref}: ${f.error.message}`)
      for (const p of pending) console.log(`  … ${p.ref}: write pending — the runtime has not confirmed it yet`)
      if (failed.length > 0) process.exit(1)
    }
    return
  }
  console.error('Apply refused: the configuration kept changing while applying. Try again.')
  process.exit(1)
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

interface PendingWire { document: string; refs: string[]; state: 'unsettled' | 'failed' | 'conflict'; detail?: string }

/**
 * `bakin models pending [--ack <document>]` — the adapter writes the ONE
 * write path could not confirm, and the operator's recovery for a CONFLICT
 * (the document changed outside Bakin while a write was pending): a
 * conflict keeps its document reserved until acknowledged; acknowledging
 * drops the record and the current on-disk value stands.
 */
export async function cmdPending(ack: string | undefined, json: boolean): Promise<void> {
  if (ack) {
    const res = await fetch(`${BASE_URL}/api/plugins/models/selections/pending/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: ack }),
    })
    const result = (await res.json()) as Record<string, unknown>
    if (res.status >= 400) {
      console.error(`Acknowledge refused (${res.status}): ${String(result.message ?? result.error ?? 'unknown error')}`)
      process.exit(1)
    }
    if (json) print(result)
    else console.log(`Acknowledged the conflicted write on ${ack} (${((result.refs as string[]) ?? []).join(', ')}). The current value stands; the document accepts writes again.`)
    return
  }
  const payload = (await apiGet('/api/plugins/models/selections')) as { pending?: PendingWire[] }
  const pending = payload.pending ?? []
  if (json) {
    print(pending)
    return
  }
  if (pending.length === 0) {
    console.log('No pending model writes.')
    return
  }
  for (const p of pending) console.log(`  ${p.state.padEnd(10)} ${p.document}  ${p.refs.join(', ')}${p.detail ? ` — ${p.detail}` : ''}`)
  if (pending.some((p) => p.state === 'conflict')) {
    console.log('\nA conflict keeps its document reserved until you acknowledge it: bakin models pending --ack <document>')
  }
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  const json = args.includes('--json')
  if (sub === 'plan') {
    await cmdPlan(args.includes('--apply'), json)
    return
  }
  if (sub === 'restore') {
    await cmdRestore(args.find((a, i) => i >= 2 && !a.startsWith('--')), json)
    return
  }
  if (sub === 'pending') {
    const at = args.indexOf('--ack')
    await cmdPending(at === -1 ? undefined : args[at + 1], json)
    return
  }
  await exitUnknownSubcommand('models', sub, ['plan', 'restore', 'pending'])
}
