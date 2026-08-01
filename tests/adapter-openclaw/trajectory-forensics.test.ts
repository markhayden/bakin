import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdirSync, rmSync, statSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-forensics-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))

import {
  inspectTrajectoryRun,
  trajectoryFilePathFor,
  watchTrajectoryForDeath,
  TrajectoryRecoveredTurn,
  OPENCLAW_TRAJECTORY_TEXT_LIMIT,
} from '../../packages/adapter-openclaw/src/trajectory-forensics'
import { safeFileSize } from '../../packages/adapter-openclaw/src/file-utils'
import { RuntimeTurnError } from '../../packages/core/src/adapters/runtime'
import { settleFor, waitUntil } from '../helpers/wait'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const SESSION_ID = '69435183-055a-457c-a3ff-379b5cf0d929'

let trajectoryFile: string

function event(type: string, data: Record<string, unknown>, seq: number): string {
  return JSON.stringify({
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 1,
    traceId: SESSION_ID,
    source: 'runtime',
    type,
    ts: '2026-06-04T21:04:29.000Z',
    seq,
    sessionId: SESSION_ID,
    sessionKey: 'agent:jessica:explicit:abc',
    runId: 'run-1',
    provider: 'openai-codex',
    modelId: 'gpt-5.5',
    data,
  })
}

function writeRun(file: string, opts: {
  status: string
  assistantTexts?: string[]
  timedOut?: boolean
  toolCalls?: string[]
  usage?: Record<string, number>
}): void {
  const lines = [
    event('session.started', { sessionFile: file.replace('.trajectory', ''), toolCount: 15 }, 1),
    event('context.compiled', { imagesCount: 0 }, 2),
    event('prompt.submitted', { turnId: 'turn-1' }, 3),
    ...(opts.toolCalls ?? []).map((name, i) => event('tool.call', { name, toolCallId: `tc-${i}` }, 4 + i)),
    event('model.completed', {
      timedOut: opts.timedOut ?? false,
      aborted: false,
      promptError: null,
      usage: opts.usage ?? { input: 42000, output: 12000, total: 54000 },
      assistantTexts: opts.assistantTexts ?? [],
    }, 90),
    event('session.ended', { status: opts.status, timedOut: opts.timedOut ?? false, promptError: null }, 91),
  ]
  appendFileSync(file, lines.join('\n') + '\n')
}

beforeEach(() => {
  const dir = join(testDir, 'openclaw', 'agents', 'jessica', 'sessions')
  mkdirSync(dir, { recursive: true })
  trajectoryFile = join(dir, `${randomUUID()}.trajectory.jsonl`)
  writeFileSync(trajectoryFile, '')
})

