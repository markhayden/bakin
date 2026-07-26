#!/usr/bin/env bun
/**
 * Gate/Discord e2e validation harness.
 *
 * Drives real workflow runs against a LIVE Bakin server and verifies the gate
 * approval + channel notification contract end-to-end. Interactive: at Discord
 * decision points it pauses and tells the operator what to click; human-visible
 * checks (message appearance, buttons) are confirmed y/n and recorded alongside
 * the machine-checked assertions.
 *
 * Scenarios (SPEC.md user stories):
 *   delivery   (us1)      create task -> gate -> Discord approval request arrives
 *   approve    (us2, us6) delivery + native-button approve -> advance -> publish
 *   reject     (us3)      button reject (default reason) -> rewind -> re-gate ->
 *                         fallback-page reject (typed reason) -> rewind -> approve
 *   ui-approve (us4)      gate -> approve via Bakin REST -> Discord mirrors decision
 *   nested     (us5, us6) image-social-post run: nested workflow gates + publish
 *
 * Usage:
 *   bun scripts/validate-gates.ts --scenario approve [--agent main] [--report out.md]
 *   bun scripts/validate-gates.ts --all --report docs/validation/report.md
 *
 * Runbook: docs/validation/gate-discord-runbook.md
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline/promises'
import { getContentDir } from '../packages/core/src/content-dir'

const BAKIN_URL = process.env.BAKIN_URL || 'http://localhost:3737'
const APPROVALS_DIR = join(getContentDir(), 'workflows', 'approvals')

const GATE_WAIT_MS = 15 * 60 * 1000 // real agent turn precedes the gate
const DECISION_WAIT_MS = 10 * 60 * 1000
const POLL_MS = 5000

interface Check {
  us: string
  desc: string
  pass: boolean
  evidence: string
}

interface ApprovalRecord {
  approvalId: string
  status: string
  owner: { taskId?: string; stepId?: string; runId?: string }
  deliveries: Array<{ channelId: string; ref: string; renderedAt: string }>
  response?: { selectedOption?: string; comment?: string }
  request: { context?: Record<string, unknown> }
  createdAt: string
}

interface Instance {
  instanceId: string
  workflowId: string
  status: string
  currentStepId: string
  stepStates: Record<string, { status: string; output?: unknown }>
}

const checks: Check[] = []
const createdTaskIds: string[] = []
const rl = createInterface({ input: process.stdin, output: process.stdout })

function record(us: string, desc: string, pass: boolean, evidence: string): void {
  checks.push({ us, desc, pass, evidence })
  console.log(`  ${pass ? '✅' : '❌'} [${us}] ${desc}${evidence ? ` — ${evidence}` : ''}`)
}

async function confirm(us: string, desc: string, question: string): Promise<void> {
  const answer = (await rl.question(`  ❓ [${us}] ${question} (y/n) `)).trim().toLowerCase()
  record(us, desc, answer === 'y' || answer === 'yes', 'operator confirmation')
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
    if (value !== null) {
      console.log('done')
      return value
    }
    process.stdout.write('.')
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
  console.log('timeout')
  throw new Error(`Timed out waiting for: ${label}`)
}

function listApprovalRecords(): ApprovalRecord[] {
  try {
    return readdirSync(APPROVALS_DIR)
      .filter(name => name.endsWith('.json'))
      .map(name => JSON.parse(readFileSync(join(APPROVALS_DIR, name), 'utf-8')) as ApprovalRecord)
  } catch {
    return []
  }
}

function latestRecordFor(taskId: string, status?: string): ApprovalRecord | null {
  const records = listApprovalRecords()
    .filter(r => r.owner.taskId === taskId && (!status || r.status === status))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return records[0] ?? null
}

async function getInstance(taskId: string): Promise<Instance | null> {
  try {
    const body = await api<{ instance?: Instance } | Instance>(`/api/plugins/workflows/instances/${encodeURIComponent(taskId)}`)
    const instance = (body as { instance?: Instance }).instance ?? (body as Instance)
    return instance?.instanceId ? instance : null
  } catch {
    return null
  }
}

async function createWorkflowTask(workflowId: string, agent: string, title: string, description: string): Promise<string> {
  const result = await api<{ ok: boolean; id: string }>('/api/plugins/tasks/', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description,
      assignee: agent,
      workflowId,
      createdBy: 'validate-gates',
    }),
  })
  createdTaskIds.push(result.id)
  console.log(`  📋 created task ${result.id} (workflow ${workflowId}, agent ${agent})`)
  return result.id
}

async function waitForGate(taskId: string): Promise<Instance> {
  return waitFor(`task ${taskId} to reach a pending gate`, GATE_WAIT_MS, async () => {
    const instance = await getInstance(taskId)
    return instance?.status === 'pending_approval' ? instance : null
  })
}

/** US1 — gate reached -> approval request delivered to the runtime channel. */
async function verifyDelivery(taskId: string, us = 'US1'): Promise<ApprovalRecord> {
  const instance = await waitForGate(taskId)
  record(us, 'gate step entered pending_approval', true, `step ${instance.currentStepId}`)

  const delivered = await waitFor('approval record with persisted deliveries', 60_000, async () => {
    const rec = latestRecordFor(taskId, 'pending')
    return rec && rec.deliveries.length > 0 ? rec : null
  }).catch(() => null)

  if (!delivered) {
    const rec = latestRecordFor(taskId, 'pending')
    record(us, 'approval delivered to channel', false, rec ? 'record exists but deliveries empty (check server log for resolution errors)' : 'no approval record found')
    throw new Error('Delivery failed — aborting scenario. Check ~/.bakin/logs/server.log for gate approval errors.')
  }

  record(us, 'durable approval record persisted with delivery refs', true,
    `${delivered.approvalId} -> ${delivered.deliveries.map(d => `${d.channelId} ${d.ref}`).join(', ')}`)
  await confirm(us, 'approval message arrived in the Discord approvals channel',
    'Did the gate approval message appear in your Discord approvals channel?')
  return delivered
}

