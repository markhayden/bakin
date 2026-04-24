import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-parser-${Date.now()}`)
const defsDir = join(testDir, 'workflows', 'definitions')

// CLAUDE.md hard rule — content-dir must be mocked to a temp dir so the parser
// can never walk out of the sandbox.
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@bakin/tasks/lib/flow-store', () => ({}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

import { parseYAML, validateDefinition, loadDefinition, listDefinitions } from '@bakin/workflows/lib/parser'
import {
  registerPluginDefinition,
  clearSourceRegistry,
} from '@bakin/workflows/lib/source-registry'
import type { WorkflowDefinition } from '@bakin/workflows/types'

describe('parser', () => {
  beforeEach(() => {
    mkdirSync(defsDir, { recursive: true })
    clearSourceRegistry()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    clearSourceRegistry()
  })

  describe('parseYAML', () => {
    it('parses basic YAML', () => {
      const result = parseYAML('name: Test\nversion: 1')
      expect(result.name).toBe('Test')
      expect(result.version).toBe(1)
    })

    it('parses arrays and nested objects', () => {
      const yaml = `
name: Test
steps:
  - id: step1
    type: agent
    agent: basil
  - id: step2
    type: gate
`
      const result = parseYAML(yaml)
      expect(result.name).toBe('Test')
      expect(Array.isArray(result.steps)).toBe(true)
      expect((result.steps as unknown[]).length).toBe(2)
    })
  })

  describe('validateDefinition', () => {
    it('accepts a valid definition', () => {
      const def: WorkflowDefinition = {
        name: 'Test',
        description: 'Test workflow',
        version: 1,
        steps: [
          { id: 'step1', type: 'agent', label: 'Step 1', agent: 'basil' },
          { id: 'step2', type: 'agent', label: 'Step 2', agent: 'pixel' },
        ],
      }
      expect(validateDefinition(def)).toEqual([])
    })

    it('rejects definition with duplicate step IDs', () => {
      const def: WorkflowDefinition = {
        name: 'Test',
        description: 'Test',
        version: 1,
        steps: [
          { id: 'dupe', type: 'agent', label: 'Step 1', agent: 'basil' },
          { id: 'dupe', type: 'agent', label: 'Step 2', agent: 'pixel' },
        ],
      }
      const errors = validateDefinition(def)
      expect(errors.some(e => e.includes('Duplicate step ID'))).toBe(true)
    })

    it('rejects on_reject.goto referencing nonexistent step', () => {
      const def: WorkflowDefinition = {
        name: 'Test',
        description: 'Test',
        version: 1,
        steps: [
          { id: 'step1', type: 'agent', label: 'Step 1', agent: 'basil' },
          {
            id: 'gate1',
            type: 'gate',
            label: 'Gate',
            on_approve: 'step1',
            on_reject: { goto: 'nonexistent', note_to_agent: true },
          },
        ],
      }
      const errors = validateDefinition(def)
      expect(errors.some(e => e.includes('nonexistent'))).toBe(true)
    })

    it('rejects dependsOn referencing nonexistent step', () => {
      const def: WorkflowDefinition = {
        name: 'Test',
        description: 'Test',
        version: 1,
        steps: [
          { id: 'step1', type: 'agent', label: 'Step 1', agent: 'basil', dependsOn: 'missing' },
        ],
      }
      const errors = validateDefinition(def)
      expect(errors.some(e => e.includes('missing'))).toBe(true)
    })

    it('rejects definition with no steps', () => {
      const def = { name: 'Test', description: 'Test', version: 1, steps: [] } as WorkflowDefinition
      const errors = validateDefinition(def)
      expect(errors.length).toBeGreaterThan(0)
    })
  })

  describe('loadDefinition / listDefinitions', () => {
    it('loads a definition from file', () => {
      writeFileSync(join(defsDir, 'test.yaml'), `
name: Test Workflow
description: A test
version: 1
steps:
  - id: step1
    type: agent
    label: Do Thing
    agent: basil
