import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseYAML, validateDefinition, loadDefinition, listDefinitions } from '@bakin/workflows/lib/parser'
import type { WorkflowDefinition } from '@bakin/workflows/types'

describe('parser', () => {
  const testDir = join(tmpdir(), `bakin-test-parser-${Date.now()}`)
  const defsDir = join(testDir, 'workflows', 'definitions')

  beforeEach(() => {
    mkdirSync(defsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
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
  })
})
