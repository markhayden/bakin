/**
 * Model load verdicts (#993): the engine is the authority on whether a
 * complete download LOADS here. An unloadable model stays off the engine's
 * preloads (the engine exits on a failed preload), its leg isn't offered,
 * the layout fingerprint says so (and only then), and Health names it.
 * Only the engine's own diagnostic records "can't load"; anything else
 * (another engine version, a spawn failure, a signal, a timeout, a cancel)
 * records nothing. Guest endpoints are never judged by local verdicts.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-model-load-${Date.now()}-${randomUUID()}`)
process.env.ANTFLY_HOME = testDir

import {
  _resetModelLoadCacheForTests,
  ensureModelLoadVerdicts,
  modelLoadable,
  modelLoadReceiptDir,
  modelLoadVerdict,
  probeModelLoad,
  type ProbeResult,
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
const LOCAL = 'http://127.0.0.1:3738'
const GUEST = 'http://10.0.0.7:3738'

/** A complete unpinned download (generic weight-file check) with a pull marker. */
function seed(model = MODEL, marker = 'pull-1'): void {
  const dir = modelDir(model)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'model_manifest.json'), '{"type":"embedder"}')
  writeFileSync(join(dir, 'model.onnx'), 'weights')
  writeFileSync(join(dir, '.antfly-download-complete.json'), JSON.stringify({ marker }))
}

const ok = (over: Partial<ProbeResult> = {}): ProbeResult => ({ code: 0, output: '', timedOut: false, spawnFailed: false, aborted: false, ...over })

/** A fake engine: `--version` answers `version`; `inference embed` answers `embed`. */
function engine(embed: ProbeResult, version = ANTFLY_PIN.version): ProbeRunner {
  return async (_binary, args) => (args[0] === '--version' ? ok({ output: `antfly ${version} (zig)` }) : embed)
}
const loads = engine(ok({ output: '{"embeddings":[[0.1]]}' }))
const rejects = engine(ok({
  code: 1,
  output: 'info: trying backend native\nantfly inference: startup failed; see the preceding diagnostic for details (error.MissingWeight)\n',
}))

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  _resetModelLoadCacheForTests()
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('probeModelLoad', () => {
  it('records a model that loads', async () => {
    seed()
    expect((await probeModelLoad('/bin/antfly', MODEL, { run: loads }))?.loadable).toBe(true)
    expect(modelLoadable(MODEL, LOCAL)).toBe(true)
  })

  it("records the engine's own diagnostic when it can't load", async () => {
    seed()
    const verdict = await probeModelLoad('/bin/antfly', MODEL, { run: rejects })
    expect(verdict).toMatchObject({ loadable: false, engineVersion: ANTFLY_PIN.version })
    expect(verdict?.reason).toContain('error.MissingWeight')
    expect(modelLoadable(MODEL, LOCAL)).toBe(false)
  })

  it('records nothing for anything but an engine answer: another version, a spawn failure, a bare exit, a signal, a timeout, a cancel', async () => {
    seed()
    const cases: ProbeRunner[] = [
      engine(ok({ code: 1, output: 'error.MissingWeight' }), '0.2.1'),
      engine(ok({ code: null, spawnFailed: true })),
      engine(ok({ code: 1, output: 'Segmentation fault' })),
      engine(ok({ code: null })),
      engine(ok({ code: null, timedOut: true })),
      engine(ok({ code: null, aborted: true })),
    ]
    for (const run of cases) expect(await probeModelLoad('/bin/antfly', MODEL, { run })).toBeNull()
    expect(modelLoadVerdict(MODEL)).toBeNull()
    expect(modelLoadable(MODEL, LOCAL)).toBe(true)
  })

  it('a re-pull makes the verdict stale', async () => {
    seed()
    await probeModelLoad('/bin/antfly', MODEL, { run: rejects })
    expect(modelLoadable(MODEL, LOCAL)).toBe(false)
    seed(MODEL, 'pull-2')
    expect(modelLoadVerdict(MODEL)).toBeNull()
  })

  it('verdicts for different models never clobber each other (one receipt per model)', async () => {
    const models = Array.from({ length: 12 }, (_, i) => `acme/model-${i}`)
    for (const model of models) seed(model)
    await Promise.all(models.map((model, i) => probeModelLoad('/bin/antfly', model, { run: i % 2 ? rejects : loads })))
    _resetModelLoadCacheForTests()
    expect(readdirSync(modelLoadReceiptDir()).filter((f) => f.endsWith('.json'))).toHaveLength(12)
    for (const [i, model] of models.entries()) expect(modelLoadVerdict(model)?.loadable).toBe(i % 2 === 0)
  })

  it('a guest endpoint is never judged by this machine’s verdicts', async () => {
    seed()
    await probeModelLoad('/bin/antfly', MODEL, { run: rejects })
    expect(modelLoadable(MODEL, LOCAL)).toBe(false)
    expect(modelLoadable(MODEL, GUEST)).toBe(true)
  })
})

