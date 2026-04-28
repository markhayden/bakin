/**
 * Tests for the models onboarding component (Termite model downloads).
 *
 * Strategy mirrors the antfly test suite:
 *   - Mock the Antfly adapter binary helper so the test can assert what happens when the
 *     antfly binary is present vs missing
 *   - Mock child_process.spawn to fire configurable exit codes without
 *     launching real processes
 *   - Mock fs.existsSync so the "is this model present on disk" check
 *     can be scripted per-test. A small in-memory set holds the paths
 *     the mock should report as existing.
 *   - Mock prompts so interactive confirmation is deterministic
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { join } from 'path'

let antflyBinary: string | null
let existingPaths: Set<string>
/**
 * Virtual file contents for paths the component reads via readFileSync.
 * Currently only `model_manifest.json` for each "present" model.
 */
let virtualFiles: Map<string, string>
/** Virtual file sizes for statSync, keyed by absolute path. */
let virtualSizes: Map<string, number>
let spawnExitCode: number | null
let spawnError: Error | null
let spawnCalls: Array<{ cmd: string; args: string[] }>
let askYesNoReturn: boolean
/**
 * When true, every successful spawn('antfly termite pull <model>') also
 * "creates" the model directory in the fake fs — simulating a real pull
 * that actually populates the target dir. When false, spawn exits 0 but
 * existsSync still reports missing, exercising the "success but file
 * still missing" guard in the component.
 */
let spawnCreatesFiles: boolean

/**
 * Fully "install" a model in the virtual fs: directory present, a
 * `model_manifest.json` listing one weights file, and a stat-able stub
 * for the weights file with the matching size. This is the shape that
 * `modelComplete()` requires to declare the model healthy.
 */
function virtualInstall(modelDir: string) {
  existingPaths.add(modelDir)
  const manifestPath = join(modelDir, 'model_manifest.json')
  const weightsPath = join(modelDir, 'model.onnx')
  const manifest = {
    schemaVersion: 2,
    name: 'stub',
    files: [{ name: 'model.onnx', digest: 'sha256:stub', size: 42 }],
  }
  virtualFiles.set(manifestPath, JSON.stringify(manifest))
  existingPaths.add(manifestPath)
  existingPaths.add(weightsPath)
  virtualSizes.set(weightsPath, 42)
}

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@bakin/adapter-antfly', () => ({
  findAntflyBinary: () => antflyBinary,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('fs', () => {
  const actual = require('fs') as typeof import('fs')
  return {
    ...actual,
    existsSync: (p: unknown) => existingPaths.has(String(p)),
    readFileSync: (p: unknown, ...rest: unknown[]) => {
      const key = String(p)
      if (virtualFiles.has(key)) return virtualFiles.get(key)!
      return (actual.readFileSync as unknown as (...args: unknown[]) => unknown)(p, ...rest)
    },
    statSync: (p: unknown, ...rest: unknown[]) => {
      const key = String(p)
      if (virtualSizes.has(key)) return { size: virtualSizes.get(key)! }
      return (actual.statSync as unknown as (...args: unknown[]) => unknown)(p, ...rest)
    },
  }
})

mock.module('child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args })
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter | null
      stderr: EventEmitter | null
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    setImmediate(() => {
      if (spawnError) {
        child.emit('error', spawnError)
        return
      }
      if (spawnExitCode === 0 && spawnCreatesFiles && args[0] === 'termite' && args[1] === 'pull') {
        const modelId = args[2]
        // Termite stores embedders under embedders/<model>, rerankers
        // under rerankers/<model>. Populate both branches with a
        // complete virtual install (manifest + weights) so the
        // post-pull verification step in the component finds the right
        // shape regardless of which kind we mocked.
        const root = join(homedir(), '.termite', 'models')
        virtualInstall(join(root, 'embedders', modelId))
        virtualInstall(join(root, 'rerankers', modelId))
      }
      child.stderr?.emit('data', Buffer.from(''))
      child.emit('close', spawnExitCode)
    })
    return child
  },
}))

