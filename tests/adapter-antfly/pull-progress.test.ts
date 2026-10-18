/**
 * The `antfly inference pull` stderr protocol (#895 D12). Fixture lines are
 * verbatim from the T0 spike runs against antfly 0.2.2
 * (tasks/evidence-antfly-pull.md). Pure: no app modules, no filesystem
 * beyond a temp staging dir.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createPullTracker, parsePullLine, pullStagingDir } from '../../packages/adapter-antfly/src/pull-progress'

const MiB = 1024 ** 2
const testDir = join(tmpdir(), `bakin-test-pull-progress-${Date.now()}`)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('parsePullLine', () => {
  it('reads a file start, a 16 MiB progress line, done and cached', () => {
    expect(parsePullLine('  [9/10] onnx/model.onnx (126.9 MiB)...')).toEqual({ kind: 'start', path: 'onnx/model.onnx', size: Math.round(126.9 * MiB) })
    expect(parsePullLine('  [9/10] onnx/model.onnx 16.0 MiB/126.9 MiB (13%) 2.9 MiB/s 5.5s eta 38.4s'))
      .toEqual({ kind: 'progress', path: 'onnx/model.onnx', received: 16 * MiB, size: Math.round(126.9 * MiB) })
    expect(parsePullLine('  [1/10] config.json done (743 B, 1.0 KiB/s, 0.7s)')).toEqual({ kind: 'finished', path: 'config.json', size: 743 })
    expect(parsePullLine('  [2/10] tokenizer.json cached (694.7 KiB, verified in 0.0s)')).toEqual({ kind: 'finished', path: 'tokenizer.json', size: Math.round(694.7 * 1024) })
  })

  it('treats everything else as plain output', () => {
    expect(parsePullLine('pulling BAAI/bge-small-en-v1.5...')).toEqual({ kind: 'other' })
    expect(parsePullLine('done.')).toEqual({ kind: 'other' })
    expect(parsePullLine('')).toEqual({ kind: 'other' })
  })
})

describe('pullStagingDir', () => {
  it('is the dot-prefixed sibling of the final model dir', () => {
    expect(pullStagingDir('/m', 'BAAI/bge-small-en-v1.5')).toBe('/m/BAAI/.bge-small-en-v1.5.antfly-download-staging')
  })
})

describe('createPullTracker', () => {
  it('grows the total as files are announced and counts finished files plus the current .part', () => {
    const staging = pullStagingDir(testDir, 'BAAI/bge-small-en-v1.5')
    mkdirSync(join(staging, 'onnx'), { recursive: true })
    const tracker = createPullTracker(staging)
    tracker.line('  [1/10] config.json (743 B)...')
    expect(tracker.snapshot()).toEqual({ received: 0, total: 743 })
    tracker.line('  [1/10] config.json done (743 B, 1.0 KiB/s, 0.7s)')
    tracker.line('  [9/10] onnx/model.onnx (126.9 MiB)...')
    expect(tracker.snapshot()).toEqual({ received: 743, total: 743 + Math.round(126.9 * MiB) })

    // Between the 16 MiB lines the bytes come from the staged .part.
    writeFileSync(join(staging, 'onnx', 'model.onnx.part'), new Uint8Array(5 * MiB))
    expect(tracker.snapshot().received).toBe(743 + 5 * MiB)
    tracker.line('  [9/10] onnx/model.onnx 16.0 MiB/126.9 MiB (13%) 2.9 MiB/s 5.5s eta 38.4s')
    expect(tracker.snapshot().received).toBe(743 + 16 * MiB)

    // The finished file counts at its announced size.
    tracker.line('  [9/10] onnx/model.onnx done (126.9 MiB, 3.3 MiB/s, 38.0s)')
    expect(tracker.snapshot()).toEqual({ received: 743 + Math.round(126.9 * MiB), total: 743 + Math.round(126.9 * MiB) })
  })
})