describe('ensureModelLoadVerdicts', () => {
  it('probes each complete model once, skipping incomplete ones, a missing binary and a cancelled run', async () => {
    seed()
    const binary = join(testDir, 'antfly')
    writeFileSync(binary, '')
    let embeds = 0
    const counting: ProbeRunner = async (b, args, t, s) => { if (args[0] !== '--version') embeds += 1; return loads(b, args, t, s) }
    await ensureModelLoadVerdicts([MODEL, 'acme/not-downloaded'], binary, { run: counting })
    await ensureModelLoadVerdicts([MODEL], binary, { run: counting })
    expect(embeds).toBe(1)
    await ensureModelLoadVerdicts([MODEL], join(testDir, 'no-such-binary'), { run: counting })
    seed('acme/second')
    const cancelled = new AbortController()
    cancelled.abort()
    await ensureModelLoadVerdicts(['acme/second'], binary, { run: counting, signal: cancelled.signal })
    expect(embeds).toBe(1)
  })
})

describe('wiring', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    url: LOCAL,
    embedders: {
      default: { provider: 'antfly', model: 'acme/text', dimension: 384 },
      visual: { provider: 'antfly', model: MODEL, dimension: 512 },
    },
  } as typeof DEFAULT_SETTINGS
  const paths = { binary: '/bin/antfly', dataDir: '/d', modelsDir: '/m', logFile: '/l' } as never

  it('an unloadable model is left off the preloads and its leg is not offered — a loadable one is untouched', async () => {
    seed('acme/text')
    seed()
    await probeModelLoad('/bin/antfly', 'acme/text', { run: loads })
    await probeModelLoad('/bin/antfly', MODEL, { run: rejects })

    const argv = buildServiceArgv(settings, paths)
    expect(argv).toContain('embedder:acme/text')
    expect(argv).not.toContain(`embedder:${MODEL}`)
    expect(embedderUsable(settings.embedders.default, LOCAL)).toBe(true)
    expect(embedderUsable(settings.embedders.visual, LOCAL)).toBe(false)
    expect(embedderUsable(settings.embedders.visual, GUEST)).toBe(true)
  })

  it('Health names the model that cannot load here, with the reason, as degraded — not missing', async () => {
    seed()
    await probeModelLoad('/bin/antfly', MODEL, { run: rejects })
    const check = await checkInferenceModels([{ label: 'CLIP visual embedder', model: MODEL, kind: 'embedder' }])
    expect(check.status).toBe('warn')
    expect(check.message).toContain("CLIP visual embedder can't load on this machine")
    expect(JSON.stringify(check.details)).toContain('error.MissingWeight')
  })

  it('the layout fingerprint changes only for a model known not to load — never on upgrade for one that loads', async () => {
    const fingerprint = () => new AntflySearchClient(settings).mappingFingerprint()
    seed()
    const unknown = fingerprint()
    await probeModelLoad('/bin/antfly', MODEL, { run: loads })
    expect(fingerprint()).toBe(unknown)
    await probeModelLoad('/bin/antfly', MODEL, { run: rejects })
    expect(fingerprint()).not.toBe(unknown)
    expect(new AntflySearchClient(settings).capabilities().legs).not.toContain('media-embedding')
  })
})
