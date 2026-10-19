/**
 * Pinned model distributions for the pinned engine (see pin.ts, 0.2.2 —
 * re-verified 2026-09-18: the same distributions load and embed on the
 * 0.2.2 Metal runtime, hashes unchanged; tasks/evidence-antfly-0.2.2.md).
 *
 * `antfly inference pull` fetches whatever distribution HuggingFace serves,
 * and the old completeness check accepted ANY nonzero weight file — which
 * let a wrong-distribution download (ONNX where the engine's in-process
 * Metal runtime needs GGUF) pass `bakin check search-models` while the
 * engine crash-looped on MissingWeight at boot, 161 respawns deep before a
 * human read the diagnostics (2026-07-21 field incident).
 *
 * Pins are the exact file set verified working against the pinned engine
 * version; sha256 values were computed from that verified install (the
 * tokenizer pins, added 2026-10-19 for #898 E, also match HuggingFace's
 * published files byte for byte). Verification tiers (#898 E):
 *   - a MISSING or truncated pinned file → structurally broken (blocks
 *     preload; the doctor reports it — the crash-loop class). The doctor is
 *     STRUCTURAL ONLY: hashing hundreds of MB per check cycle is real cost.
 *   - a pinned file whose sha256 differs → the INSTALL path refuses it: the
 *     install skip hashes every pinned file before calling a model present,
 *     and a post-pull mismatch fails the install. There is no cache: a
 *     (size, mtime) match is never proof.
 * Models without a pin entry (operator-configured embedders) fall back to
 * the generic any-weight-file check.
 *
 * When repinning the ENGINE version, re-verify these distributions against
 * it and refresh the hashes in the same commit.
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { verifyFileSha256 } from '@bakin/core/integrity/files'
import { join } from 'path'
import { inferenceModelsRoot } from './paths'

export interface ModelFilePin {
  file: string
  sha256?: string
  minBytes?: number
}

/** Whether a model's integrity is pinned (hash-verified) or only structurally checked (operator-configured). */
export function isPinnedModel(model: string): boolean {
  return MODEL_PINS[model] !== undefined
}

export const MODEL_PINS: Record<string, ModelFilePin[]> = {
  'BAAI/bge-small-en-v1.5': [
    { file: 'model.safetensors', sha256: '3c9f31665447c8911517620762200d2245a2518d6e7208acc78cd9db317e21ad', minBytes: 100_000_000 },
    { file: 'tokenizer.json', sha256: 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66' },
  ],
  'antflydb/clipclap': [
    // The paired GGUFs are what the engine's Metal runtime loads; an
    // ONNX-only download passes a naive weight-file check and crash-loops.
    { file: 'clipclap-clip.Q4_K.gguf', sha256: 'cd41fa6f466205c3dc987ba4cb0d673f0059447c6c5daef5dcd5ae210cbec361', minBytes: 50_000_000 },
    { file: 'clipclap-clap.Q4_K.gguf', sha256: '8be2a0c523b20452a8a16f5915d0096b12ad7de18aa07d6adb71a3669b1a27ec', minBytes: 20_000_000 },
    { file: 'tokenizer.json', sha256: '8e019f9349caf5f9bb92514b0e4fc00c92841aef6ae8df9d833d975c623b7c72' },
  ],
  'mixedbread-ai/mxbai-rerank-base-v1': [
    { file: 'model.safetensors', sha256: 'd9db29f75d900055e9ce4f9a79c841d13384fdc3ca144404f9eecb873fc4fcbd', minBytes: 200_000_000 },
    { file: 'tokenizer.json', sha256: '305674b4d785287feecfb5f73f24aa75e9b57c87c579cfe24fbd207987d4b4c4' },
  ],
}

export function modelDir(model: string, root: string = inferenceModelsRoot()): string {
  // v0.2 layout is {root}/{owner}/{name} — no per-kind buckets.
  return join(root, model)
}

const WEIGHT_FILE_RE = /\.(onnx|gguf|safetensors)$/

function hasWeightFile(dir: string, depth = 0): boolean {
  if (depth > 2) return false
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return false
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      const stat = statSync(full)
      if (stat.isFile() && WEIGHT_FILE_RE.test(entry) && stat.size > 0) return true
      if (stat.isDirectory() && hasWeightFile(full, depth + 1)) return true
    } catch {
      continue
    }
  }
  return false
}

/**
 * Structural completeness: every pinned file present and plausibly sized
 * (generic weight-file fallback for unpinned models). Cheap — safe to call
 * on every doctor cycle and from the service argv builder.
 */
export function modelStructurallyComplete(model: string, modelsRoot?: string): { ok: true } | { ok: false; reason: string } {
  const root = modelDir(model, modelsRoot)
  if (!existsSync(root)) return { ok: false, reason: 'not downloaded yet' }

  // The registry synthesizes model_manifest.json after a successful pull;
  // its absence means the pull never completed.
  if (!existsSync(join(root, 'model_manifest.json'))) {
    return { ok: false, reason: 'model_manifest.json missing - pull likely incomplete' }
  }

  const pins = MODEL_PINS[model]
  if (!pins) {
    if (!hasWeightFile(root)) {
      return { ok: false, reason: 'no model weight file (.onnx/.gguf/.safetensors) found' }
    }
    return { ok: true }
  }

  for (const pin of pins) {
    const path = join(root, pin.file)
    let size: number
    try {
      const stat = statSync(path)
      if (!stat.isFile()) return { ok: false, reason: `required file ${pin.file} is not a regular file` }
      size = stat.size
    } catch {
      return { ok: false, reason: `required file ${pin.file} missing - wrong distribution downloaded?` }
    }
    if (size === 0 || (pin.minBytes !== undefined && size < pin.minBytes)) {
      return { ok: false, reason: `required file ${pin.file} is truncated (${size} bytes)` }
    }
  }
  return { ok: true }
}

/**
 * Every pinned file whose bytes do not match its sha256 pin — ALWAYS
 * stream-hashed (`verifyFileSha256`; no (size, mtime) cache is proof).
 * Install-path only: the skip check and the post-pull verification call
 * it; the doctor never does. Empty for unpinned or fully matching models;
 * a missing pinned file counts as a mismatch.
 */
export async function pinMismatches(model: string, modelsRoot?: string): Promise<string[]> {
  const pins = MODEL_PINS[model]
  if (!pins) return []
  const root = modelDir(model, modelsRoot)
  const mismatched: string[] = []
  for (const pin of pins) {
    if (!pin.sha256) continue
    const verdict = await verifyFileSha256(join(root, pin.file), pin.sha256)
    if (!verdict.ok) mismatched.push(pin.file)
  }
  return mismatched
}
