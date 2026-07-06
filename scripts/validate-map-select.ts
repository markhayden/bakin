#!/usr/bin/env bun
/**
 * map_workflow / Multi-Image Select e2e validation harness (#203).
 *
 * Drives real image-multi-select runs against a LIVE Bakin server (dockerized
 * rig in isolated mode) and verifies the map fan-out/fan-in contract
 * end-to-end: dynamic children, stable-order aggregation, per-child recovery,
 * asset consolidation, and Discord gate approvals. Interactive: at Discord
 * decision points it pauses and tells the operator what to click; billed image
 * generations happen on the approve path — operator presence required.
 *
 * Scenarios:
 *   happy         prompt gate -> 3-child fan-out -> ordered join -> select ->
 *                 consolidated asset (1 asset, 3 versions, winner current,
 *                 losers trashed) -> selection gate -> complete
 *   reject-prompt reject at the prompt gate -> rewind, ZERO children spawned
 *                 (spend guard) -> approve on second pass -> fan-out
 *   retry-child   cancel one child mid-fan-out -> join blocks -> retry reuses
 *                 the childTaskId -> join completes in source order
 *   cancel-parent cancel the parent mid-fan-out -> every live child cancelled
 *
 * Usage:
 *   bun scripts/validate-map-select.ts --scenario happy [--agent main] [--report out.md]
 *
 * Runbook: docs/validation/map-select-runbook.md
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline/promises'
import { getContentDir } from '../packages/core/src/content-dir'

const BAKIN_URL = process.env.BAKIN_URL || 'http://localhost:3737'
const APPROVALS_DIR = join(getContentDir(), 'workflows', 'approvals')
const WORKFLOW_ID = 'image-multi-select'
const MAP_STEP_ID = 'generate-variants'

const AGENT_WAIT_MS = 15 * 60 * 1000
const DECISION_WAIT_MS = 10 * 60 * 1000
const POLL_MS = 5000

interface Check { id: string; desc: string; pass: boolean; evidence: string }

interface MapChildEntry { index: number; childTaskId: string; status: string; output?: Record<string, unknown> }
interface Instance {
  instanceId: string
  workflowId: string
  status: string
  currentStepId: string
  stepStates: Record<string, { status: string; output?: Record<string, unknown>; children?: MapChildEntry[]; code?: string }>
}
interface ApprovalRecord {
  approvalId: string
  status: string
  owner: { taskId?: string; stepId?: string }
  deliveries: Array<{ channelId: string; ref: string }>
  response?: { actor?: { source?: string } }
  createdAt: string
}
interface AssetManifest {
  assetId: string
  currentVersion: number
  versions: Array<{ version: number; consolidatedFrom?: { assetId: string; version: number } }>
}

const checks: Check[] = []
const rl = createInterface({ input: process.stdin, output: process.stdout })

function record(id: string, desc: string, pass: boolean, evidence = ''): void {
  checks.push({ id, desc, pass, evidence })
  console.log(`  ${pass ? '✅' : '❌'} [${id}] ${desc}${evidence ? ` — ${evidence}` : ''}`)
}

async function confirm(id: string, desc: string, question: string): Promise<void> {
  const answer = (await rl.question(`  ❓ [${id}] ${question} (y/n) `)).trim().toLowerCase()
  record(id, desc, answer === 'y' || answer === 'yes', 'operator confirmation')
}

async function pause(message: string): Promise<void> {
  await rl.question(`\n  👉 ${message}\n     Press Enter when done. `)
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BAKIN_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function waitFor<T>(label: string, timeoutMs: number, probe: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs
  process.stdout.write(`  ⏳ waiting: ${label} `)
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== null) { console.log('done'); return value }
    process.stdout.write('.')
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
  console.log('timeout')
  throw new Error(`Timed out waiting for: ${label}`)
}

async function getInstance(taskId: string): Promise<Instance | null> {
  try {
    const body = await api<{ instance?: Instance }>(`/api/plugins/workflows/instances/${encodeURIComponent(taskId)}`)
    return body.instance ?? null
  } catch { return null }
}

function latestApproval(taskId: string, stepId: string, status = 'pending'): ApprovalRecord | null {
  try {
    return readdirSync(APPROVALS_DIR)
      .filter(n => n.endsWith('.json'))
      .map(n => JSON.parse(readFileSync(join(APPROVALS_DIR, n), 'utf-8')) as ApprovalRecord)
      .filter(r => r.owner.taskId === taskId && r.owner.stepId === stepId && r.status === status)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null
  } catch { return null }
}

async function createRunTask(agent: string, label: string): Promise<string> {
  const result = await api<{ ok: boolean; id: string }>('/api/plugins/tasks/', {
    method: 'POST',
    body: JSON.stringify({
      title: `[validation] multi-image-select ${label} ${new Date().toISOString()}`,
      description: 'Validation run: a cozy reading nook with a sleeping cat, warm afternoon light. Square social image, draft quality — this is a TEST, keep generation cheap.',
      assignee: agent,
      workflowId: WORKFLOW_ID,
      createdBy: 'validate-map-select',
    }),
  })
  console.log(`  📋 created task ${result.id}`)
  return result.id
}

async function waitForGate(taskId: string, stepId: string): Promise<Instance> {
  return waitFor(`task ${taskId} to reach gate ${stepId}`, AGENT_WAIT_MS, async () => {
    const i = await getInstance(taskId)
    return i?.status === 'pending_approval' && i.currentStepId === stepId ? i : null
  })
}

/** Shared journey: create task -> prompt gate -> approve in Discord -> fan-out. */
async function runThroughFanOut(agent: string, label: string): Promise<{ taskId: string; entries: MapChildEntry[] }> {
  const taskId = await createRunTask(agent, label)
  await waitForGate(taskId, 'prompt-gate')
  record('gate', 'prompt-gate entered pending_approval', true)
  record('spend-guard', 'zero children exist before prompt approval',
    (await getInstance(`${taskId}--${MAP_STEP_ID}--0`)) === null)

  await pause('Approve the PROMPT gate from the Discord approvals channel now.')
  const fanned = await waitFor('map fan-out after approval', DECISION_WAIT_MS, async () => {
    const i = await getInstance(taskId)
    const entries = i?.stepStates[MAP_STEP_ID]?.children
    return entries && entries.length > 0 ? i : null
  })
  const entries = fanned.stepStates[MAP_STEP_ID].children!
  record('fan-out', 'exactly 3 children spawned', entries.length === 3, `${entries.length} children`)
  record('fan-out', 'childTaskIds follow {task}--{step}--{i}',
    entries.every((e, i) => e.childTaskId === `${taskId}--${MAP_STEP_ID}--${i}`))

  for (const entry of entries) {
    const child = await getInstance(entry.childTaskId)
    const pc = (child as unknown as { parentContext?: Record<string, unknown> })?.parentContext
    record('fan-out', `child ${entry.index} carries variant + map coordinates`,
      !!child && !!pc && typeof pc.variant === 'string' && pc.mapIndex === entry.index && pc.mapTotal === 3,
      child ? `workflow ${child.workflowId}` : 'child instance missing')
  }
  return { taskId, entries }
}