async function waitForRecordStatus(approvalId: string, status: string): Promise<ApprovalRecord> {
  return waitFor(`approval ${approvalId} -> ${status}`, DECISION_WAIT_MS, async () => {
    const rec = listApprovalRecords().find(r => r.approvalId === approvalId)
    return rec && rec.status === status ? rec : null
  })
}

async function waitForInstanceState(taskId: string, label: string, predicate: (i: Instance) => boolean): Promise<Instance> {
  return waitFor(label, DECISION_WAIT_MS, async () => {
    const instance = await getInstance(taskId)
    return instance && predicate(instance) ? instance : null
  })
}

async function verifyPublishCompletion(taskId: string, us: string): Promise<void> {
  const complete = await waitFor(`workflow for ${taskId} to complete (publish step)`, GATE_WAIT_MS, async () => {
    const instance = await getInstance(taskId)
    return instance?.status === 'complete' ? instance : null
  }).catch(() => null)
  record(us, 'workflow ran to completion through the publish step', complete !== null,
    complete ? `instance ${complete.instanceId} complete` : 'did not complete in time')
  if (complete) {
    await confirm(us, 'published content arrived in Discord', 'Did the published post appear in Discord?')
  }
}

/** US1+US2(+US6) — full approve journey via native Discord button. */
async function scenarioApprove(workflowId: string, agent: string): Promise<void> {
  console.log('\n▶ Scenario: approve (US1, US2, US6)')
  const taskId = await createWorkflowTask(workflowId, agent,
    `[validation] approve flow ${new Date().toISOString()}`,
    'Validation run: write a short upbeat post about testing automation. Keep it under 3 sentences.')
  const delivered = await verifyDelivery(taskId)

  await confirm('US2', 'native approve/reject buttons render on the Discord message',
    'Does the Discord message show clickable Approve/Reject buttons?')
  await pause('Click **Approve** on the Discord message now.')

  const resolved = await waitForRecordStatus(delivered.approvalId, 'approved')
  record('US2', 'button approve resolved the durable approval record', true,
    `actor ${JSON.stringify((resolved.response as { actor?: unknown })?.actor ?? 'unknown')}`)

  const advanced = await waitForInstanceState(taskId, 'workflow to advance past the gate',
    i => i.status !== 'pending_approval')
  record('US2', 'workflow advanced past the gate after button approve', true, `now ${advanced.status} at ${advanced.currentStepId}`)
  await confirm('US2', 'decision mirrored back to Discord',
    'Was the Discord approval updated/resolved and a decision summary posted?')

  await verifyPublishCompletion(taskId, 'US6')
}

