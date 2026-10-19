/**
 * Tests for the search-model prefetch component (antfly v0.2 inference runtime).
 *
 * Strategy — same real-fs approach as the installer tests:
 *   - ANTFLY_HOME points at a temp dir; models land under
 *     $ANTFLY_HOME/inference/models/{owner}/{name}
 *   - The fake antfly binary is a shell script that behaves like the real
 *     `inference pull` (T0, tasks/evidence-antfly-pull.md): it takes
 *     `--models-dir`, stages into `<owner>/.<name>.antfly-download-staging`
 *     with a `.part` for the in-flight file, speaks the stderr protocol, and
 *     publishes with one rename — so the real spawn → progress → verify
 *     pipeline runs end to end with zero module mocks
 *   - Every install runs inside a real operation holding search-engine
 *   - Failure modes are scripted binary variants (exit non-zero, or exit 0
 *     without creating files)
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
/** Forces the "no atomic exchange on this platform" branch when true. */
let exchangeUnavailable = false
const { exchangePaths: realExchange } = await import('../../../packages/core/src/fs/exchange')
mock.module('../../../packages/core/src/fs/exchange', () => ({
  exchangePaths: (a: string, b: string) => (exchangeUnavailable ? false : realExchange(a, b)),
}))
/** Forces "flock unavailable" when true. */
let flockUnavailable = false
const { tryLockFile: realTryLock } = await import('../../../packages/core/src/fs/flock')
mock.module('../../../packages/core/src/fs/flock', () => ({
  tryLockFile: (path: string) => (flockUnavailable ? { kind: 'unsupported' } : realTryLock(path)),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  ANTFLY_MODELS_PLAN,
  checkInferenceModels,
  installInferenceModels as installModels,
  type InferenceModel,
} from '../../../packages/adapter-antfly/src/models'
import { createMemoryResourceAcquirer, createOperationRegistry, operationQuietState, type OperationView } from '@bakin/core/operations'
import { withOperationView } from '../../helpers/operation-harness'
import { MODEL_PINS } from '../../../packages/adapter-antfly/src/model-pins'
import { pullStagingRoot } from '../../../packages/adapter-antfly/src/pull-progress'
import { waitUntil } from '../../helpers/wait'

// UNPINNED model names: this file exercises the pull → verify PIPELINE
// mechanics (spawn, layout, failure modes) via the generic weight-file
// check. The real models carry pinned distribution file sets that the
// generic onnx layout seeded here would — correctly — fail; pinned
// verification is covered in tests/adapter-antfly/model-pins.test.ts.
const TEST_MODELS: InferenceModel[] = [
  { label: 'text embedder', model: 'testorg/text-embedder', kind: 'embedder' },
  { label: 'visual embedder', model: 'testorg/visual-embedder', kind: 'embedder' },
  { label: 'reranker', model: 'testorg/reranker', kind: 'reranker' },
]

/**
 * The real CLI's shape: `inference pull <model> --models-dir <root>`, files
 * staged in a dot-dir (the in-flight one as `.part`), the stderr protocol,
 * then one rename into `<root>/<model>`. Refuses to run without the flag.
 */
const PULL_OK = `#!/bin/sh
[ "$1" = "inference" ] && [ "$2" = "pull" ] && [ "$4" = "--models-dir" ] || exit 9
echo "$*" >> "$(dirname "$0")/argv.log"
owner=$(dirname "$3"); name=$(basename "$3")
stage="$5/$owner/.$name.antfly-download-staging"
mkdir -p "$stage/onnx"
echo "pulling $3..." >&2
echo "  [1/2] model_manifest.json (38 B)..." >&2
echo '{"type":"embedder","tasks":["embed"]}' > "$stage/model_manifest.json"
echo "  [1/2] model_manifest.json done (38 B, 1.0 KiB/s, 0.1s)" >&2
echo "  [2/2] onnx/model.onnx (2.0 KiB)..." >&2
head -c 2048 /dev/zero > "$stage/onnx/model.onnx"
echo "  [2/2] onnx/model.onnx done (2.0 KiB, 1.0 KiB/s, 0.1s)" >&2
echo "done." >&2
mv "$stage" "$5/$3"
`

/** Stages half the weight as a `.part`, then stops talking (a stalled pull). */
const PULL_STALLS = `#!/bin/sh
owner=$(dirname "$3"); name=$(basename "$3")
stage="$5/$owner/.$name.antfly-download-staging"
mkdir -p "$stage/onnx"
echo "pulling $3..." >&2
echo "  [1/1] onnx/model.onnx (2.0 KiB)..." >&2
head -c 1024 /dev/zero > "$stage/onnx/model.onnx.part"
exec sleep 30
`

/** Stalls and ignores SIGTERM — cancel must still settle. */
const PULL_IGNORES_TERM = `#!/bin/sh
trap '' TERM
echo "pulling $3..." >&2
echo "  [1/1] onnx/model.onnx (2.0 KiB)..." >&2
while :; do sleep 1; done
`

/** Resumes only from a kept staging dir (T0 F6), then publishes. */
const PULL_RESUMES = `#!/bin/sh
owner=$(dirname "$3"); name=$(basename "$3")
stage="$5/$owner/.$name.antfly-download-staging"
[ -f "$stage/onnx/model.onnx.part" ] || { echo "no staging to resume" >&2; exit 7; }
echo "  [1/1] onnx/model.onnx (2.0 KiB)..." >&2
echo "  [1/1] onnx/model.onnx 1.0 KiB/2.0 KiB (50%) 1.0 KiB/s 1.0s eta 1.0s" >&2
head -c 2048 /dev/zero > "$stage/onnx/model.onnx" && rm "$stage/onnx/model.onnx.part"
echo '{"type":"embedder","tasks":["embed"]}' > "$stage/model_manifest.json"
echo "  [1/1] onnx/model.onnx done (2.0 KiB, 1.0 KiB/s, 2.0s)" >&2
mv "$stage" "$5/$3"
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

/** The model install the way production runs it: inside an operation holding search-engine. */
let lastView: OperationView | undefined
async function installInferenceModels(opts: Omit<Parameters<typeof installModels>[0], 'op'>, _logger: undefined, models: InferenceModel[]) {
  const { value, view } = await withOperationView({ plan: ANTFLY_MODELS_PLAN, resources: ['search-engine'] }, (op) => installModels({ ...opts, op }, undefined, models, { pollMs: 10 }))
  lastView = view
  return value
}

const stagingDir = (model: string) => join(pullStagingRoot(modelsRoot), model.split('/')[0]!, `.${model.split('/')[1]}.antfly-download-staging`)

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

const optsAutoYes = { autoApprove: true }

beforeEach(() => {
  exchangeUnavailable = false
  flockUnavailable = false
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
  it('treats missing models as degraded-not-broken, with the reindex remediation', async () => {
    // v0.2.0-rc.2 does NOT lazy-download at index time (bakin#456): missing
    // models degrade semantic indexing until prefetch. Any write after the
    // model lands heals the index, so a plain reindex is the remediation.
    const result = await checkInferenceModels(TEST_MODELS)
    expect(result.status).toBe('missing')
    expect(result.message).toContain('semantic indexing is degraded')
    expect(result.message).toContain('search itself keeps working')
    expect(result.remediation).toContain('bakin install search-models')
    expect(result.remediation).toContain('bakin reindex')
  })

  it('reports ok when all models are present in the v0.2 owner/name layout', async () => {
    for (const m of TEST_MODELS) seedModel(m.model)
    const result = await checkInferenceModels(TEST_MODELS)
    expect(result.status).toBe('ok')
    expect(result.message).toContain(`All ${TEST_MODELS.length} search models present`)
    expect(String(result.details?.root)).toBe(modelsRoot)
  })

  it('names reranking (not semantic indexing) when only the reranker is missing', async () => {
    seedModel(TEST_MODELS[0].model)
    seedModel(TEST_MODELS[1].model)
    // TEST_MODELS[2] is the reranker — the only one missing now.
    const result = await checkInferenceModels(TEST_MODELS)
    expect(result.status).toBe('missing')
    expect(result.message).toContain('reranking is unavailable')
    expect(result.message).not.toContain('semantic indexing is degraded')
    expect(result.remediation).not.toContain('bakin reindex')
  })

  it('flags a model whose pull never completed (manifest missing)', async () => {
    for (const m of TEST_MODELS) seedModel(m.model)
    rmSync(join(modelsRoot, TEST_MODELS[0].model, 'model_manifest.json'))

    const result = await checkInferenceModels(TEST_MODELS)
    expect(result.status).toBe('missing')
    const missing = (result.details as { missing: Array<{ model: string; reason: string }> }).missing
    expect(missing).toHaveLength(1)
    expect(missing[0].model).toBe(TEST_MODELS[0].model)
    expect(missing[0].reason).toContain('model_manifest.json missing')
  })
})

describe('installInferenceModels', () => {
  it('fails when the antfly binary is missing', async () => {
    const result = await installInferenceModels(optsAutoYes, undefined, TEST_MODELS)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('antfly binary not found')
  })

  it('pulls missing models via `antfly inference pull` and verifies the layout', async () => {
    installFakeBinary(PULL_OK)

    const result = await installInferenceModels(optsAutoYes, undefined, TEST_MODELS)
    expect(result.status).toBe('installed')
    expect(result.message).toContain(`Pulled ${TEST_MODELS.length} models`)
    for (const m of TEST_MODELS) {
      expect(existsSync(join(modelsRoot, m.model, 'model_manifest.json'))).toBe(true)
    }
    expect((await checkInferenceModels(TEST_MODELS)).status).toBe('ok')
  })

  it('only pulls what is missing', async () => {
    installFakeBinary(PULL_OK)
    seedModel(TEST_MODELS[0].model)
    seedModel(TEST_MODELS[1].model)

    const result = await installInferenceModels(optsAutoYes, undefined, TEST_MODELS)
    expect(result.status).toBe('installed')
    expect(result.message).toContain('Pulled 1 model')
    expect(result.message).toContain(TEST_MODELS[2].label)
  })

  it('is a noop when everything is present', async () => {
    installFakeBinary(PULL_OK)
    for (const m of TEST_MODELS) seedModel(m.model)
    const result = await installInferenceModels(optsAutoYes, undefined, TEST_MODELS)
    expect(result.status).toBe('noop')
  })

  it('fails with the pull stderr when the CLI exits non-zero', async () => {
    installFakeBinary(PULL_FAILS)
    const result = await installInferenceModels(optsAutoYes, undefined, TEST_MODELS)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('exited with code 2')
    expect(result.message).toContain('HuggingFace unreachable')
  })

  it('fails when the pull claims success but the model never appears', async () => {
    installFakeBinary(PULL_LIES)
    const result = await installInferenceModels(optsAutoYes, undefined, TEST_MODELS)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('reported success but')
  })

  describe('pinned models are hashed before any skip (#898 E)', () => {
    const PINNED = { label: 'pinned embedder', model: 'test-pinned/embedder', kind: 'embedder' as const }
    const zeros = (n: number) => require('crypto').createHash('sha256').update(Buffer.alloc(n)).digest('hex') as string
    afterEach(() => { delete MODEL_PINS[PINNED.model] })

    it('a structurally complete model whose bytes do not match the pin is pulled again; the old copy is retired', async () => {
      MODEL_PINS[PINNED.model] = [{ file: 'onnx/model.onnx', sha256: zeros(2048) }]
      installFakeBinary(PULL_OK)
      seedModel(PINNED.model) // 'weights' — names right, bytes wrong
      const result = await installInferenceModels(optsAutoYes, undefined, [PINNED])
      expect(result.status).toBe('installed')
      expect(readFileSync(join(modelsRoot, PINNED.model, 'onnx', 'model.onnx')).length).toBe(2048)
      const leftovers = require('fs').readdirSync(join(modelsRoot, 'test-pinned')).filter((n: string) => n.includes('bakin-'))
      expect(leftovers).toEqual([])
    })

    it('a model whose bytes match the pin is a noop — no pull', async () => {
      MODEL_PINS[PINNED.model] = [{ file: 'onnx/model.onnx', sha256: require('crypto').createHash('sha256').update('weights').digest('hex') }]
      installFakeBinary(PULL_FAILS) // any pull would fail the install
      seedModel(PINNED.model)
      expect((await installInferenceModels(optsAutoYes, undefined, [PINNED])).status).toBe('noop')
    })

    it('a post-pull mismatch FAILS the install (never a warning) and the previous copy goes back', async () => {
      MODEL_PINS[PINNED.model] = [{ file: 'onnx/model.onnx', sha256: zeros(4096) }] // the pull serves 2048 bytes
      installFakeBinary(PULL_OK)
      seedModel(PINNED.model)
      const result = await installInferenceModels(optsAutoYes, undefined, [PINNED])
      expect(result.status).toBe('failed')
      expect(result.message).toMatch(/do not match their pinned sha256 \(onnx\/model\.onnx\)/)
      // The set-aside copy is restored — never left with nothing.
      expect(readFileSync(join(modelsRoot, PINNED.model, 'onnx', 'model.onnx'), 'utf-8')).toBe('weights')
    })

    it('when one model fails, nothing is published — every live model stays exactly as it was', async () => {
      const OTHER = { label: 'pinned reranker', model: 'test-pinned/reranker', kind: 'reranker' as const }
      MODEL_PINS[PINNED.model] = [{ file: 'onnx/model.onnx', sha256: zeros(2048) }]
      MODEL_PINS[OTHER.model] = [{ file: 'onnx/model.onnx', sha256: zeros(2048) }]
      try {
        // Pulls fine for the embedder, fails for the reranker.
        installFakeBinary(PULL_OK.replace('#!/bin/sh\n', `#!/bin/sh\n[ "$3" = "${OTHER.model}" ] && { echo "boom" >&2; exit 2; }\n`))
        seedModel(PINNED.model)
        seedModel(OTHER.model)
        const result = await installInferenceModels(optsAutoYes, undefined, [PINNED, OTHER])
        expect(result.status).toBe('failed')
        expect(readFileSync(join(modelsRoot, PINNED.model, 'onnx', 'model.onnx'), 'utf-8')).toBe('weights')
        expect(readFileSync(join(modelsRoot, OTHER.model, 'onnx', 'model.onnx'), 'utf-8')).toBe('weights')
      } finally {
        delete MODEL_PINS[OTHER.model]
      }
    })

    it('a cancelled re-pull leaves the live copy in place — nothing live moves before publish', async () => {
      MODEL_PINS[PINNED.model] = [{ file: 'onnx/model.onnx', sha256: zeros(2048) }]
      installFakeBinary(PULL_STALLS)
      seedModel(PINNED.model)
      const reg = createOperationRegistry({ bootId: () => 'b', publish: () => {}, quietCheckIntervalMs: 0, acquireResources: createMemoryResourceAcquirer(1) })
      try {
        const { operationId } = await reg.start({
          kind: 'install:search-models', owner: 'core', origin: 'cli', title: 'Download the search models', fingerprint: 'install:search-models',
          resources: ['search-engine'], plan: ANTFLY_MODELS_PLAN,
          run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installModels({ ...optsAutoYes, op }, undefined, [PINNED], { pollMs: 10, killAfterMs: 200 }) }),
        })
        await waitUntil(() => existsSync(join(stagingDir(PINNED.model), 'onnx', 'model.onnx.part')), { label: 'the re-pull is mid-file' })
        reg.cancel(operationId)
        expect((await reg.await(operationId)).status).toBe('cancelled')
      } finally {
        reg.dispose()
      }
      expect(readFileSync(join(modelsRoot, PINNED.model, 'onnx', 'model.onnx'), 'utf-8')).toBe('weights')
    })

    it('custom (unpinned) models are never described as matching pins', async () => {
      installFakeBinary(PULL_FAILS)
      for (const m of TEST_MODELS) seedModel(m.model)
      const result = await installInferenceModels(optsAutoYes, undefined, TEST_MODELS)
      expect(result.status).toBe('noop')
      expect(result.message).toContain('custom, checked structurally')
      const check = await checkInferenceModels(TEST_MODELS)
      expect(check.message).toContain('custom models are checked structurally only')
    })

    it('a live holder of the machine-wide models lock fails the install clearly; once it exits the lock is free', async () => {
      installFakeBinary(PULL_OK)
      const lockPath = join(require('path').dirname(modelsRoot), `.${require('path').basename(modelsRoot)}.bakin-pull.lock`)
      mkdirSync(require('path').dirname(lockPath), { recursive: true })
      const flockModule = require('path').resolve(import.meta.dir, '../../../packages/core/src/fs/flock.ts')
      const holderScript = join(testDir, 'holder.ts')
      writeFileSync(holderScript, `import { tryLockFile } from ${JSON.stringify(flockModule)}\nconst l = tryLockFile(${JSON.stringify(lockPath)})\nif (l.kind !== 'held') process.exit(3)\nconsole.log('held')\nawait Bun.sleep(30000)\n`)
      const holder = Bun.spawn(['bun', holderScript], { stdout: 'pipe', stderr: 'ignore' })
      const reader = holder.stdout.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('held')
      let result = await installInferenceModels(optsAutoYes, undefined, [TEST_MODELS[0]!])
      expect(result.status).toBe('failed')
      expect(result.message).toContain('Another Bakin on this machine is installing search models')
      holder.kill('SIGKILL') // the kernel releases a dead holder's flock — nothing to reclaim
      await holder.exited
      result = await installInferenceModels(optsAutoYes, undefined, [TEST_MODELS[0]!])
      expect(result.status).toBe('installed')
    }, 30_000)

    it('without flock the install fails closed — one lock protocol only, never a fallback that ignores flock holders', async () => {
      flockUnavailable = true
      installFakeBinary(PULL_OK)
      const result = await installInferenceModels(optsAutoYes, undefined, [TEST_MODELS[0]!])
      expect(result.status).toBe('failed')
      expect(result.message).toContain('cannot lock the shared search models folder')
      expect(existsSync(join(modelsRoot, TEST_MODELS[0]!.model))).toBe(false)
    })

    it('a malformed model id never reaches the filesystem — it cannot delete live models', async () => {
      installFakeBinary(PULL_OK)
      seedModel(TEST_MODELS[0]!.model)
      const evil = { label: 'evil', model: '../models', kind: 'embedder' as const }
      const result = await installInferenceModels(optsAutoYes, undefined, [evil])
      expect(result.status).toBe('failed')
      expect(result.message).toContain('Invalid search model id "../models"')
      expect(existsSync(join(modelsRoot, TEST_MODELS[0]!.model, 'onnx', 'model.onnx'))).toBe(true)
      expect((await checkInferenceModels([evil])).message).toContain('Invalid search model id')
    })

    it('without an atomic exchange a replacement fails safely — the live copy stays exactly as it was', async () => {
      exchangeUnavailable = true
      MODEL_PINS[PINNED.model] = [{ file: 'onnx/model.onnx', sha256: zeros(2048) }]
      installFakeBinary(PULL_OK)
      seedModel(PINNED.model)
      const result = await installInferenceModels(optsAutoYes, undefined, [PINNED])
      expect(result.status).toBe('failed')
      expect(result.message).toContain('cannot replace a live model atomically')
      expect(readFileSync(join(modelsRoot, PINNED.model, 'onnx', 'model.onnx'), 'utf-8')).toBe('weights')
      // Following the message's recovery steps succeeds.
      rmSync(join(modelsRoot, PINNED.model), { recursive: true, force: true })
      const retry = await installInferenceModels(optsAutoYes, undefined, [PINNED])
      expect(retry.status).toBe('installed')
      expect(readFileSync(join(modelsRoot, PINNED.model, 'onnx', 'model.onnx')).length).toBe(2048)
    })

    it('the doctor check stays structural and says so', async () => {
      MODEL_PINS[PINNED.model] = [{ file: 'onnx/model.onnx', sha256: zeros(4096) }]
      seedModel(PINNED.model)
      const check = await checkInferenceModels([PINNED])
      expect(check.status).toBe('ok')
      expect(check.message).toContain('integrity is hash-checked at install/repair')
    })
  })

  it('skips without approval, noting the degraded-semantic consequence', async () => {
    installFakeBinary(PULL_OK)
    const opts = { ...optsAutoYes, autoApprove: false }
    const result = await installInferenceModels(opts, undefined, TEST_MODELS)
    expect(result.status).toBe('skipped')
    expect(result.message).toContain('semantic indexing is degraded')
    expect(result.message).toContain('bakin reindex')
  })
})