mock.module('../../../src/core/onboarding/prompts', () => ({
  askYesNo: () => Promise.resolve(askYesNoReturn),
  readLine: () => Promise.resolve(''),
}))

describe('onboarding models component', () => {
  let modelsComponent: typeof import('../../../src/core/onboarding/models').modelsComponent
  let REQUIRED_MODELS: typeof import('../../../src/core/onboarding/models').REQUIRED_MODELS
  let termiteModelsRoot: typeof import('../../../src/core/onboarding/models').termiteModelsRoot

  beforeEach(async () => {
    antflyBinary = '/opt/homebrew/bin/antfly'
    existingPaths = new Set()
    virtualFiles = new Map()
    virtualSizes = new Map()
    spawnExitCode = 0
    spawnError = null
    spawnCalls = []
    askYesNoReturn = true
    spawnCreatesFiles = true
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/models')
    modelsComponent = mod.modelsComponent
    REQUIRED_MODELS = mod.REQUIRED_MODELS
    termiteModelsRoot = mod.termiteModelsRoot
  })

  afterEach(() => {
    spawnCalls = []
  })

  const optsAutoYes = {
    interactive: false,
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }
  const optsInteractive = {
    interactive: true,
    autoApprove: false,
    json: false,
    checkOnly: false,
    force: false,
  }
  const optsNonInteractiveNoYes = {
    interactive: false,
    autoApprove: false,
    json: false,
    checkOnly: false,
    force: false,
  }

  /** Seed every required model as a complete virtual install. */
  function seedAllModelsPresent() {
    const root = termiteModelsRoot()
    for (const m of REQUIRED_MODELS) {
      const bucket = m.kind === 'embedder' ? 'embedders' : 'rerankers'
      virtualInstall(join(root, bucket, m.model))
    }
  }

  describe('REQUIRED_MODELS', () => {
    it('contains exactly the three expected Termite models', () => {
      expect(REQUIRED_MODELS).toHaveLength(3)
      const ids = REQUIRED_MODELS.map((m) => m.model)
      expect(ids).toContain('BAAI/bge-small-en-v1.5')
      expect(ids).toContain('openai/clip-vit-base-patch32')
      expect(ids).toContain('mixedbread-ai/mxbai-rerank-base-v1')
    })
  })

  describe('check()', () => {
    it('reports ok when all three models are present', async () => {
      seedAllModelsPresent()
      const result = await modelsComponent.check()
      expect(result.status).toBe('ok')
      expect(result.message).toContain('3 Termite models')
    })

    it('reports missing with details when all models are absent', async () => {
      const result = await modelsComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('3 of 3')
      const missing = result.details?.missing as Array<{ model: string }>
      expect(missing).toHaveLength(3)
    })

    it('reports missing with partial list when only some are absent', async () => {
      // Seed just the BGE embedder as fully installed
      virtualInstall(join(termiteModelsRoot(), 'embedders', 'BAAI/bge-small-en-v1.5'))
      const result = await modelsComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('2 of 3')
      const missing = result.details?.missing as Array<{ model: string }>
      expect(missing).toHaveLength(2)
      expect(missing.map((m) => m.model)).not.toContain('BAAI/bge-small-en-v1.5')
    })

    it('reports missing when a model directory exists but model_manifest.json is absent', async () => {
      // Half-pulled state — directory there, no manifest. This is the
      // exact failure mode that bit us in production with BGE.
      existingPaths.add(join(termiteModelsRoot(), 'embedders', 'BAAI/bge-small-en-v1.5'))
      const result = await modelsComponent.check()
      expect(result.status).toBe('missing')
      const missing = result.details?.missing as Array<{ model: string; reason: string }>
      const bge = missing.find((m) => m.model === 'BAAI/bge-small-en-v1.5')
      expect(bge?.reason).toContain('model_manifest.json missing')
    })

    it('reports missing when a manifested file is the wrong size', async () => {
      // Manifest claims 42 bytes, file is on disk but stat says 7 — the
      // pull was interrupted mid-write.
      const dir = join(termiteModelsRoot(), 'embedders', 'BAAI/bge-small-en-v1.5')
      virtualInstall(dir)
      virtualSizes.set(join(dir, 'model.onnx'), 7)
      const result = await modelsComponent.check()
      expect(result.status).toBe('missing')
      const missing = result.details?.missing as Array<{ model: string; reason: string }>
      const bge = missing.find((m) => m.model === 'BAAI/bge-small-en-v1.5')
      expect(bge?.reason).toContain('size mismatch')
    })
  })

  describe('install()', () => {
    it('fails cleanly when the antfly binary is missing', async () => {
      antflyBinary = null
      const result = await modelsComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('antfly binary not found')
      expect(spawnCalls).toHaveLength(0)
    })

    it('is a noop when all models are already present', async () => {
      seedAllModelsPresent()
      const result = await modelsComponent.install(optsAutoYes)
      expect(result.status).toBe('noop')
      expect(spawnCalls).toHaveLength(0)
    })

    it('pulls each missing model via antfly termite pull', async () => {
      const result = await modelsComponent.install(optsAutoYes)
      expect(result.status).toBe('installed')
      expect(spawnCalls).toHaveLength(3)
      for (const call of spawnCalls) {
        expect(call.cmd).toBe('/opt/homebrew/bin/antfly')
        expect(call.args[0]).toBe('termite')
        expect(call.args[1]).toBe('pull')
      }
      const pulledIds = spawnCalls.map((c) => c.args[2])
      expect(pulledIds).toContain('BAAI/bge-small-en-v1.5')
      expect(pulledIds).toContain('openai/clip-vit-base-patch32')
      expect(pulledIds).toContain('mixedbread-ai/mxbai-rerank-base-v1')
    })

    it('pulls only the missing subset when some models already exist', async () => {
      virtualInstall(join(termiteModelsRoot(), 'embedders', 'BAAI/bge-small-en-v1.5'))
      const result = await modelsComponent.install(optsAutoYes)
      expect(result.status).toBe('installed')
      expect(spawnCalls).toHaveLength(2)
      const pulledIds = spawnCalls.map((c) => c.args[2])
      expect(pulledIds).not.toContain('BAAI/bge-small-en-v1.5')
    })

    it('stops on the first failed pull and returns failed', async () => {
      spawnExitCode = 1
      const result = await modelsComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('exited with code 1')
      // Bailed after the first failure — no retries of the other two
      expect(spawnCalls).toHaveLength(1)
    })

    it('reports failed when spawn succeeds but the model directory is still empty', async () => {
      spawnExitCode = 0
      spawnCreatesFiles = false
      const result = await modelsComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      // modelComplete reports the specific reason — directory missing,
      // manifest missing, file missing, or size mismatch.
      expect(result.message).toMatch(/directory missing|manifest|missing|size mismatch/)
    })

    it('skips install when user declines the interactive prompt', async () => {
      askYesNoReturn = false
      const result = await modelsComponent.install(optsInteractive)
      expect(result.status).toBe('skipped')
      expect(spawnCalls).toHaveLength(0)
    })

    it('skips install in non-interactive mode without --yes', async () => {
      const result = await modelsComponent.install(optsNonInteractiveNoYes)
      expect(result.status).toBe('skipped')
      expect(result.message).toContain('Non-interactive')
      expect(spawnCalls).toHaveLength(0)
    })

    it('reports failed when spawn emits an error event', async () => {
      spawnError = new Error('EPIPE')
      const result = await modelsComponent.install(optsAutoYes)
      expect(result.status).toBe('failed')
      expect(result.message).toContain('EPIPE')
    })
  })
})
