/**
 * Model load verdicts (#993): the engine is the authority on whether a
 * complete download LOADS here. An unloadable model stays off the engine's
 * preloads (the engine exits on a failed preload), its leg isn't offered,
 * the layout fingerprint says so (and only then), and Health names it.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-model-load-${Date.now()}-${randomUUID()}`)
process.env.ANTFLY_HOME = testDir

import {
  _resetModelLoadCacheForTests,
  ensureModelLoadVerdicts,
  modelLoadable,
  modelLoadReceiptPath,
  modelLoadVerdict,
  probeModelLoad,
  type ProbeRunner,
} from '../../packages/adapter-antfly/src/model-load'
import { modelDir } from '../../packages/adapter-antfly/src/model-pins'
import { buildServiceArgv } from '../../packages/adapter-antfly/src/service'
import { embedderUsable } from '../../packages/adapter-antfly/src/translate'
import { checkInferenceModels } from '../../packages/adapter-antfly/src/models'
import { ANTFLY_PIN } from '../../packages/adapter-antfly/src/pin'
import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'
import { AntflySearchClient } from '../../packages/adapter-antfly/src/client'

const MODEL = 'acme/unpinned-embedder'

/** A complete unpinned download (generic weight-file check) with a pull marker. */
function seed(model = MODEL, marker = 'pull-1'): void {
  const dir = modelDir(model)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'model_manifest.json'), '{"type":"embedder"}')
  writeFileSync(join(dir, 'model.onnx'), 'weights')
  writeFileSync(join(dir, '.antfly-download-complete.json'), JSON.stringify({ marker }))
}

const loads: ProbeRunner = async () => ({ code: 0, output: '{"embeddings":[[0.1]]}', timedOut: false })
const fails: ProbeRunner = async () => ({
  code: 1,
  output: 'info: trying backend native\nerror: failed to warm\nantfly inference: startup failed; see the preceding diagnostic for details (error.MissingWeight)\n',
  timedOut: false,
})
const hangs: ProbeRunner = async () => ({ code: null, output: '', timedOut: true })

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  _resetModelLoadCacheForTests()
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('probeModelLoad', () => {
  it('records a model that loads', async () => {
    seed()
    expect((await probeModelLoad('/bin/antfly', MODEL, loads))?.loadable).toBe(true)
    expect(modelLoadable(MODEL)).toBe(true)
  })

  it("records the engine's own reason when it can't load", async () => {
    seed()
    const verdict = await probeModelLoad('/bin/antfly', MODEL, fails)
    expect(verdict).toMatchObject({ loadable: false, engineVersion: ANTFLY_PIN.version })
    expect(verdict?.reason).toContain('error.MissingWeight')
    expect(modelLoadable(MODEL)).toBe(false)
  })

  it('a hung probe records nothing — unknown stays loadable', async () => {
    seed()
    expect(await probeModelLoad('/bin/antfly', MODEL, hangs)).toBeNull()
    expect(modelLoadVerdict(MODEL)).toBeNull()
    expect(modelLoadable(MODEL)).toBe(true)
  })

  it('a re-pull or another engine version makes the verdict stale', async () => {
    seed()
    await probeModelLoad('/bin/antfly', MODEL, fails)
    expect(modelLoadable(MODEL)).toBe(false)

    seed(MODEL, 'pull-2')
    _resetModelLoadCacheForTests()
    expect(modelLoadVerdict(MODEL)).toBeNull()

    seed(MODEL, 'pull-1')
    await probeModelLoad('/bin/antfly', MODEL, fails)
    const receipt = JSON.parse(readFileSync(modelLoadReceiptPath(), 'utf8'))
    receipt[MODEL].engineVersion = '0.0.1'
    writeFileSync(modelLoadReceiptPath(), JSON.stringify(receipt))
    _resetModelLoadCacheForTests()
    expect(modelLoadVerdict(MODEL)).toBeNull()
  })
})

describe('ensureModelLoadVerdicts', () => {
  it('probes each complete model once, skipping incomplete ones and a missing binary', async () => {
    seed()
    const binary = join(testDir, 'antfly')
    writeFileSync(binary, '')
    let calls = 0
    const counting: ProbeRunner = async (...args) => { calls += 1; return loads(...args) }
    await ensureModelLoadVerdicts([MODEL, 'acme/not-downloaded'], binary, counting)
    await ensureModelLoadVerdicts([MODEL], binary, counting)
    expect(calls).toBe(1)
    await ensureModelLoadVerdicts([MODEL], join(testDir, 'no-such-binary'), counting)
    expect(calls).toBe(1)
  })
})

describe('wiring', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    embedders: {
      default: { provider: 'antfly', model: 'acme/text', dimension: 384 },
      visual: { provider: 'antfly', model: MODEL, dimension: 512 },
    },
  } as typeof DEFAULT_SETTINGS
  const paths = { binary: '/bin/antfly', dataDir: '/d', modelsDir: '/m', logFile: '/l' } as never

  it('an unloadable model is left off the preloads, its leg is not offered — a loadable one is untouched', async () => {
    seed('acme/text')
    seed()
    await probeModelLoad('/bin/antfly', 'acme/text', loads)
    await probeModelLoad('/bin/antfly', MODEL, fails)

    const argv = buildServiceArgv(settings, paths)
    expect(argv).toContain('embedder:acme/text')
    expect(argv).not.toContain(`embedder:${MODEL}`)
    expect(embedderUsable(settings.embedders.default)).toBe(true)
    expect(embedderUsable(settings.embedders.visual)).toBe(false)
  })

  it('Health names the model that cannot load here, with the reason, as degraded — not missing', async () => {
    seed()
    await probeModelLoad('/bin/antfly', MODEL, fails)
    const check = await checkInferenceModels([{ label: 'CLIP visual embedder', model: MODEL, kind: 'embedder' }])
    expect(check.status).toBe('warn')
    expect(check.message).toContain("CLIP visual embedder can't load on this machine")
    expect(JSON.stringify(check.details)).toContain('error.MissingWeight')
  })

  it('the layout fingerprint changes only for a model known not to load — never on upgrade for one that loads', async () => {
    const fingerprint = () => new AntflySearchClient(settings).mappingFingerprint()
    seed()
    const unknown = fingerprint()
    await probeModelLoad('/bin/antfly', MODEL, loads)
    expect(fingerprint()).toBe(unknown)
    await probeModelLoad('/bin/antfly', MODEL, fails)
    expect(fingerprint()).not.toBe(unknown)
    expect(new AntflySearchClient(settings).capabilities().legs).not.toContain('media-embedding')
  })
})

