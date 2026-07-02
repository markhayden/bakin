import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-search-adapter-factory-${Date.now()}`)
const antflyHomeDir = join(testDir, 'antfly-home')
const modelsRoot = join(antflyHomeDir, 'inference', 'models')

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))

import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'
import { getSearchAdapterSetup } from '../../src/core/search-adapter-factory'

const logger = { debug: mock(), info: mock(), warn: mock(), error: mock() }

function seedModel(model: string): void {
  const dir = join(modelsRoot, model)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'model_manifest.json'), '{"type":"embedder"}')
  writeFileSync(join(dir, 'model.onnx'), 'weights')
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(antflyHomeDir, { recursive: true })
  process.env.ANTFLY_HOME = antflyHomeDir
  mock.clearAllMocks()
})

afterEach(() => {
  delete process.env.ANTFLY_HOME
  rmSync(testDir, { recursive: true, force: true })
})

describe('getSearchAdapterSetup', () => {
  it('uses active settings when determining required Antfly models', async () => {
    seedModel('BAAI/bge-small-en-v1.5')
    seedModel('antflydb/clipclap')

    const setup = getSearchAdapterSetup('antfly', logger, {
      ...DEFAULT_SETTINGS,
      embedders: {
        default: DEFAULT_SETTINGS.embedders.default,
        visual: DEFAULT_SETTINGS.embedders.visual,
        custom: { provider: 'antfly', model: 'example/custom-embedder', dimension: 128 },
      },
      auditTtl: '90d',
      cleanupInterval: '7d',
    })

    const result = await setup.models!.check()

    expect(result.status).toBe('missing')
    expect((result.details?.missing as Array<{ model: string }>).map((m) => m.model)).toContain('example/custom-embedder')
  })
})
