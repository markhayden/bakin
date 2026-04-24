import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-load-defaults-${Date.now()}`)
const fakeDefaultsDir = join(testDir, 'defaults', 'workflows')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@bakin/tasks/lib/flow-store', () => ({}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

import { loadDefaultWorkflows } from '@bakin/workflows/lib/load-defaults'
import { clearSourceRegistry, getDefinition } from '@bakin/workflows/lib/source-registry'
import { activatePlugin } from '../test-helpers'
import type { BakinPlugin, PluginContext } from '@/lib/plugin-types'

const fakeLog = { warn: mock(), info: mock(), error: mock(), debug: mock() }

function makeHostPlugin(defaultsDir: string): BakinPlugin {
  return {
    id: 'workflows-host',
    name: 'workflows-host',
    version: '1.0.0',
    activate: (ctx: PluginContext) => {
      loadDefaultWorkflows(ctx, defaultsDir, fakeLog)
    },
  }
}

const validYaml = `name: Demo
description: Demo workflow
version: 1
steps:
  - id: s1
    type: agent
    label: Do
    agent: chef
`

const invalidYaml = `name: Bad
description: missing steps
version: 1
steps: []
`

describe('loadDefaultWorkflows', () => {
  beforeEach(() => {
    mkdirSync(fakeDefaultsDir, { recursive: true })
    clearSourceRegistry()
    fakeLog.warn.mockClear()
  })
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    clearSourceRegistry()
  })

  it('registers every valid YAML under the host plugin id', async () => {
    writeFileSync(join(fakeDefaultsDir, 'demo-one.yaml'), validYaml)
    writeFileSync(join(fakeDefaultsDir, 'demo-two.yml'), validYaml.replace('Demo', 'Demo Two'))

    await activatePlugin(makeHostPlugin(fakeDefaultsDir), testDir)

    const one = getDefinition('demo-one')
    const two = getDefinition('demo-two')
    expect(one).toBeDefined()
    expect(one!.source).toBe('plugin')
    expect(one!.pluginId).toBe('workflows-host')
    expect(two).toBeDefined()
    expect(two!.definition.name).toBe('Demo Two')
  })

  it('skips invalid definitions and logs the failure', async () => {
    writeFileSync(join(fakeDefaultsDir, 'bad.yaml'), invalidYaml)
    writeFileSync(join(fakeDefaultsDir, 'good.yaml'), validYaml)

    await activatePlugin(makeHostPlugin(fakeDefaultsDir), testDir)

    expect(getDefinition('bad')).toBeUndefined()
    expect(getDefinition('good')).toBeDefined()
    expect(fakeLog.warn).toHaveBeenCalled()
  })

  it('uses the filename (sans extension) as the workflow id', async () => {
    writeFileSync(join(fakeDefaultsDir, 'my-cool-flow.yaml'), validYaml)

    await activatePlugin(makeHostPlugin(fakeDefaultsDir), testDir)

    expect(getDefinition('my-cool-flow')).toBeDefined()
  })

  it('returns an empty result when the defaults dir does not exist', async () => {
    rmSync(fakeDefaultsDir, { recursive: true, force: true })

    const ctx = { registerWorkflow: mock() } as unknown as PluginContext
    const result = loadDefaultWorkflows(ctx, fakeDefaultsDir, fakeLog)
    expect(result.registered).toEqual([])
    expect(result.skipped).toEqual([])
    expect(ctx.registerWorkflow).not.toHaveBeenCalled()
  })
})