describe('the model install as an operation (#895 D12)', () => {
  it('pulls into the staging root beside the live models root, then publishes into the live tree (#898 E)', async () => {
    installFakeBinary(PULL_OK)
    expect((await installInferenceModels(optsAutoYes, undefined, [TEST_MODELS[0]!])).status).toBe('installed')
    expect(readFileSync(join(testDir, 'argv.log'), 'utf8').trim()).toBe(`inference pull ${TEST_MODELS[0]!.model} --models-dir ${pullStagingRoot(modelsRoot)}`)
    expect(existsSync(join(modelsRoot, TEST_MODELS[0]!.model, 'model_manifest.json'))).toBe(true)
    expect(existsSync(join(pullStagingRoot(modelsRoot), TEST_MODELS[0]!.model))).toBe(false)
  })

  it('reports one download item per model with bytes against the announced sizes, then verifies', async () => {
    installFakeBinary(PULL_OK)
    await installInferenceModels(optsAutoYes, undefined, TEST_MODELS)
    const download = lastView!.stages.find((stage) => stage.id === 'download')!
    expect(download.items!.map((item) => [item.id, item.status])).toEqual(TEST_MODELS.map((m) => [m.model, 'done']))
    for (const item of download.items!) expect(item.bytes).toEqual({ received: 38 + 2048, total: 38 + 2048 })
    expect(lastView!.stages.find((stage) => stage.id === 'verify')!.status).toBe('done')
    expect(lastView!.lastOutput).toBe('done.')
  })

  it('overrides the downloading thresholds to the spec\'s model-pull row (30s quiet, 120s stuck)', () => {
    expect(ANTFLY_MODELS_PLAN.stages.find((stage) => stage.id === 'download')!.quiet).toEqual({ quietMs: 30_000, stuckMs: 120_000 })
  })

  it('skips both stages when every model is already present', async () => {
    installFakeBinary(PULL_OK)
    for (const m of TEST_MODELS) seedModel(m.model)
    await installInferenceModels(optsAutoYes, undefined, TEST_MODELS)
    expect(lastView!.stages.map((stage) => stage.status)).toEqual(['skipped', 'skipped'])
  })

  describe('a stalled pull', () => {
    const model = TEST_MODELS[0]!
    function registry() {
      return createOperationRegistry({ bootId: () => 'b', publish: () => {}, quietCheckIntervalMs: 0, acquireResources: createMemoryResourceAcquirer(1) })
    }
    async function startPull(reg: ReturnType<typeof registry>) {
      return reg.start({
        kind: 'install:search-models', owner: 'core', origin: 'cli', title: 'Download the search models', fingerprint: 'install:search-models',
        resources: ['search-engine'], plan: ANTFLY_MODELS_PLAN,
        run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installModels({ ...optsAutoYes, op }, undefined, [model], { pollMs: 10, killAfterMs: 200 }) }),
      })
    }
    const received = (reg: ReturnType<typeof registry>, id: string) =>
      reg.get(id)?.stages.find((stage) => stage.id === 'download')?.items?.[0]?.bytes?.received ?? 0

    it('reads the staged .part between protocol lines, then goes quiet and stuck while staying live', async () => {
      installFakeBinary(PULL_STALLS)
      const reg = registry()
      try {
        const { operationId } = await startPull(reg)
        await waitUntil(() => received(reg, operationId) === 1024, { label: 'the .part bytes are read' })
        const view = reg.get(operationId)!
        expect(view.status).toBe('running')
        expect(view.stages[0]!.items![0]!.bytes).toEqual({ received: 1024, total: 2048 })
        const stall = Date.parse(view.lastProgressAt) + 60 * 60 * 1000
        expect(operationQuietState(view, stall).state).toBe('stuck')
        reg.cancel(operationId)
        await reg.await(operationId)
      } finally {
        reg.dispose()
      }
    })

    it('a pull that ignores SIGTERM is killed, so the cancel still settles', async () => {
      installFakeBinary(PULL_IGNORES_TERM)
      const reg = registry()
      try {
        const { operationId } = await startPull(reg)
        await waitUntil(() => reg.get(operationId)?.lastOutput?.includes('[1/1]') === true, { label: 'the pull announced its file' })
        expect(reg.cancel(operationId)).toBe('cancelling')
        expect((await reg.await(operationId)).status).toBe('cancelled')
      } finally {
        reg.dispose()
      }
    })

    it('cancel stops the pull, keeps the staging dir, leaves the model dir untouched, and the next pull resumes', async () => {
      installFakeBinary(PULL_STALLS)
      const reg = registry()
      try {
        const { operationId } = await startPull(reg)
        await waitUntil(() => received(reg, operationId) === 1024, { label: 'the pull is mid-file' })
        expect(reg.cancel(operationId)).toBe('cancelling')
        expect((await reg.await(operationId)).status).toBe('cancelled')
      } finally {
        reg.dispose()
      }
      expect(existsSync(join(stagingDir(model.model), 'onnx', 'model.onnx.part'))).toBe(true)
      expect(existsSync(join(modelsRoot, model.model))).toBe(false)

      installFakeBinary(PULL_RESUMES)
      expect((await installInferenceModels(optsAutoYes, undefined, [model])).status).toBe('installed')
      expect(existsSync(stagingDir(model.model))).toBe(false)
      expect((await checkInferenceModels([model])).status).toBe('ok')
    })
  })
})