async function waitForJoin(taskId: string): Promise<Instance> {
  const joined = await waitFor('all children complete -> join', AGENT_WAIT_MS, async () => {
    const i = await getInstance(taskId)
    return i?.stepStates[MAP_STEP_ID]?.status === 'complete' ? i : null
  })
  const aggregate = joined.stepStates[MAP_STEP_ID].output as { outputs?: Array<{ assetId?: string }> }
  record('join', 'aggregate holds 3 outputs in source order', aggregate?.outputs?.length === 3,
    JSON.stringify(aggregate?.outputs?.map(o => o.assetId)))
  return joined
}

async function verifyConsolidation(taskId: string): Promise<void> {
  const selected = await waitFor('select-best output', AGENT_WAIT_MS, async () => {
    const i = await getInstance(taskId)
    const out = i?.stepStates['select-best']?.output as { assetId?: string } | undefined
    return out?.assetId ? { i: i!, assetId: out.assetId } : null
  })
  const winner = await api<{ asset?: AssetManifest }>(`/api/plugins/assets/versioned/${encodeURIComponent(selected.assetId)}`)
    .then(b => b.asset ?? (b as unknown as AssetManifest)).catch(() => null)
  if (!winner) {
    record('consolidate', 'winner asset readable', false, selected.assetId)
    return
  }
  const absorbed = winner.versions.filter(v => v.consolidatedFrom)
  record('consolidate', 'winner carries 3 versions (2 absorbed with provenance)',
    winner.versions.length === 3 && absorbed.length === 2,
    `versions=${winner.versions.length} absorbed=${absorbed.length}`)
  const join = (await getInstance(taskId))!.stepStates[MAP_STEP_ID].output as { outputs: Array<{ assetId: string }> }
  const loserIds = join.outputs.map(o => o.assetId).filter(id => id !== selected.assetId)
  for (const loserId of loserIds) {
    const gone = await api(`/api/plugins/assets/versioned/${encodeURIComponent(loserId)}`).then(() => false).catch(() => true)
    record('consolidate', `loser ${loserId} left the live asset list`, gone)
  }
  await confirm('consolidate', 'asset list shows ONE multi-version asset for this run',
    'In the Bakin Assets UI: is there exactly one asset for this run, with 3 versions and the winner as current?')
}