describe('inspectTrajectoryRun', () => {
  it('diagnoses the incident shape: oversized completion → interrupted session', () => {
    // Modeled on task-56d382ae: ~600KB drafted in one turn, recorded text
    // truncated at the 262,144-byte trajectory limit, session interrupted.
    const truncated = 'A'.repeat(OPENCLAW_TRAJECTORY_TEXT_LIMIT)
    writeRun(trajectoryFile, {
      status: 'interrupted',
      assistantTexts: [truncated],
      toolCalls: ['bakin_exec_tasks_log_progress'],
    })

    const outcome = inspectTrajectoryRun({ trajectoryFile, oversizedOutputBytes: 131072 })
    expect(outcome?.kind).toBe('death')
    if (outcome?.kind !== 'death') return
    const d = outcome.diagnosis
    expect(d.reason).toBe('session_interrupted')
    expect(d.sessionStatus).toBe('interrupted')
    expect(d.sessionId).toBe(SESSION_ID)
    expect(d.timedOut).toBe(false)
    expect(d.completionBytes).toBe(OPENCLAW_TRAJECTORY_TEXT_LIMIT)
    expect(d.outputTruncated).toBe(true)
    expect(d.oversizedOutput).toBe(true)
    expect(d.lastToolCall).toBe('bakin_exec_tasks_log_progress')
    expect(d.salvagedText?.length).toBe(OPENCLAW_TRAJECTORY_TEXT_LIMIT)
    expect(d.usage?.total).toBe(54000)
    expect(d.detail).toContain('oversized model completion')
    expect(d.detail).toContain('256KB, truncated')
  })

  it('returns success with the recovered content for a clean run', () => {
    writeRun(trajectoryFile, { status: 'success', assistantTexts: ['All six assets saved: a1..a6'] })
    const outcome = inspectTrajectoryRun({ trajectoryFile })
    expect(outcome).toEqual({
      kind: 'success',
      content: 'All six assets saved: a1..a6',
      sessionId: SESSION_ID,
      usage: { input: 42000, output: 12000, total: 54000 },
    })
  })

  it('surfaces token usage on a successful run', () => {
    writeRun(trajectoryFile, {
      status: 'success',
      assistantTexts: ['done'],
      usage: { input: 1234, output: 567, total: 1801 },
    })
    const outcome = inspectTrajectoryRun({ trajectoryFile })
    expect(outcome?.kind).toBe('success')
    if (outcome?.kind !== 'success') return
    expect(outcome.usage).toEqual({ input: 1234, output: 567, total: 1801 })
  })

  it('omits usage on a successful run that recorded none', () => {
    // No model.completed usage block → honest absence, never zero-filled.
    const dir = join(testDir, 'openclaw', 'agents', 'jessica', 'sessions')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${randomUUID()}.trajectory.jsonl`)
    const lines = [
      event('session.started', {}, 1),
      JSON.stringify({
        traceSchema: 'openclaw-trajectory', schemaVersion: 1, traceId: SESSION_ID,
        source: 'runtime', type: 'model.completed', ts: '2026-06-04T21:04:29.000Z',
        seq: 90, sessionId: SESSION_ID, data: { timedOut: false, aborted: false, assistantTexts: ['ok'] },
      }),
      event('session.ended', { status: 'success', timedOut: false }, 91),
    ]
    writeFileSync(file, lines.join('\n') + '\n')
    const outcome = inspectTrajectoryRun({ trajectoryFile: file })
    expect(outcome?.kind).toBe('success')
    if (outcome?.kind !== 'success') return
    expect(outcome.usage).toBeUndefined()
  })

  it('flags oversized-but-not-truncated completions (between threshold and trajectory limit)', () => {
    // ~150KB: above the 128KB oversized threshold, below the 262,144-byte
    // trajectory truncation limit — the realistic middle band.
    writeRun(trajectoryFile, { status: 'interrupted', assistantTexts: ['B'.repeat(150_000)] })
    const outcome = inspectTrajectoryRun({ trajectoryFile, oversizedOutputBytes: 131072 })
    expect(outcome?.kind).toBe('death')
    if (outcome?.kind !== 'death') return
    expect(outcome.diagnosis.oversizedOutput).toBe(true)
    expect(outcome.diagnosis.outputTruncated).toBe(false)
    expect(outcome.diagnosis.completionBytes).toBe(150_000)
  })

  it('flags interrupted-but-small completions without the oversized flag', () => {
    writeRun(trajectoryFile, { status: 'interrupted', assistantTexts: ['short reply'] })
    const outcome = inspectTrajectoryRun({ trajectoryFile })
    expect(outcome?.kind).toBe('death')
    if (outcome?.kind !== 'death') return
    expect(outcome.diagnosis.oversizedOutput).toBe(false)
    expect(outcome.diagnosis.outputTruncated).toBe(false)
    expect(outcome.diagnosis.reason).toBe('session_interrupted')
  })

  it('classifies a server-side timed-out run as runtime_timeout', () => {
    writeRun(trajectoryFile, { status: 'interrupted', timedOut: true, assistantTexts: [] })
    const outcome = inspectTrajectoryRun({ trajectoryFile })
    expect(outcome?.kind).toBe('death')
    if (outcome?.kind !== 'death') return
    expect(outcome.diagnosis.reason).toBe('runtime_timeout')
    expect(outcome.diagnosis.timedOut).toBe(true)
  })

  it('only inspects events after the provided byte offset (per-attempt scoping)', () => {
    // Run 1 died before this attempt started — must be invisible.
    writeRun(trajectoryFile, { status: 'interrupted', assistantTexts: ['old dead run'] })
    const offset = safeFileSize(trajectoryFile)
    writeRun(trajectoryFile, { status: 'success', assistantTexts: ['fresh run output'] })

    const outcome = inspectTrajectoryRun({ trajectoryFile, sinceByteOffset: offset })
    expect(outcome?.kind).toBe('success')

    // And with no new events after the offset → no evidence, not a stale verdict.
    const endOffset = statSync(trajectoryFile).size
    expect(inspectTrajectoryRun({ trajectoryFile, sinceByteOffset: endOffset })).toBeNull()
  })

  it('tolerates malformed lines and unknown event types', () => {
    appendFileSync(trajectoryFile, 'not json at all\n{"type":"mystery.event"}\n{"truncated json...\n')
    writeRun(trajectoryFile, { status: 'interrupted', assistantTexts: ['after garbage'] })
    appendFileSync(trajectoryFile, '{half a line')

    const outcome = inspectTrajectoryRun({ trajectoryFile })
    expect(outcome?.kind).toBe('death')
  })

  it('returns null for a missing file, foreign schema, or run still in flight', () => {
    expect(inspectTrajectoryRun({ trajectoryFile: join(testDir, 'nope.trajectory.jsonl') })).toBeNull()

    writeFileSync(trajectoryFile, JSON.stringify({ traceSchema: 'other-schema', schemaVersion: 9, type: 'session.ended', data: { status: 'interrupted' } }) + '\n')
    expect(inspectTrajectoryRun({ trajectoryFile })).toBeNull()

    // In-flight: started + completed but no session.ended yet.
    writeFileSync(trajectoryFile, [
      event('session.started', {}, 1),
      event('model.completed', { assistantTexts: ['streaming...'] }, 2),
    ].join('\n') + '\n')
    expect(inspectTrajectoryRun({ trajectoryFile })).toBeNull()
  })

  it('a fresh session.started after the offset resets prior-run evidence', () => {
    const dir = join(testDir, 'openclaw', 'agents', 'jessica', 'sessions')
    const file = join(dir, `${randomUUID()}.trajectory.jsonl`)
    writeFileSync(file, '')
    // Two runs after offset 0: first interrupted, second succeeded — the
    // verdict must reflect the most recent run.
    writeRun(file, { status: 'interrupted', assistantTexts: ['died'] })
    writeRun(file, { status: 'success', assistantTexts: ['recovered'] })
    const outcome = inspectTrajectoryRun({ trajectoryFile: file })
    expect(outcome?.kind).toBe('success')
  })
})

describe('watchTrajectoryForDeath', () => {
  it('rejects with the diagnosis only once session.ended (non-success) lands on disk', async () => {
    const watch = watchTrajectoryForDeath({
      trajectoryFile,
      sinceByteOffset: 0,
      oversizedOutputBytes: 131072,
      pollMs: 20,
    })
    let settled: unknown = null
    watch.promise.catch((err) => { settled = err })

    // Mid-run events only — no verdict yet.
    appendFileSync(trajectoryFile, event('session.started', {}, 1) + '\n' + event('tool.call', { name: 'x' }, 2) + '\n')
    await settleFor(80, 'mid-run events must NOT produce a verdict — several poll cycles of silence is the assertion')
    expect(settled).toBeNull()

    // Death lands → reject within a couple polls.
    appendFileSync(trajectoryFile, [
      event('model.completed', { assistantTexts: ['boom'] }, 3),
      event('session.ended', { status: 'interrupted', timedOut: false }, 4),
    ].join('\n') + '\n')
    await waitUntil(() => settled !== null, { label: 'the death verdict to reject the watch promise' })
    expect(settled).toBeInstanceOf(RuntimeTurnError)
    expect((settled as RuntimeTurnError).diagnosis.reason).toBe('session_interrupted')
    watch.stop()
  })

  it('success on disk: waits the grace window (frame should win), then rejects with the recovered content', async () => {
    const watch = watchTrajectoryForDeath({ trajectoryFile, sinceByteOffset: 0, pollMs: 20, successGraceMs: 150 })
    let settled: unknown = null
    watch.promise.catch((err) => { settled = err })

    writeRun(trajectoryFile, { status: 'success', assistantTexts: ['fine'] })
    // Within the grace window: silent — the gateway frame is authoritative.
    await settleFor(80, 'inside the grace window the gateway frame is authoritative — silence is the assertion')
    expect(settled).toBeNull()

    // Grace elapsed without the frame → recovered-turn sentinel.
    await waitUntil(() => settled !== null, { label: 'the grace window to elapse into a recovered-turn sentinel' })
    expect(settled).toBeInstanceOf(TrajectoryRecoveredTurn)
    expect((settled as TrajectoryRecoveredTurn).content).toBe('fine')
    watch.stop()
  })

  it('parses each trajectory line exactly once across polls (incremental scan)', async () => {
    const parseSpy = spyOn(JSON, 'parse')
    const watch = watchTrajectoryForDeath({ trajectoryFile, sinceByteOffset: 0, pollMs: 15 })
    let settled: unknown = null
    watch.promise.catch((err) => { settled = err })

    // Three append bursts with polls between them — a tool-heavy turn.
    appendFileSync(trajectoryFile, event('session.started', {}, 1) + '\n')
    await settleFor(60, 'space the append bursts so the watcher polls between them — the point is a multi-poll turn')
    appendFileSync(trajectoryFile, event('tool.call', { name: 'a' }, 2) + '\n' + event('tool.call', { name: 'b' }, 3) + '\n')
    await settleFor(60, 'space the append bursts so the watcher polls between them — the point is a multi-poll turn')
    appendFileSync(trajectoryFile, [
      event('model.completed', { assistantTexts: ['done'] }, 4),
      event('session.ended', { status: 'interrupted', timedOut: false }, 5),
    ].join('\n') + '\n')
    await waitUntil(() => settled !== null, { label: 'the interrupted session to settle the watch promise' })

    expect(settled).toBeInstanceOf(RuntimeTurnError)
    // 5 trajectory lines written; each JSON.parsed exactly once — the old
    // implementation re-parsed the whole tail on every size change
    // (1 + 3 + 5 = 9 parses for this sequence).
    const trajectoryParses = parseSpy.mock.calls.filter((c) => String(c[0]).includes('traceSchema'))
    expect(trajectoryParses).toHaveLength(5)
    parseSpy.mockRestore()
    watch.stop()
  })

  it('detects death when appends split lines (and multi-byte chars) across polls', async () => {
    const watch = watchTrajectoryForDeath({ trajectoryFile, sinceByteOffset: 0, pollMs: 15 })
    let settled: unknown = null
    watch.promise.catch((err) => { settled = err })

    // A multi-byte emoji inside the completed text, with the raw bytes of
    // the line split mid-character across two appends.
    const completedLine = event('model.completed', { assistantTexts: ['boom 📦 done'] }, 2)
    const completedBytes = Buffer.from(completedLine + '\n', 'utf-8')
    const emojiIdx = completedBytes.indexOf(Buffer.from('📦', 'utf-8'))
    const splitAt = emojiIdx + 2 // mid-emoji (📦 is 4 bytes)

    appendFileSync(trajectoryFile, event('session.started', {}, 1) + '\n')
    appendFileSync(trajectoryFile, completedBytes.subarray(0, splitAt))
    await settleFor(60, 'half a written line must NOT yield a verdict — silence across polls is the assertion')
    expect(settled).toBeNull() // half a line — no verdict, no corruption

    appendFileSync(trajectoryFile, completedBytes.subarray(splitAt))
    appendFileSync(trajectoryFile, event('session.ended', { status: 'interrupted', timedOut: false }, 3) + '\n')
    await waitUntil(() => settled !== null, { label: 'the rejoined split line to produce a verdict' })

    expect(settled).toBeInstanceOf(RuntimeTurnError)
    // The split line decoded correctly — the salvaged text keeps the emoji.
    expect((settled as RuntimeTurnError).diagnosis.salvagedText).toContain('boom 📦 done')
    watch.stop()
  })

  it('stop() during the grace window suppresses the recovered-turn rejection (frame won the race)', async () => {
    const watch = watchTrajectoryForDeath({ trajectoryFile, sinceByteOffset: 0, pollMs: 20, successGraceMs: 100 })
    let settled = false
    watch.promise.catch(() => { settled = true })

    writeRun(trajectoryFile, { status: 'success', assistantTexts: ['fine'] })
    // Both windows are load-bearing and tied to successGraceMs: 100 above —
    // stop() must land INSIDE the grace window, and the assertion must then
    // outlast it. Polling cannot express "and nothing fired afterwards".
    await settleFor(50, 'land inside the 100ms grace window before stop()')
    watch.stop() // the gateway frame arrived; the race is over
    await settleFor(150, 'outlast the grace window to prove stop() suppressed the rejection')
    expect(settled).toBe(false)
  })
})

describe('trajectoryFilePathFor / safeFileSize', () => {
  it('derives the deterministic trajectory path under OPENCLAW_HOME', () => {
    const path = trajectoryFilePathFor('jessica', 'abc-123')
    expect(path).toBe(join(testDir, 'openclaw', 'agents', 'jessica', 'sessions', 'abc-123.trajectory.jsonl'))
  })

  it('returns 0 for a missing trajectory file', () => {
    expect(safeFileSize(join(testDir, 'missing.jsonl'))).toBe(0)
  })
})
