/**
 * Rig validation campaign — exhaustive functional tests + benchmarks for the
 * session-death-hardening surface against the REAL dockerized OpenClaw
 * (`bun run instance up` first). Lives under scripts/instance/ (the rig is
 * adapter-layer dev tooling and exempt from the provider-boundary rules);
 * everything targets the disposable dev/openclaw-home, never ~/.openclaw.
 *
 *   bun run scripts/instance/validate.ts [--skip-failure-drill]
 *
 * Phases:
 *   R1  sanity (gateway health, agents)
 *   R2  functional e2e (real turn, per-attempt sessions, trajectory schema,
 *       forensics parse of REAL files, session-store mapping)
 *   R3  concurrency probes (same-agent + cross-agent if available) — the
 *       gating data for raising settings.dispatch.maxTurnsPerAgent (#435)
 *   R4  benchmarks (turn RTT, forensics parse throughput, sessions.json cost)
 *   R5  failure drill (gateway restart mid-turn → typed transport error,
 *       recovery on reconnect)
 *   R6  session retention probe (#435)
 */
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const REPO = resolve(import.meta.dir, '..', '..')
const OPENCLAW_HOME = join(REPO, 'dev', 'openclaw-home')

// Must be set BEFORE adapter imports (module-load env reads).
process.env.OPENCLAW_HOME = OPENCLAW_HOME
process.env.BAKIN_HOME = mkdtempSync(join(tmpdir(), 'bakin-rig-validate-'))
process.env.BAKIN_DISABLE_FILE_LOG = '1'

const { createOpenClawRuntimeAdapter } = await import('../../packages/adapter-openclaw/src/index')
const { inspectTrajectoryRun, trajectoryFilePathFor } = await import('../../packages/adapter-openclaw/src/trajectory-forensics')
const { RuntimeError } = await import('../../packages/core/src/adapters/runtime')

const skipFailureDrill = process.argv.includes('--skip-failure-drill')
const runtime = createOpenClawRuntimeAdapter()
const results: Array<{ id: string; ok: boolean; detail: string }> = []
const bench: Array<{ metric: string; value: string }> = []

