/**
 * Tests for the search-model prefetch component (antfly v0.2 inference runtime).
 *
 * Strategy — same real-fs approach as the installer tests:
 *   - ANTFLY_HOME points at a temp dir; models land under
 *     $ANTFLY_HOME/inference/models/{owner}/{name}
 *   - The fake antfly binary is a shell script whose `inference pull`
 *     actually creates the model directory (manifest + onnx weight), so the
 *     real spawn → verify pipeline runs end to end with zero module mocks
 *   - Failure modes are scripted binary variants (exit non-zero, or exit 0
 *     without creating files)
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-antfly-models-${Date.now()}`)
const antflyHomeDir = join(testDir, 'antfly-home')
const modelsRoot = join(antflyHomeDir, 'inference', 'models')
const fakeBinary = join(testDir, 'fake-antfly')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  checkInferenceModels,
  installInferenceModels,
  REQUIRED_MODELS,
} from '../../../packages/adapter-antfly/src/models'

/** A pull that actually creates the model dir, like the real CLI. */
const PULL_OK = `#!/bin/sh
if [ "$1" = "inference" ] && [ "$2" = "pull" ]; then
  dir="$ANTFLY_HOME/inference/models/$3"
  mkdir -p "$dir/onnx"
  echo '{"type":"embedder","tasks":["embed"]}' > "$dir/model_manifest.json"
  echo "fake-weights" > "$dir/onnx/model.onnx"
  exit 0
fi
exit 1
`

/** A pull that exits non-zero. */
const PULL_FAILS = `#!/bin/sh
echo "pull failed: HuggingFace unreachable" >&2
exit 2
`

/** A pull that claims success but creates nothing. */
const PULL_LIES = `#!/bin/sh
exit 0
`

function installFakeBinary(script: string): void {
  writeFileSync(fakeBinary, script, { mode: 0o755 })
  process.env.ANTFLY_PATH = fakeBinary
}

function seedModel(model: string): void {
  const dir = join(modelsRoot, model)
  mkdirSync(join(dir, 'onnx'), { recursive: true })
  writeFileSync(join(dir, 'model_manifest.json'), '{"type":"embedder"}')
  writeFileSync(join(dir, 'onnx', 'model.onnx'), 'weights')
}

const optsAutoYes = {
  interactive: false,
  autoApprove: true,
  json: false,
  checkOnly: false,
  force: false,
  askYesNo: () => Promise.resolve(true),
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(antflyHomeDir, { recursive: true })
  process.env.ANTFLY_HOME = antflyHomeDir
  delete process.env.ANTFLY_PATH
})

afterEach(() => {
  delete process.env.ANTFLY_HOME
  delete process.env.ANTFLY_PATH
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('checkInferenceModels', () => {
  it('treats missing models as degraded-not-broken, with the rebuild remediation', async () => {
    // v0.2.0-rc.2 does NOT lazy-download at index time (bakin#456): missing
    // models degrade semantic indexing until prefetch + rebuild.
    const result = await checkInferenceModels()
    expect(result.status).toBe('missing')
    expect(result.message).toContain('semantic indexing is degraded')
    expect(result.message).toContain('search itself keeps working')
    expect(result.remediation).toContain('bakin install search-models')
    expect(result.remediation).toContain('reindex --rebuild')
  })

  it('reports ok when all models are present in the v0.2 owner/name layout', async () => {
    for (const m of REQUIRED_MODELS) seedModel(m.model)
    const result = await checkInferenceModels()
    expect(result.status).toBe('ok')
    expect(result.message).toContain(`All ${REQUIRED_MODELS.length} search models present`)
    expect(String(result.details?.root)).toBe(modelsRoot)
  })

  it('flags a model whose pull never completed (manifest missing)', async () => {
    for (const m of REQUIRED_MODELS) seedModel(m.model)
    rmSync(join(modelsRoot, REQUIRED_MODELS[0].model, 'model_manifest.json'))

    const result = await checkInferenceModels()
    expect(result.status).toBe('missing')
    const missing = (result.details as { missing: Array<{ model: string; reason: string }> }).missing
    expect(missing).toHaveLength(1)
    expect(missing[0].model).toBe(REQUIRED_MODELS[0].model)
    expect(missing[0].reason).toContain('model_manifest.json missing')
  })
})

describe('installInferenceModels', () => {
  it('fails when the antfly binary is missing', async () => {
    const result = await installInferenceModels(optsAutoYes)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('antfly binary not found')
  })

  it('pulls missing models via `antfly inference pull` and verifies the layout', async () => {
    installFakeBinary(PULL_OK)

    const result = await installInferenceModels(optsAutoYes)
    expect(result.status).toBe('installed')
    expect(result.message).toContain(`Pulled ${REQUIRED_MODELS.length} models`)
    for (const m of REQUIRED_MODELS) {
      expect(existsSync(join(modelsRoot, m.model, 'model_manifest.json'))).toBe(true)
    }
    expect((await checkInferenceModels()).status).toBe('ok')
  })

  it('only pulls what is missing', async () => {
    installFakeBinary(PULL_OK)
    seedModel(REQUIRED_MODELS[0].model)
    seedModel(REQUIRED_MODELS[1].model)

    const result = await installInferenceModels(optsAutoYes)
    expect(result.status).toBe('installed')
    expect(result.message).toContain('Pulled 1 model')
    expect(result.message).toContain(REQUIRED_MODELS[2].label)
  })

  it('is a noop when everything is present', async () => {
    installFakeBinary(PULL_OK)
    for (const m of REQUIRED_MODELS) seedModel(m.model)
    const result = await installInferenceModels(optsAutoYes)
    expect(result.status).toBe('noop')
  })

  it('fails with the pull stderr when the CLI exits non-zero', async () => {
    installFakeBinary(PULL_FAILS)
    const result = await installInferenceModels(optsAutoYes)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('exited with code 2')
    expect(result.message).toContain('HuggingFace unreachable')
  })

  it('fails when the pull claims success but the model never appears', async () => {
    installFakeBinary(PULL_LIES)
    const result = await installInferenceModels(optsAutoYes)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('reported success but')
  })

  it('skips on decline, noting the degraded-semantic consequence', async () => {
    installFakeBinary(PULL_OK)
    const opts = {
      ...optsAutoYes,
      interactive: true,
      autoApprove: false,
      askYesNo: () => Promise.resolve(false),
    }
    const result = await installInferenceModels(opts)
    expect(result.status).toBe('skipped')
    expect(result.message).toContain('semantic indexing is degraded')
    expect(result.message).toContain('reindex --rebuild')
  })

  it('skips non-interactive without --yes, noting the degraded-semantic consequence', async () => {
    installFakeBinary(PULL_OK)
    const opts = { ...optsAutoYes, autoApprove: false }
    const result = await installInferenceModels(opts)
    expect(result.status).toBe('skipped')
    expect(result.message).toContain('Semantic indexing is degraded')
  })
})
