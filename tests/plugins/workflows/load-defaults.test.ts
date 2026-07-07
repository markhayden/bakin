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
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('@/core/task-store', () => ({
  addTaskLog: mock(),
  createTask: mock(),
  getTask: mock(() => null),
  moveTask: mock(),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

import { loadDefaultWorkflows } from '@bakin/workflows/lib/load-defaults'
import { clearSourceRegistry, getDefinition, registerPluginDefinition } from '@bakin/core/workflows/source-registry'
import { activatePlugin } from '../test-helpers'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'

const fakeLog = { warn: mock(), info: mock(), error: mock(), debug: mock() }

function makeHostPlugin(defaultsDir: string, id = 'workflows-host'): BakinPlugin {
  return {
    id,
    name: id,
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
    agent: $assigned
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

  it('keeps repository default workflows valid and portable', () => {
    const registered: string[] = []

    const ctx = {
      registerWorkflow: (definition: { id?: string; name: string }) => {
        const id = definition.id ?? definition.name
        registered.push(id)
        registerPluginDefinition('repository-defaults-test', id, definition as never)
      },
    } as unknown as PluginContext

    const imagesResult = loadDefaultWorkflows(ctx, join(process.cwd(), 'plugins', 'images', 'defaults', 'workflows'), fakeLog)
    const workflowsResult = loadDefaultWorkflows(ctx, join(process.cwd(), 'plugins', 'workflows', 'defaults', 'workflows'), fakeLog)

    expect(imagesResult.skipped).toEqual([])
    expect(workflowsResult.skipped).toEqual([])
    expect(registered).toContain('image-generation')
    expect(registered).toContain('image-multi-select')
    expect(registered).toContain('image-variant')
    expect(registered).toContain('text-social-post')
    expect(registered).toContain('image-social-post')
    expect(registered).toContain('video-social-post')
  })

  it('loads nested defaults independent of filesystem order', async () => {
    writeFileSync(join(fakeDefaultsDir, 'parent.yaml'), `name: Parent
description: Parent workflow
version: 1
steps:
  - id: run-child
    type: workflow
    label: Run Child
    workflow_id: child
`)
    writeFileSync(join(fakeDefaultsDir, 'child.yaml'), validYaml)

    await activatePlugin(makeHostPlugin(fakeDefaultsDir), testDir)

    expect(getDefinition('parent')).toBeDefined()
    expect(getDefinition('child')).toBeDefined()
  })

  it('registers defaults whose nested refs are missing at load — existence is start-time + health, not load-fatal (#374)', async () => {
    writeFileSync(join(fakeDefaultsDir, 'parent.yaml'), `name: Parent
description: Parent workflow
version: 1
steps:
  - id: run-child
    type: workflow
    label: Run Child
    workflow_id: missing-child
`)

    await activatePlugin(makeHostPlugin(fakeDefaultsDir), testDir)

    expect(getDefinition('parent')).toBeDefined()
  })

  it('still skips structural failures and self-references at load', async () => {
    writeFileSync(join(fakeDefaultsDir, 'self-ref.yaml'), `name: Self
description: references itself
version: 1
steps:
  - id: run-self
    type: workflow
    label: Run Self
    workflow_id: self-ref
`)
    writeFileSync(join(fakeDefaultsDir, 'bad.yaml'), invalidYaml)

    await activatePlugin(makeHostPlugin(fakeDefaultsDir), testDir)

    expect(getDefinition('self-ref')).toBeUndefined()
    expect(getDefinition('bad')).toBeUndefined()
    expect(fakeLog.warn).toHaveBeenCalled()
  })

  it('loads cross-plugin nested refs regardless of plugin activation order (#374)', async () => {
    const parentDir = join(testDir, 'plugin-a', 'defaults', 'workflows')
    const childDir = join(testDir, 'plugin-b', 'defaults', 'workflows')
    mkdirSync(parentDir, { recursive: true })
    mkdirSync(childDir, { recursive: true })
    writeFileSync(join(parentDir, 'composite-post.yaml'), `name: Composite Post
description: parent in plugin A
version: 1
steps:
  - id: make-image
    type: workflow
    label: Make Image
    workflow_id: shared-child
`)
    writeFileSync(join(childDir, 'shared-child.yaml'), validYaml)

    // Parent's plugin activates FIRST — child not yet in the registry.
    await activatePlugin(makeHostPlugin(parentDir, 'plugin-a'), testDir)
    await activatePlugin(makeHostPlugin(childDir, 'plugin-b'), testDir)
    expect(getDefinition('composite-post')).toBeDefined()
    expect(getDefinition('shared-child')).toBeDefined()

    // And the reverse order.
    clearSourceRegistry()
    await activatePlugin(makeHostPlugin(childDir, 'plugin-b'), testDir)
    await activatePlugin(makeHostPlugin(parentDir, 'plugin-a'), testDir)
    expect(getDefinition('composite-post')).toBeDefined()
    expect(getDefinition('shared-child')).toBeDefined()
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
