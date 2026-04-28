import { describe, it, expect, afterEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Defensive mocks per CLAUDE.md test isolation rules — this test is pure logic,
// but we mock the storage modules so a future change to the registry can't
// silently start touching ~/.bakin/ or ~/.openclaw/.
const testDir = join(tmpdir(), `bakin-test-node-type-registry-${Date.now()}`)
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

import {
  getNodeType,
  listNodeTypes,
  registerNodeType,
  registerPluginNodeType,
  unregisterNodeType,
  unregisterPluginNodeTypes,
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
        agent: 'basil',
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
        agent: 'basil',
        skill: 'write-script',
        task: 'do the thing',
        dependsOn: ['otherStep'],
        outputs: [{ id: 'script', type: 'string' }],
        deny_tools: ['post_channel'],
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
          { id: 'c1', type: 'agent', label: 'Child 1', agent: 'basil' },
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
          { id: 'write', type: 'agent', label: 'Write', agent: 'basil', skill: 'write-script' },
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

  describe('edgeRules (builtin defaults)', () => {
    it('sets maxOutbound=1 for agent/gate/parallel/workflow kinds', () => {
      for (const kind of ['agent', 'gate', 'parallel', 'workflow']) {
        expect(getNodeType(kind)?.edgeRules?.maxOutbound, `${kind}`).toBe(1)
      }
    })

    it('sets maxOutbound=0 for output (terminal node)', () => {
      expect(getNodeType('output')?.edgeRules?.maxOutbound).toBe(0)
    })
  })

  describe('registerPluginNodeType (Phase 2A)', () => {
    const PID = 'test-plugin-a'

    afterEach(() => {
      unregisterPluginNodeTypes(PID)
      unregisterPluginNodeTypes('test-plugin-b')
    })

    it('namespaces the kind as `{pluginId}.{kind}`', () => {
      const schema = z.object({ id: z.string(), type: z.literal(`${PID}.note-step`), label: z.string() })
      const namespaced = registerPluginNodeType(PID, {
        kind: 'note-step',
        zodSchema: schema,
        formFields: [],
      })
      expect(namespaced).toBe(`${PID}.note-step`)
      const def = getNodeType(`${PID}.note-step`)
      expect(def).toBeDefined()
      expect(def!.runtime).toBe('plugin')
      expect(def!.pluginId).toBe(PID)
    })

    it('defaults edgeRules to agent-style when not supplied', () => {
      const schema = z.object({ id: z.string(), type: z.literal(`${PID}.bare`), label: z.string() })
      registerPluginNodeType(PID, { kind: 'bare', zodSchema: schema, formFields: [] })
      expect(getNodeType(`${PID}.bare`)?.edgeRules).toEqual({ maxOutbound: 1 })
    })

    it('honors explicit edgeRules when supplied', () => {
      const schema = z.object({ id: z.string(), type: z.literal(`${PID}.fanout`), label: z.string() })
      registerPluginNodeType(PID, {
        kind: 'fanout',
        zodSchema: schema,
        formFields: [],
        edgeRules: { maxOutbound: 5, maxInbound: 2 },
      })
      expect(getNodeType(`${PID}.fanout`)?.edgeRules).toEqual({ maxOutbound: 5, maxInbound: 2 })
    })

    it('throws when the same plugin registers the same kind twice', () => {
      const schema = z.object({ id: z.string(), type: z.literal(`${PID}.dup`), label: z.string() })
      registerPluginNodeType(PID, { kind: 'dup', zodSchema: schema, formFields: [] })
      expect(() =>
        registerPluginNodeType(PID, { kind: 'dup', zodSchema: schema, formFields: [] }),
      ).toThrow(/already registered/)
    })

    it('allows two different plugins to ship the same unprefixed kind', () => {
      const schemaA = z.object({ id: z.string(), type: z.literal(`${PID}.same`), label: z.string() })
      const schemaB = z.object({ id: z.string(), type: z.literal('test-plugin-b.same'), label: z.string() })
      registerPluginNodeType(PID, { kind: 'same', zodSchema: schemaA, formFields: [] })
      registerPluginNodeType('test-plugin-b', { kind: 'same', zodSchema: schemaB, formFields: [] })
      expect(getNodeType(`${PID}.same`)?.pluginId).toBe(PID)
      expect(getNodeType('test-plugin-b.same')?.pluginId).toBe('test-plugin-b')
    })

    it('unregisterPluginNodeTypes removes every kind owned by a plugin', () => {
      const schemaA = z.object({ id: z.string(), type: z.literal(`${PID}.a`), label: z.string() })
      const schemaB = z.object({ id: z.string(), type: z.literal(`${PID}.b`), label: z.string() })
      registerPluginNodeType(PID, { kind: 'a', zodSchema: schemaA, formFields: [] })
      registerPluginNodeType(PID, { kind: 'b', zodSchema: schemaB, formFields: [] })
      unregisterPluginNodeTypes(PID)
      expect(getNodeType(`${PID}.a`)).toBeUndefined()
      expect(getNodeType(`${PID}.b`)).toBeUndefined()
    })

    it('unregisterNodeType removes a specific kind', () => {
      const schema = z.object({ id: z.string(), type: z.literal(`${PID}.one`), label: z.string() })
      registerPluginNodeType(PID, { kind: 'one', zodSchema: schema, formFields: [] })
      unregisterNodeType(`${PID}.one`)
      expect(getNodeType(`${PID}.one`)).toBeUndefined()
    })
  })

  describe('workflowDefinitionSchema — plugin kinds pass through', () => {
    const PID = 'test-plugin-schema'

    afterEach(() => {
      unregisterPluginNodeTypes(PID)
    })

    it('accepts a workflow with a plugin-registered step kind that matches its schema', () => {
      const schema = z.object({
        id: z.string(),
        type: z.literal(`${PID}.note-step`),
        label: z.string(),
        noteBody: z.string(),
      })
      registerPluginNodeType(PID, {
        kind: 'note-step',
        zodSchema: schema,
        formFields: [{ name: 'noteBody', type: 'text', required: true }],
      })

      const result = workflowDefinitionSchema.safeParse({
        name: 'With Plugin Step',
        description: 'x',
        version: 1,
        steps: [
          { id: 'n1', type: `${PID}.note-step`, label: 'Note', noteBody: 'hello' },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('rejects a plugin-registered step with invalid data per its schema', () => {
      const schema = z.object({
        id: z.string(),
        type: z.literal(`${PID}.note-step`),
        label: z.string(),
        noteBody: z.string().min(1),
      })
      registerPluginNodeType(PID, {
        kind: 'note-step',
        zodSchema: schema,
        formFields: [{ name: 'noteBody', type: 'text', required: true }],
      })

      const result = workflowDefinitionSchema.safeParse({
        name: 'Bad Plugin Step',
        description: 'x',
        version: 1,
        steps: [{ id: 'n1', type: `${PID}.note-step`, label: 'Note', noteBody: '' }],
      })
      expect(result.success).toBe(false)
    })

    it('rejects a step with an unknown (non-registered) type with a helpful message', () => {
      const result = workflowDefinitionSchema.safeParse({
        name: 'Unknown Kind',
        description: 'x',
        version: 1,
        steps: [{ id: 's', type: 'nonexistent-plugin.mystery', label: 'huh' }],
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map(i => i.message).join(' ')
        expect(messages).toMatch(/Unknown node type/)
      }
    })
  })

  describe('workflowDefinitionSchema — optional layout.positions', () => {
    it('accepts a definition without layout', () => {
      const result = workflowDefinitionSchema.safeParse({
        name: 'No Layout',
        description: 'x',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'S', agent: 'basil' }],
      })
      expect(result.success).toBe(true)
    })

    it('accepts a definition with layout.positions', () => {
      const result = workflowDefinitionSchema.safeParse({
        name: 'With Layout',
        description: 'x',
        version: 1,
        steps: [
          { id: 's1', type: 'agent', label: 'S1', agent: 'basil' },
          { id: 's2', type: 'agent', label: 'S2', agent: 'pixel' },
        ],
        layout: {
          positions: {
            s1: { x: 0, y: 0 },
            s2: { x: 0, y: 150 },
          },
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.layout?.positions?.s1).toEqual({ x: 0, y: 0 })
      }
    })

    it('accepts an empty layout object', () => {
      const result = workflowDefinitionSchema.safeParse({
        name: 'Empty Layout',
        description: 'x',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'S', agent: 'basil' }],
        layout: {},
      })
      expect(result.success).toBe(true)
    })

    it('rejects non-numeric coordinates', () => {
      const result = workflowDefinitionSchema.safeParse({
        name: 'Bad Layout',
        description: 'x',
        version: 1,
        steps: [{ id: 's1', type: 'agent', label: 'S', agent: 'basil' }],
        layout: {
          positions: { s1: { x: 'nope', y: 0 } },
        },
      })
      expect(result.success).toBe(false)
    })
  })
})