async function scenarioHappy(agent: string): Promise<void> {
  console.log('\n▶ Scenario: happy')
  const { taskId } = await runThroughFanOut(agent, 'happy')
  await waitForJoin(taskId)
  await verifyConsolidation(taskId)

  await waitForGate(taskId, 'selection-gate')
  const rec = latestApproval(taskId, 'selection-gate')
  record('gate', 'selection-gate approval record delivered', !!rec && rec.deliveries.length > 0)
  await pause('Approve the SELECTION gate from Discord now.')
  const done = await waitFor('workflow completion', AGENT_WAIT_MS, async () => {
    const i = await getInstance(taskId)
    return i?.status === 'complete' ? i : null
  })
  const approval = latestApproval(taskId, 'selection-gate', 'approved')
  record('gate', 'selection approval recorded with source=channel',
    approval?.response?.actor?.source === 'channel', JSON.stringify(approval?.response?.actor))
  record('complete', 'workflow ran to completion', done.status === 'complete')
}

async function scenarioRejectPrompt(agent: string): Promise<void> {
  console.log('\n▶ Scenario: reject-prompt')
  const taskId = await createRunTask(agent, 'reject-prompt')
  await waitForGate(taskId, 'prompt-gate')

  await pause('REJECT the prompt gate from Discord now (any reason).')
  await waitFor('rewind to develop-prompt', DECISION_WAIT_MS, async () => {
    const i = await getInstance(taskId)
    return i?.currentStepId === 'develop-prompt' && i.status === 'in_progress' ? i : null
  })
  record('reject', 'rejection rewound to develop-prompt', true)
  record('spend-guard', 'zero children spawned across the rejected pass',
    (await getInstance(`${taskId}--${MAP_STEP_ID}--0`)) === null)

  await waitForGate(taskId, 'prompt-gate')
  record('reject', 'agent re-drafted and re-reached the prompt gate', true)
  await pause('APPROVE the prompt gate this time.')
  await waitFor('fan-out on second pass', DECISION_WAIT_MS, async () => {
    const i = await getInstance(taskId)
    return (i?.stepStates[MAP_STEP_ID]?.children?.length ?? 0) === 3 ? i : null
  })
  record('reject', 'second pass fanned out 3 children', true)
  console.log('  ℹ Run continues in the background — approve/cancel it from the UI when convenient.')
}

async function scenarioRetryChild(agent: string): Promise<void> {
  console.log('\n▶ Scenario: retry-child')
  const { taskId, entries } = await runThroughFanOut(agent, 'retry-child')
  const victim = entries[1]

  await api(`/api/plugins/workflows/instances/${encodeURIComponent(taskId)}/map/${MAP_STEP_ID}/children/1/cancel`, { method: 'POST', body: '{}' })
  record('recovery', 'child 1 cancelled via route', true, victim.childTaskId)

  await waitFor('siblings complete while join blocks', AGENT_WAIT_MS, async () => {
    const i = await getInstance(taskId)
    const cs = i?.stepStates[MAP_STEP_ID]?.children
    return cs && cs[0].status === 'complete' && cs[2].status === 'complete' ? i : null
  })
  const blocked = (await getInstance(taskId))!
  record('recovery', 'join blocked on the cancelled child',
    blocked.stepStates[MAP_STEP_ID].status === 'in_progress' && blocked.currentStepId === MAP_STEP_ID)

  await api(`/api/plugins/workflows/instances/${encodeURIComponent(taskId)}/map/${MAP_STEP_ID}/children/1/retry`, {
    method: 'POST', body: JSON.stringify({ reason: 'validation retry' }),
  })
  const revived = await getInstance(victim.childTaskId)
  record('recovery', 'retry re-created the SAME childTaskId', revived?.status === 'in_progress', victim.childTaskId)

  await waitForJoin(taskId)
  record('recovery', 'join completed after retry', true)
  console.log('  ℹ Run continues (select-best etc.) — drive or cancel it from the UI when convenient.')
}

