/**
 * Pinned model distributions for the pinned engine (see pin.ts, rc.18).
 *
 * `antfly inference pull` fetches whatever distribution HuggingFace serves,
 * and the old completeness check accepted ANY nonzero weight file — which
 * let a wrong-distribution download (ONNX where the engine's in-process
 * Metal runtime needs GGUF) pass `bakin check search-models` while the
 * engine crash-looped on MissingWeight at boot, 161 respawns deep before a
 * human read the diagnostics (2026-07-21 field incident).
 *
 * Pins are the exact file set verified working against the pinned engine
 * version; sha256 values were computed from that verified install.
 * Verification tiers:
 *   - a MISSING or truncated pinned file  → structurally broken (blocks
 *     preload, reported as missing/broken — the crash-loop class)
 *   - a present file whose hash drifted   → "unverified" (reported, never
 *     blocking — upstream may legitimately rev a distribution; we re-pin
 *     when we re-verify)
 * Models without a pin entry (operator-configured embedders) fall back to
 * the generic any-weight-file check.
 *
 * When repinning the ENGINE version, re-verify these distributions against
 * it and refresh the hashes in the same commit.
 */
import { createHash } from 'crypto'
import { createReadStream, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { inferenceModelsRoot } from './paths'

export interface ModelFilePin {
  file: string
  sha256?: string
  minBytes?: number
}

export const MODEL_PINS: Record<string, ModelFilePin[]> = {
  'BAAI/bge-small-en-v1.5': [
    { file: 'model.safetensors', sha256: '3c9f31665447c8911517620762200d2245a2518d6e7208acc78cd9db317e21ad', minBytes: 100_000_000 },
    { file: 'tokenizer.json' },
  ],
  'antflydb/clipclap': [
    // The paired GGUFs are what the engine's Metal runtime loads; an
    // ONNX-only download passes a naive weight-file check and crash-loops.
    { file: 'clipclap-clip.Q4_K.gguf', sha256: 'cd41fa6f466205c3dc987ba4cb0d673f0059447c6c5daef5dcd5ae210cbec361', minBytes: 50_000_000 },
    { file: 'clipclap-clap.Q4_K.gguf', sha256: '8be2a0c523b20452a8a16f5915d0096b12ad7de18aa07d6adb71a3669b1a27ec', minBytes: 20_000_000 },
    { file: 'tokenizer.json' },
  ],
  'mixedbread-ai/mxbai-rerank-base-v1': [
    { file: 'model.safetensors', sha256: 'd9db29f75d900055e9ce4f9a79c841d13384fdc3ca144404f9eecb873fc4fcbd', minBytes: 200_000_000 },
    { file: 'tokenizer.json' },
  ],
}

export function modelDir(model: string): string {
  // v0.2 layout is {root}/{owner}/{name} — no per-kind buckets.
  return join(inferenceModelsRoot(), model)
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
export function modelStructurallyComplete(model: string): { ok: true } | { ok: false; reason: string } {
  const root = modelDir(model)
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

// Hashing hundreds of MB is ~seconds — cache by (path, size, mtime) so the
// doctor's repeat calls cost one pass per file per boot.
const hashCache = new Map<string, { size: number; mtimeMs: number; sha256: string }>()

async function fileSha256(path: string): Promise<string> {
  const stat = statSync(path)
  const cached = hashCache.get(path)
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.sha256
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  const sha256 = hash.digest('hex')
  hashCache.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 })
  return sha256
}

/**
 * Hash verification against the pins. Never blocking: a drifted hash means
 * "distribution differs from the verified set", which is worth surfacing
 * but is not the crash-loop failure class. Returns the drifted file names
 * (empty for unpinned or fully matching models).
 */
export async function unverifiedModelFiles(model: string): Promise<string[]> {
  const pins = MODEL_PINS[model]
  if (!pins) return []
  const root = modelDir(model)
  const drifted: string[] = []
  for (const pin of pins) {
    if (!pin.sha256) continue
    const path = join(root, pin.file)
    if (!existsSync(path)) continue // structural check owns missing files
    try {
      if (await fileSha256(path) !== pin.sha256) drifted.push(pin.file)
    } catch {
      drifted.push(pin.file)
    }
  }
  return drifted
}