`)
      const def = loadDefinition('test', testDir)
      expect(def).not.toBeNull()
      expect(def!.name).toBe('Test Workflow')
      expect(def!.steps.length).toBe(1)
    })

    it('returns null for nonexistent definition', () => {
      expect(loadDefinition('nope', testDir)).toBeNull()
    })

    it('lists all definitions', () => {
      writeFileSync(join(defsDir, 'a.yaml'), 'name: A\ndescription: A\nversion: 1\nsteps:\n  - id: s1\n    type: agent\n    label: S\n    agent: x')
      writeFileSync(join(defsDir, 'b.yaml'), 'name: B\ndescription: B\nversion: 1\nsteps:\n  - id: s1\n    type: agent\n    label: S\n    agent: x')

      const defs = listDefinitions(testDir)
      expect(defs.length).toBe(2)
    })

    it('tags disk-loaded definitions with source="user"', () => {
      writeFileSync(join(defsDir, 'test.yaml'), `
name: Disk Workflow
description: A test
version: 1
steps:
  - id: step1
    type: agent
    label: Do
    agent: basil
`)
      const def = loadDefinition('test', testDir)
      expect(def!.source).toBe('user')
      expect(def!.pluginId).toBeUndefined()
    })

    it('resolves plugin-registered definitions when no disk copy exists', () => {
      const pluginDef: WorkflowDefinition = {
        name: 'Plugin Workflow',
        description: 'From plugin',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'S', agent: 'basil' }],
      }
      registerPluginDefinition('workflows', 'plugin-only', pluginDef)

      const def = loadDefinition('plugin-only', testDir)
      expect(def).not.toBeNull()
      expect(def!.name).toBe('Plugin Workflow')
      expect(def!.source).toBe('plugin')
      expect(def!.pluginId).toBe('workflows')
    })

    it('user disk copy shadows a plugin-registered definition with the same id', () => {
      const pluginDef: WorkflowDefinition = {
        name: 'Plugin Original',
        description: 'Plugin',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'S', agent: 'basil' }],
      }
      registerPluginDefinition('workflows', 'shared', pluginDef)

      writeFileSync(join(defsDir, 'shared.yaml'), `
name: User Override
description: Mine
version: 1
steps:
  - id: s1
    type: agent
    label: Override
    agent: pixel
`)

      const def = loadDefinition('shared', testDir)
      expect(def!.name).toBe('User Override')
      expect(def!.source).toBe('user')
      expect(def!.pluginId).toBeUndefined()
    })

    it('listDefinitions merges disk + plugin entries, user wins on collision', () => {
      const pluginDef: WorkflowDefinition = {
        name: 'Plugin Alpha',
        description: 'From plugin',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'S', agent: 'basil' }],
      }
      registerPluginDefinition('workflows', 'alpha', pluginDef)
      registerPluginDefinition('workflows', 'beta', { ...pluginDef, name: 'Plugin Beta' })

      // Disk shadows "alpha" and adds "gamma"
      writeFileSync(join(defsDir, 'alpha.yaml'), 'name: User Alpha\ndescription: U\nversion: 1\nsteps:\n  - id: s1\n    type: agent\n    label: S\n    agent: x')
      writeFileSync(join(defsDir, 'gamma.yaml'), 'name: User Gamma\ndescription: U\nversion: 1\nsteps:\n  - id: s1\n    type: agent\n    label: S\n    agent: x')

      const defs = listDefinitions(testDir)
      const byName = new Map(defs.map(d => [d.name, d]))

      expect(byName.size).toBe(3)
      expect(byName.get('alpha')!.source).toBe('user')
      expect(byName.get('alpha')!.definition.name).toBe('User Alpha')
      expect(byName.get('beta')!.source).toBe('plugin')
      expect(byName.get('beta')!.pluginId).toBe('workflows')
      expect(byName.get('gamma')!.source).toBe('user')
    })
  })
})
