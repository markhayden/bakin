import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-parser-${Date.now()}`)
const defsDir = join(testDir, 'workflows', 'definitions')

// CLAUDE.md hard rule — content-dir must be mocked to a temp dir so the parser
// can never walk out of the sandbox.
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
    agent: chef
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
          { id: 'step1', type: 'agent', label: 'Step 1', agent: 'chef' },
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
          { id: 'dupe', type: 'agent', label: 'Step 1', agent: 'chef' },
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
          { id: 'step1', type: 'agent', label: 'Step 1', agent: 'chef' },
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
          { id: 'step1', type: 'agent', label: 'Step 1', agent: 'chef', dependsOn: 'missing' },
        ],
      }
      const errors = validateDefinition(def)
      expect(errors.some(e => e.includes('missing'))).toBe(true)
    })

    it('rejects gate approval jumps that do not point to the next step', () => {
      const def: WorkflowDefinition = {
        name: 'Test',
        description: 'Test',
        version: 1,
        steps: [
          { id: 'write', type: 'agent', label: 'Write', agent: 'chef' },
          { id: 'review', type: 'gate', label: 'Review', on_approve: 'publish' },
          { id: 'revise', type: 'agent', label: 'Revise', agent: 'chef' },
          { id: 'publish', type: 'output', label: 'Publish', agent: 'chef' },
        ],
      }

      const errors = validateDefinition(def)
      expect(errors.some(e => e.includes('on_approve must point to the next'))).toBe(true)
    })

    it('rejects gates inside parallel groups', () => {
      const def: WorkflowDefinition = {
        name: 'Test',
        description: 'Test',
        version: 1,
        steps: [
          {
            id: 'fanout',
            type: 'parallel',
            label: 'Fan Out',
            steps: [
              { id: 'write', type: 'agent', label: 'Write', agent: 'chef' },
              { id: 'review', type: 'gate', label: 'Review', on_approve: 'done' },
            ],
          },
        ],
      }

      const errors = validateDefinition(def)
      expect(errors.some(e => e.includes('parallel children must be agent steps'))).toBe(true)
    })

    it('requires plugin-shipped definitions to use symbolic agents', () => {
      const def: WorkflowDefinition = {
        name: 'Plugin Default',
        description: 'Default workflow',
        version: 1,
        steps: [{ id: 'write', type: 'agent', label: 'Write', agent: 'chef' }],
      }

      const errors = validateDefinition(def, { source: 'plugin' })
      expect(errors.some(e => e.includes('must use symbolic agents'))).toBe(true)
    })

    it('validates user literal agents against the runtime roster when supplied', () => {
      const def: WorkflowDefinition = {
        name: 'User Workflow',
        description: 'Local workflow',
        version: 1,
        steps: [{ id: 'write', type: 'agent', label: 'Write', agent: 'pixel' }],
      }

      expect(validateDefinition(def, { source: 'user', runtimeAgents: ['pixel'] })).toEqual([])
      const errors = validateDefinition(def, { source: 'user', runtimeAgents: ['trainer'] })
      expect(errors.some(e => e.includes('unknown agent "pixel"'))).toBe(true)
    })

    it('fails $assigned when start-time validation has no assignee', () => {
      const def: WorkflowDefinition = {
        name: 'Assigned Workflow',
        description: 'Needs assignee',
        version: 1,
        steps: [{ id: 'write', type: 'agent', label: 'Write', agent: '$assigned' }],
      }

      const errors = validateDefinition(def, {
        source: 'user',
        runtimeAgents: ['pixel'],
        requireResolvedAgents: true,
      })
      expect(errors.some(e => e.includes('has no assignee'))).toBe(true)
    })

    it('rejects nested workflows that reference themselves', () => {
      const def: WorkflowDefinition = {
        name: 'Self Reference',
        description: 'Invalid nested workflow',
        version: 1,
        steps: [
          { id: 'loop', type: 'workflow', label: 'Loop', workflow_id: 'self-reference' },
        ],
      }

      const errors = validateDefinition(def, {
        definitionId: 'self-reference',
        knownWorkflowIds: ['self-reference'],
      })
      expect(errors.some(e => e.includes('cannot reference its own workflow'))).toBe(true)
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
    agent: chef
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
    agent: chef
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
        steps: [{ id: 's1', type: 'agent', label: 'S', agent: 'chef' }],
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
        steps: [{ id: 's1', type: 'agent', label: 'S', agent: 'chef' }],
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
        steps: [{ id: 's1', type: 'agent', label: 'S', agent: 'chef' }],
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