/** US3 — button reject default reason -> rewind -> re-gate -> typed-reason reject via fallback page -> approve. */
async function scenarioReject(workflowId: string, agent: string, rewindStepId: string): Promise<void> {
  console.log('\n▶ Scenario: reject (US3)')
  const taskId = await createWorkflowTask(workflowId, agent,
    `[validation] reject flow ${new Date().toISOString()}`,
    'Validation run: write a short post about morning coffee. Keep it under 3 sentences.')
  const delivered = await verifyDelivery(taskId, 'US3')

  await pause([
    'Click **Reject** on the Discord message now.',
    '  - Delivery bridge (Pi, #669): a modal opens — type the reason "modal validation reason" and submit.',
    '  - OpenClaw native buttons: no modal exists; the reject records the provider-neutral default reason.',
  ].join('\n'))
  const rejected = await waitForRecordStatus(delivered.approvalId, 'rejected')
  const buttonReason = rejected.response?.comment ?? ''
  // Bridge era: the modal carries the TYPED reason. Native-button era: the
  // canned default. Either way a reason must be recorded — never empty.
  record('US3', 'channel reject recorded a reason (typed modal or provider default)',
    buttonReason.length > 0,
    `reason: "${buttonReason}"`)

  const rewound = await waitForInstanceState(taskId, `workflow to rewind to ${rewindStepId}`,
    i => i.currentStepId === rewindStepId && i.status !== 'pending_approval')
  record('US3', `reject rewound the workflow to ${rewindStepId}`, true, `status ${rewound.status}`)

  const regated = await verifyDelivery(taskId, 'US3')
  record('US3', 'revised output re-triggered the gate with a fresh approval', regated.approvalId !== delivered.approvalId,
    `new approval ${regated.approvalId}`)

  const fallbackUrl = String(regated.request.context?.approvalUrl ?? '')
  await pause(`Open the fallback decision page and reject WITH a typed reason (e.g. "typed-reason validation"):\n     ${fallbackUrl}`)
  const rejectedTyped = await waitForRecordStatus(regated.approvalId, 'rejected')
  const typedReason = rejectedTyped.response?.comment ?? ''
  record('US3', 'fallback-page reject carried the typed reason', typedReason.length > 0 && !typedReason.includes('no reason provided'),
    `reason: "${typedReason}"`)

  await waitForInstanceState(taskId, `workflow to rewind to ${rewindStepId} again`,
    i => i.currentStepId === rewindStepId && i.status !== 'pending_approval')
  const finalGate = await verifyDelivery(taskId, 'US3')
  await pause('Click **Approve** on the newest Discord approval to let the workflow finish.')
  await waitForRecordStatus(finalGate.approvalId, 'approved')
  record('US3', 'final approve after two rejects advanced the workflow', true, '')
}

/** US4 — approve from the Bakin API/UI; Discord mirrors the decision. */
async function scenarioUiApprove(workflowId: string, agent: string): Promise<void> {
  console.log('\n▶ Scenario: ui-approve (US4)')
  const taskId = await createWorkflowTask(workflowId, agent,
    `[validation] ui-approve flow ${new Date().toISOString()}`,
    'Validation run: write a short post about sunsets. Keep it under 3 sentences.')
  const delivered = await verifyDelivery(taskId, 'US4')

  await api(`/api/plugins/workflows/gates/${encodeURIComponent(taskId)}/approve`, { method: 'POST', body: '{}' })
  record('US4', 'REST gate approve succeeded', true, `POST /gates/${taskId}/approve`)

  const resolved = await waitForRecordStatus(delivered.approvalId, 'approved')
  record('US4', 'durable approval record resolved from the UI decision', true, resolved.approvalId)
  await confirm('US4', 'Discord approval mirrored the UI decision',
    'Was the pending Discord approval resolved (and/or a decision summary posted)?')
}

/** US5+US6 — nested image workflow gates + publish. */
async function scenarioNested(agent: string): Promise<void> {
  console.log('\n▶ Scenario: nested (US5, US6) — image-social-post, billed image generation')
  const taskId = await createWorkflowTask('image-social-post', agent,
    `[validation] nested flow ${new Date().toISOString()}`,
    'Validation run: a short post celebrating small wins, with a simple, cheap-to-generate abstract image.')

  // The parent workflow's gates and any nested-workflow gates all surface as
  // pending_approval states; approve each via Discord until the run completes.
  const seen = new Set<string>()
  for (;;) {
    const instance = await getInstance(taskId)
    if (instance?.status === 'complete') break
    if (instance?.status === 'failed' || instance?.status === 'cancelled') {
      record('US5', 'nested run ended without completing', false, `status ${instance.status}`)
      return
    }
    const gated = await waitForGate(taskId).catch(() => null)
    if (!gated) {
      record('US5', 'nested run reached a gate before timeout', false, 'no gate before timeout')
      return
    }
    const rec = await verifyDelivery(taskId, 'US5')
    if (!seen.has(rec.approvalId)) {
      seen.add(rec.approvalId)
      record('US5', 'gate identity is correct in the approval message', true,
        `workflow ${rec.owner.runId} step ${rec.owner.stepId}`)
    }
    await pause('Click **Approve** on the newest Discord approval.')
    await waitForRecordStatus(rec.approvalId, 'approved')
    await waitForInstanceState(taskId, 'workflow to advance', i =>
      i.status !== 'pending_approval' || latestRecordFor(taskId, 'pending')?.approvalId !== rec.approvalId)
  }
  record('US5', 'nested workflow gates all approved through Discord', true, `${seen.size} gate(s)`)
  await verifyPublishCompletion(taskId, 'US6')
}