function report(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${id} — ${detail}`)
}

function metric(name: string, value: string): void {
  bench.push({ metric: name, value })
  console.log(`  ⏱ ${name}: ${value}`)
}

const TINY_PROMPT = 'Reply with exactly the word: ok'
const runStamp = Date.now()

// NOTE: no toolsMode/toolsAllow here — the current containerized OpenClaw
// rejects them as unexpected agent params ("invalid agent params: unexpected
// property 'toolsMode'"). Pre-existing adapter↔gateway contract drift,
// surfaced by the typed-error pipeline; tracked separately.
async function timedSend(agentId: string, threadId: string, prompt = TINY_PROMPT): Promise<{ ms: number; content: string; sessionId?: string; startedAt: number; endedAt: number }> {
  const startedAt = Date.now()
  const result = await runtime.messaging.send({ agentId, content: prompt, threadId })
  const endedAt = Date.now()
  return {
    ms: endedAt - startedAt,
    content: result.content ?? '',
    sessionId: (result.metadata as { sessionId?: string } | undefined)?.sessionId,
    startedAt,
    endedAt,
  }
}

// ─── R1: sanity ─────────────────────────────────────────────────────────────
console.log('\n━━ R1 sanity ━━')
const healthy = await runtime.ping()
report('R1.1 gateway ping', healthy, healthy ? 'gateway reachable' : 'gateway unreachable — is the rig up?')
if (!healthy) process.exit(1)

const agents = await runtime.agents.list()
const agentIds = agents.map((a) => a.id)
report('R1.2 agents', agentIds.length > 0, `roster: ${agentIds.join(', ')}`)
const primary = agentIds.includes('main') ? 'main' : agentIds[0]!
const secondary = agentIds.find((id) => id !== primary)

// ─── R2: functional e2e ─────────────────────────────────────────────────────
console.log('\n━━ R2 functional e2e (real turns, real files) ━━')
const t1 = await timedSend(primary, `task:rigval-${runStamp}:d1`)
report('R2.1 real dispatch turn', t1.content.length > 0, `content="${t1.content.slice(0, 60)}" in ${t1.ms}ms`)
report('R2.2 sessionId in MessageResult', !!t1.sessionId, `sessionId=${t1.sessionId}`)

const trajectoryFile = t1.sessionId ? trajectoryFilePathFor(primary, t1.sessionId) : ''
const trajectoryExists = !!trajectoryFile && existsSync(trajectoryFile)
report('R2.3 deterministic trajectory path', trajectoryExists, trajectoryFile || 'no sessionId')

if (trajectoryExists) {
  const raw = readFileSync(trajectoryFile, 'utf-8')
  const first = JSON.parse(raw.split('\n').find((l) => l.trim()) ?? '{}')
  report(
    'R2.4 live trajectory schema',
    first.traceSchema === 'openclaw-trajectory' && first.schemaVersion === 1,
    `traceSchema=${first.traceSchema} schemaVersion=${first.schemaVersion} (parser supports v1)`,
  )

  const parseStart = performance.now()
  const outcome = inspectTrajectoryRun({ trajectoryFile, sinceByteOffset: 0 })
  const parseMs = performance.now() - parseStart
  const contentMatches = outcome?.kind === 'success' && outcome.content.includes(t1.content.trim().slice(0, 10))
  report(
    'R2.5 forensics vs REAL trajectory',
    outcome?.kind === 'success',
    `outcome=${outcome?.kind}${outcome?.kind === 'success' ? `, contentMatch=${contentMatches}` : ''} (parsed in ${parseMs.toFixed(1)}ms)`,
  )
}

const t2 = await timedSend(primary, `task:rigval-${runStamp}:d2`)
report(
  'R2.6 per-attempt session isolation',
  !!t2.sessionId && t2.sessionId !== t1.sessionId,
  `d1=${t1.sessionId?.slice(0, 8)} d2=${t2.sessionId?.slice(0, 8)} (distinct sessions)`,
)
const sessionsJson = join(OPENCLAW_HOME, 'agents', primary, 'sessions', 'sessions.json')
const storeRaw = existsSync(sessionsJson) ? readFileSync(sessionsJson, 'utf-8') : '{}'
const storeHasBoth = !!t1.sessionId && !!t2.sessionId && storeRaw.includes(t1.sessionId) && storeRaw.includes(t2.sessionId)
report('R2.7 sessions.json mapping', storeHasBoth, `store=${(statSync(sessionsJson).size / 1024).toFixed(1)}KB, both attempt sessions present`)

// ─── R3: concurrency probes (#435) ─────────────────────────────────────────
console.log('\n━━ R3 concurrency probes ━━')
{
  // Same-agent: two simultaneous turns in distinct per-attempt sessions.
  const [a, b] = await Promise.all([
    timedSend(primary, `task:rigconc-${runStamp}-a:d1`),
    timedSend(primary, `task:rigconc-${runStamp}-b:d1`),
  ])
  const wall = Math.max(a.endedAt, b.endedAt) - Math.min(a.startedAt, b.startedAt)
  const sum = a.ms + b.ms
  const overlapRatio = sum / wall // ~1 → serialized; ~2 → fully concurrent
  const concurrent = overlapRatio > 1.4
  report(
    'R3.1 same-agent concurrency',
    true,
    `wall=${wall}ms sum=${sum}ms ratio=${overlapRatio.toFixed(2)} → ${concurrent ? 'CONCURRENT (gateway does NOT serialize per agent — raising maxTurnsPerAgent is viable)' : 'SERIALIZED (keep maxTurnsPerAgent=1)'}`,
  )
  metric('same-agent overlap ratio', overlapRatio.toFixed(2))
}
if (secondary) {
  const [a, b] = await Promise.all([
    timedSend(primary, `task:rigx-${runStamp}-a:d1`),
    timedSend(secondary, `task:rigx-${runStamp}-b:d1`),
  ])
  const wall = Math.max(a.endedAt, b.endedAt) - Math.min(a.startedAt, b.startedAt)
  const ratio = (a.ms + b.ms) / wall
  report('R3.2 cross-agent concurrency', ratio > 1.4, `ratio=${ratio.toFixed(2)} (expected concurrent)`)
  metric('cross-agent overlap ratio', ratio.toFixed(2))
} else {
  report('R3.2 cross-agent concurrency', true, 'skipped — single-agent rig (only checks same-agent)')
}

// ─── R4: benchmarks ─────────────────────────────────────────────────────────
console.log('\n━━ R4 benchmarks ━━')
{
  const samples: number[] = []
  for (let i = 0; i < 3; i++) {
    const t = await timedSend(primary, `task:rigbench-${runStamp}-${i}:d1`)
    samples.push(t.ms)
  }
  samples.sort((x, y) => x - y)
  metric('turn RTT (3 samples, sorted)', samples.map((s) => `${s}ms`).join(' / '))
}
{
  // Forensics parse throughput on an incident-shaped synthetic trajectory.
  const dir = mkdtempSync(join(tmpdir(), 'rig-bench-'))
  const file = join(dir, 'bench.trajectory.jsonl')
  const big = 'X'.repeat(262_144)
  const base = { traceSchema: 'openclaw-trajectory', schemaVersion: 1, sessionId: 'bench', runId: 'r1' }
  const toolEvents = Array.from({ length: 60 }, (_, i) =>
    JSON.stringify({ ...base, type: i % 2 ? 'tool.result' : 'tool.call', seq: i + 2, data: { name: `tool-${i}` } }))
  writeFileSync(file, [
    JSON.stringify({ ...base, type: 'session.started', seq: 1, data: {} }),
    ...toolEvents,
    JSON.stringify({ ...base, type: 'model.completed', seq: 99, data: { assistantTexts: [big], timedOut: false } }),
    JSON.stringify({ ...base, type: 'session.ended', seq: 100, data: { status: 'interrupted', timedOut: false } }),
  ].join('\n') + '\n')
  const start = performance.now()
  for (let i = 0; i < 20; i++) inspectTrajectoryRun({ trajectoryFile: file, sinceByteOffset: 0 })
  const per = (performance.now() - start) / 20
  metric('forensics parse (262KB + 60 tool events)', `${per.toFixed(2)}ms/inspect (${(statSync(file).size / 1024).toFixed(0)}KB file)`)
  report('R4 forensics parse budget', per < 50, `${per.toFixed(2)}ms — ${per < 50 ? 'well under' : 'EXCEEDS'} the 200ms poll budget`)
}
{
  const start = performance.now()
  for (let i = 0; i < 50; i++) JSON.parse(readFileSync(sessionsJson, 'utf-8'))
  const per = (performance.now() - start) / 50
  metric('sessions.json uncached parse', `${per.toFixed(2)}ms (mtime cache amortizes this)`)
}

// ─── R5: failure drill ──────────────────────────────────────────────────────
console.log('\n━━ R5 failure drill (gateway restart mid-turn) ━━')
if (skipFailureDrill) {
  report('R5 failure drill', true, 'skipped (--skip-failure-drill)')
} else {
  const drill = timedSend(primary, `task:rigdrill-${runStamp}:d1`, 'Count slowly from 1 to 30, one number per line.')
  await new Promise((r) => setTimeout(r, 1500)) // let the turn start server-side
  const restart = Bun.spawn(['docker', 'restart', 'bakin-openclaw-gateway'], { stdout: 'pipe', stderr: 'pipe' })
  await restart.exited
  try {
    const recovered = await drill
    report('R5.1 mid-turn gateway death', true, `turn RESOLVED (post-mortem recovery or fast finish): "${recovered.content.slice(0, 40)}…"`)
  } catch (err) {
    const typed = err instanceof RuntimeError
    report('R5.1 mid-turn gateway death', typed, `typed=${typed} kind=${typed ? (err as InstanceType<typeof RuntimeError>).kind : 'n/a'} msg=${(err as Error).message.slice(0, 80)}`)
  }
  // Wait for the gateway to come back, then prove recovery.
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:18789/healthz')
      if (res.ok) break
    } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  const after = await timedSend(primary, `task:rigdrill-${runStamp}:d2`)
  report('R5.2 post-restart recovery', after.content.length > 0, `turn ok in ${after.ms}ms after gateway restart`)
}

// ─── R6: session retention probe (#435) ─────────────────────────────────────
console.log('\n━━ R6 session retention probe ━━')
{
  const sessionsDir = join(OPENCLAW_HOME, 'agents', primary, 'sessions')
  const files = readdirSync(sessionsDir)
  const sessionFiles = files.filter((f) => f.endsWith('.jsonl') && !f.includes('trajectory'))
  const trajectories = files.filter((f) => f.endsWith('.trajectory.jsonl'))
  const storeKB = (statSync(sessionsJson).size / 1024).toFixed(1)
  const config = JSON.parse(readFileSync(join(OPENCLAW_HOME, 'openclaw.json'), 'utf-8'))
  const retentionKeys = JSON.stringify(config).match(/"(prune|retention|maxSessions|sessionTtl)[^"]*"/gi) ?? []
  report(
    'R6.1 session accumulation',
    true,
    `${sessionFiles.length} session files, ${trajectories.length} trajectories, sessions.json=${storeKB}KB after this run`,
  )
  report(
    'R6.2 retention config',
    true,
    retentionKeys.length > 0 ? `found: ${retentionKeys.join(', ')}` : 'NO pruning/retention keys in openclaw.json — upstream concern stands (#435)',
  )
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n━━ Summary ━━')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
for (const b of bench) console.log(`  ${b.metric}: ${b.value}`)
if (failed.length > 0) {
  console.log('\nFailed:')
  for (const f of failed) console.log(`  ✗ ${f.id} — ${f.detail}`)
  process.exit(1)
}