async function scenarioCancelParent(agent: string): Promise<void> {
  console.log('\n▶ Scenario: cancel-parent')
  const { taskId, entries } = await runThroughFanOut(agent, 'cancel-parent')

  // Move the parent task off the board — the bridge cancels the instance tree.
  await api(`/api/plugins/tasks/${encodeURIComponent(taskId)}/move`, {
    method: 'POST', body: JSON.stringify({ to: 'blocked' }),
  }).catch(async () => {
    // Fallback: block via task update if the move route differs.
    await api(`/api/plugins/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT', body: JSON.stringify({ id: taskId, column: 'blocked' }),
    })
  })

  await waitFor('parent instance cancelled', DECISION_WAIT_MS, async () => {
    const i = await getInstance(taskId)
    return i?.status === 'cancelled' ? i : null
  })
  for (const entry of entries) {
    const child = await getInstance(entry.childTaskId)
    record('cancel', `child ${entry.index} swept`,
      child === null || child.status === 'cancelled' || child.status === 'complete',
      child?.status ?? 'missing')
  }
}

function printReport(reportPath?: string): void {
  const passed = checks.filter(c => c.pass).length
  console.log(`\n━━━ ${passed}/${checks.length} checks passed ━━━`)
  for (const c of checks.filter(c => !c.pass)) console.log(`  ❌ [${c.id}] ${c.desc} — ${c.evidence}`)
  if (reportPath) {
    const lines = [
      `# map-select validation report — ${new Date().toISOString()}`,
      '',
      `**${passed}/${checks.length} checks passed**`,
      '',
      '| # | check | result | evidence |',
      '|---|-------|--------|----------|',
      ...checks.map((c, i) => `| ${i + 1} | [${c.id}] ${c.desc} | ${c.pass ? '✅' : '❌'} | ${c.evidence.replaceAll('|', '\\|')} |`),
    ]
    writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8')
    console.log(`Report written to ${reportPath}`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const eq = args.find(a => a.startsWith(`--${name}=`))
    if (eq) return eq.split('=').slice(1).join('=')
    const idx = args.indexOf(`--${name}`)
    const next = idx >= 0 ? args[idx + 1] : undefined
    return next && !next.startsWith('--') ? next : undefined
  }
  const scenario = flag('scenario')
  const agent = flag('agent') || 'main'
  const reportPath = flag('report')

  const known = ['happy', 'reject-prompt', 'retry-child', 'cancel-parent']
  if (!scenario || !known.includes(scenario)) {
    if (scenario) console.error(`Unknown scenario: ${scenario}`)
    console.log('Usage: bun scripts/validate-map-select.ts --scenario <happy|reject-prompt|retry-child|cancel-parent> [--agent main] [--report out.md]')
    process.exit(1)
  }

  // Pre-flight: server, workflow, image route, asset bytes over HTTP.
  await api('/api/plugins/workflows/gates/pending').catch((err) => {
    console.error(`Bakin server not reachable at ${BAKIN_URL}: ${err.message}`)
    process.exit(1)
  })
  const defs = await api<{ templates?: Array<{ filename: string }> }>('/api/plugins/workflows/definitions')
  if (!defs.templates?.some(t => t.filename.replace(/\.ya?ml$/, '') === WORKFLOW_ID)) {
    console.error(`Workflow "${WORKFLOW_ID}" not available on the server — is this build running the images plugin defaults?`)
    process.exit(1)
  }
  console.log(`Bakin server: ${BAKIN_URL}\nAgent: ${agent}\nScenario: ${scenario}`)
  console.log('Pre-flight reminders (see docs/validation/map-select-runbook.md):')
  console.log('  - image route usable? Ask the agent to run bakin_exec_images_recommend, or check the images health check')
  console.log('  - asset bytes reachable from the agent container? curl $BAKIN_URL/api/assets/<known-id> from inside the rig')

  try {
    if (scenario === 'happy') await scenarioHappy(agent)
    if (scenario === 'reject-prompt') await scenarioRejectPrompt(agent)
    if (scenario === 'retry-child') await scenarioRetryChild(agent)
    if (scenario === 'cancel-parent') await scenarioCancelParent(agent)
  } catch (err) {
    console.error(`\nScenario aborted: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    printReport(reportPath)
    rl.close()
  }
  process.exit(checks.length > 0 && checks.every(c => c.pass) ? 0 : 1)
}

await main()