function printReport(reportPath?: string): void {
  const passed = checks.filter(c => c.pass).length
  console.log(`\n═══ Validation report: ${passed}/${checks.length} checks passed ═══`)
  for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} [${c.us}] ${c.desc}${c.evidence ? ` — ${c.evidence}` : ''}`)
  if (createdTaskIds.length > 0) {
    console.log(`\nCreated validation tasks (clean these up — see the runbook): ${createdTaskIds.join(', ')}`)
  }
  if (reportPath) {
    const lines = [
      `# Gate/Discord validation report`,
      ``,
      `Date: ${new Date().toISOString()}  `,
      `Server: ${BAKIN_URL}  `,
      `Result: **${passed}/${checks.length} checks passed**`,
      ``,
      `| | Story | Check | Evidence |`,
      `|---|---|---|---|`,
      ...checks.map(c => `| ${c.pass ? '✅' : '❌'} | ${c.us} | ${c.desc} | ${c.evidence.replace(/\|/g, '\\|')} |`),
      ``,
      `Validation tasks created: ${createdTaskIds.map(id => `\`${id}\``).join(', ') || 'none'}`,
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
  const scenarioAliases: Record<string, string> = {
    us1: 'delivery', us2: 'approve', us3: 'reject', us4: 'ui-approve', us5: 'nested', us6: 'approve',
  }
  const requested = flag('scenario')
  const scenario = requested ? (scenarioAliases[requested] ?? requested) : undefined
  const all = args.includes('--all')
  const agent = flag('agent') || 'main'
  const workflowId = flag('workflow') || 'messaging-blog-prep'
  const rewindStepId = flag('rewind-step') || 'draft'
  const reportPath = flag('report')

  const knownScenarios = ['delivery', 'approve', 'reject', 'ui-approve', 'nested']
  if ((!scenario && !all) || (scenario && !knownScenarios.includes(scenario))) {
    if (scenario) console.error(`Unknown scenario: ${scenario}`)
    console.log('Usage: bun scripts/validate-gates.ts --scenario <delivery|approve|reject|ui-approve|nested|us1..us6> [--agent main] [--workflow messaging-blog-prep] [--report out.md]')
    console.log('       bun scripts/validate-gates.ts --all [--agent main] [--report out.md]')
    process.exit(1)
  }

  // Preflight: server reachable.
  await api('/api/plugins/workflows/gates/pending').catch((err) => {
    console.error(`Bakin server not reachable at ${BAKIN_URL}: ${err.message}`)
    process.exit(1)
  })
  console.log(`Bakin server: ${BAKIN_URL}\nApprovals dir: ${APPROVALS_DIR}\nAgent: ${agent}`)

  try {
    if (all || scenario === 'approve') await scenarioApprove(workflowId, agent)
    if (all || scenario === 'reject') await scenarioReject(workflowId, agent, rewindStepId)
    if (all || scenario === 'ui-approve') await scenarioUiApprove(workflowId, agent)
    if (all || scenario === 'nested') await scenarioNested(agent)
    if (!all && scenario === 'delivery') {
      console.log('\n▶ Scenario: delivery (US1)')
      const taskId = await createWorkflowTask(workflowId, agent,
        `[validation] delivery flow ${new Date().toISOString()}`,
        'Validation run: write a short post about weekend plans. Keep it under 3 sentences.')
      await verifyDelivery(taskId)
      console.log('  ℹ Gate left pending — approve or reject it from Discord/Bakin, or block the task to clean up.')
    }
  } catch (err) {
    console.error(`\nScenario aborted: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    printReport(reportPath)
    rl.close()
  }
  // No checks recorded means the scenario aborted before proving anything —
  // that is a failure, not a vacuous pass.
  process.exit(checks.length > 0 && checks.every(c => c.pass) ? 0 : 1)
}

await main()
