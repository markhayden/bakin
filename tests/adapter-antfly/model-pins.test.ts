/**
 * Pinned model-distribution verification (model-pins.ts).
 *
 * The field bug this pins: `antfly inference pull` served a wrong
 * distribution (ONNX where the engine's Metal runtime needs the paired
 * GGUFs) and the old any-weight-file presence check PASSED it —
 * `bakin check search-models` said "all present" while the engine
 * crash-looped 161 times on MissingWeight (2026-07-21).
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-model-pins-${Date.now()}-${randomUUID()}`)
process.env.ANTFLY_HOME = testDir

import { MODEL_PINS, modelDir, modelStructurallyComplete, unverifiedModelFiles } from '../../packages/adapter-antfly/src/model-pins'

const CLIPCLAP = 'antflydb/clipclap'

function seedModel(model: string, files: Record<string, string | Buffer>): void {
  const root = modelDir(model)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content)
  }
}

// Pins carry minBytes in the tens of MB; give test weights honest bulk via
// a sparse-ish buffer (allocated, but tiny wall-clock).
const bigWeight = () => Buffer.alloc(120_000_000, 7)

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(testDir, 'inference'), { recursive: true, force: true })
})

describe('modelStructurallyComplete', () => {
  it('FAILS a wrong-distribution download: ONNX weights present, pinned GGUFs missing', () => {
    seedModel(CLIPCLAP, {
      'model_manifest.json': '{}',
      'model.onnx': bigWeight(), // nonzero weight — passed the OLD check
      'tokenizer.json': '{}',
    })
    const verdict = modelStructurallyComplete(CLIPCLAP)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('clipclap-clip.Q4_K.gguf')
  })

  it('passes when every pinned file is present and plausibly sized', () => {
    seedModel(CLIPCLAP, {
      'model_manifest.json': '{}',
      'clipclap-clip.Q4_K.gguf': bigWeight(),
      'clipclap-clap.Q4_K.gguf': bigWeight(),
      'tokenizer.json': '{}',
    })
    expect(modelStructurallyComplete(CLIPCLAP).ok).toBe(true)
  })

  it('fails a truncated pinned weight', () => {
    seedModel(CLIPCLAP, {
      'model_manifest.json': '{}',
      'clipclap-clip.Q4_K.gguf': 'tiny',
      'clipclap-clap.Q4_K.gguf': bigWeight(),
      'tokenizer.json': '{}',
    })
    const verdict = modelStructurallyComplete(CLIPCLAP)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('truncated')
  })

  it('unpinned models fall back to the generic weight-file check', () => {
    seedModel('someone/custom-embedder', {
      'model_manifest.json': '{}',
      'model.safetensors': 'weights',
    })
    expect(modelStructurallyComplete('someone/custom-embedder').ok).toBe(true)
    seedModel('someone/no-weights', { 'model_manifest.json': '{}' })
    expect(modelStructurallyComplete('someone/no-weights').ok).toBe(false)
  })

  it('missing manifest means the pull never completed', () => {
    seedModel(CLIPCLAP, { 'clipclap-clip.Q4_K.gguf': bigWeight() })
    const verdict = modelStructurallyComplete(CLIPCLAP)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('model_manifest.json')
  })
})

describe('unverifiedModelFiles', () => {
  it('reports hash drift without blocking (structural check still passes)', async () => {
    seedModel(CLIPCLAP, {
      'model_manifest.json': '{}',
      'clipclap-clip.Q4_K.gguf': bigWeight(),
      'clipclap-clap.Q4_K.gguf': bigWeight(),
      'tokenizer.json': '{}',
    })
    expect(modelStructurallyComplete(CLIPCLAP).ok).toBe(true)
    const drifted = await unverifiedModelFiles(CLIPCLAP)
    expect(drifted.sort()).toEqual(['clipclap-clap.Q4_K.gguf', 'clipclap-clip.Q4_K.gguf'])
  })

  it('returns empty for unpinned models', async () => {
    expect(await unverifiedModelFiles('someone/custom-embedder')).toEqual([])
  })
})

describe('pin integrity', () => {
  it('every pinned sha256 is well-formed and every pin names its weight files', () => {
    for (const [model, pins] of Object.entries(MODEL_PINS)) {
      expect(pins.length).toBeGreaterThan(0)
      for (const pin of pins) {
        expect(pin.file.length).toBeGreaterThan(0)
        if (pin.sha256) expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
      }
      expect(model).toMatch(/^[\w.-]+\/[\w.-]+$/)
    }
  })
})
