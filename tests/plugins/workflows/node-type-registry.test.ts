import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

// Defensive mocks per CLAUDE.md test isolation rules — this test is pure logic,
// but we mock the storage modules so a future change to the registry can't
// silently start touching ~/.bakin/ or ~/.openclaw/.
const testDir = join(tmpdir(), `bakin-test-node-type-registry-${Date.now()}`)
vi.mock('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
vi.mock('@bakin/tasks/lib/flow-store', () => ({}))
vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

import {
  getNodeType,
  listNodeTypes,
  registerNodeType,
  workflowDefinitionSchema,
  agentStepSchema,
  gateStepSchema,
  parallelStepSchema,
  outputStepSchema,
  nestedWorkflowStepSchema,
  type NodeTypeDef,
} from '@bakin/workflows/lib/node-type-registry'
import { z } from 'zod'

describe('node-type-registry', () => {
  describe('builtin registration', () => {
    it('registers all 5 builtin node types at module load', () => {
      const kinds = listNodeTypes().map(n => n.kind).sort()
      expect(kinds).toEqual(['agent', 'gate', 'output', 'parallel', 'workflow'])
    })

    it('exposes each builtin via getNodeType()', () => {
      for (const kind of ['agent', 'gate', 'output', 'parallel', 'workflow']) {
        const def = getNodeType(kind)
        expect(def, `expected ${kind} to be registered`).toBeDefined()
        expect(def!.kind).toBe(kind)
        expect(def!.runtime).toBe('builtin')
        expect(def!.zodSchema).toBeDefined()
      }
    })

    it('returns undefined for unknown node type', () => {
      expect(getNodeType('does-not-exist')).toBeUndefined()
    })
  })

  describe('agentStepSchema', () => {
    it('accepts a minimal valid agent step', () => {
      const result = agentStepSchema.safeParse({
        id: 'step1',
        type: 'agent',
        label: 'Step 1',
        agent: 'chef',
      })
      expect(result.success).toBe(true)
    })

    it('rejects an agent step missing the agent field', () => {
      const result = agentStepSchema.safeParse({
        id: 'step1',
        type: 'agent',
        label: 'Step 1',
      })
      expect(result.success).toBe(false)
    })

    it('rejects an agent step missing id or label', () => {
      expect(agentStepSchema.safeParse({ type: 'agent', label: 'x', agent: 'a' }).success).toBe(false)
      expect(agentStepSchema.safeParse({ type: 'agent', id: 'x', agent: 'a' }).success).toBe(false)
    })

    it('accepts optional fields (skill, task, dependsOn, outputs, deny_tools)', () => {
      const result = agentStepSchema.safeParse({
        id: 'step1',
        type: 'agent',
        label: 'Step 1',
        agent: 'chef',
        skill: 'write-script',
        task: 'do the thing',
        dependsOn: ['otherStep'],
        outputs: [{ id: 'script', type: 'string' }],
        deny_tools: ['post_discord'],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('gateStepSchema', () => {
    it('accepts a minimal valid gate step', () => {
      const result = gateStepSchema.safeParse({
        id: 'gate1',
        type: 'gate',
        label: 'Approve',
        on_approve: 'next',
      })
      expect(result.success).toBe(true)
    })

    it('rejects a gate step missing on_approve', () => {
      const result = gateStepSchema.safeParse({
        id: 'gate1',
        type: 'gate',
        label: 'Approve',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('parallelStepSchema', () => {
    it('accepts a parallel step with nested agent + gate children', () => {
      const result = parallelStepSchema.safeParse({
        id: 'p1',
        type: 'parallel',
        label: 'Parallel',
        steps: [
          { id: 'c1', type: 'agent', label: 'Child 1', agent: 'chef' },
          { id: 'c2', type: 'gate', label: 'Child gate', on_approve: 'done' },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('rejects a parallel step with no children', () => {
      const result = parallelStepSchema.safeParse({
        id: 'p1',
        type: 'parallel',
        label: 'Parallel',
        steps: [],
      })
      expect(result.success).toBe(false)
    })
  })

  describe('outputStepSchema', () => {
    it('accepts an output step with channels and content', () => {
      const result = outputStepSchema.safeParse({
        id: 'out',
        type: 'output',
        label: 'Publish',
        channels: ['discord'],
        content: { message: 'hi' },
      })
      expect(result.success).toBe(true)
    })
  })

  describe('nestedWorkflowStepSchema', () => {
    it('accepts a nested workflow step', () => {
      const result = nestedWorkflowStepSchema.safeParse({
        id: 'nested',
        type: 'workflow',
        label: 'Run other',
        workflow_id: 'video-script',
      })
      expect(result.success).toBe(true)
    })

    it('rejects a nested workflow step missing workflow_id', () => {
      const result = nestedWorkflowStepSchema.safeParse({
        id: 'nested',
        type: 'workflow',
        label: 'Run other',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('workflowDefinitionSchema (discriminated union per step)', () => {
    it('accepts a valid multi-step definition', () => {
      const result = workflowDefinitionSchema.safeParse({
        name: 'Video Script',
        description: 'Develop a full script',
        version: 1,
        steps: [
          { id: 'write', type: 'agent', label: 'Write', agent: 'chef', skill: 'write-script' },
          { id: 'gate', type: 'gate', label: 'Approve', on_approve: 'done' },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('rejects a definition with an unknown step type', () => {
      const result = workflowDefinitionSchema.safeParse({
        name: 'Bad',
        description: 'x',
        version: 1,
        steps: [{ id: 's', type: 'mystery', label: 'huh' }],
      })
      expect(result.success).toBe(false)
    })

    it('rejects a definition with no steps', () => {
      const result = workflowDefinitionSchema.safeParse({
        name: 'Empty',
        description: 'x',
        version: 1,
        steps: [],
      })
      expect(result.success).toBe(false)
    })

    it('rejects a definition missing required top-level fields', () => {
      expect(
        workflowDefinitionSchema.safeParse({ description: 'x', version: 1, steps: [] }).success
      ).toBe(false)
    })

    it('drives validation through the registry — agent step missing agent is caught at the union level', () => {
      const result = workflowDefinitionSchema.safeParse({
        name: 'X',
        description: 'x',
        version: 1,
        steps: [{ id: 'bad', type: 'agent', label: 'Bad' }],
      })
      expect(result.success).toBe(false)
    })
  })

  describe('registerNodeType (forward-compat hook for plugin-defined node types)', () => {
    it('lets a caller register a new node type and resolve it via getNodeType', () => {
      const customSchema = z.object({
        id: z.string(),
        type: z.literal('custom-test-node'),
        label: z.string(),
        knob: z.number(),
      })
      const def: NodeTypeDef = {
        kind: 'custom-test-node',
        runtime: 'builtin',
        zodSchema: customSchema,
        formFields: [{ name: 'knob', type: 'number', required: true }],
      }
      registerNodeType(def)
      expect(getNodeType('custom-test-node')).toBe(def)
    })

    it('throws on duplicate registration of the same kind', () => {
      const schema = z.object({ id: z.string(), type: z.literal('dup-test'), label: z.string() })
      registerNodeType({ kind: 'dup-test', runtime: 'builtin', zodSchema: schema, formFields: [] })
      expect(() =>
        registerNodeType({ kind: 'dup-test', runtime: 'builtin', zodSchema: schema, formFields: [] })
      ).toThrow(/already registered/)
    })
  })
})
