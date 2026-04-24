import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import type { NodeProps } from '@xyflow/react'
import type { ComponentType } from 'react'

// This registry is a pure in-memory map and never touches the filesystem,
// but the project's test-isolation rule requires every test to mock
// content-dir (and not pull in real flow-store) as a safety net.
const testDir = join(tmpdir(), `bakin-test-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

mock.module('../../../plugins/tasks/lib/flow-store', () => ({
  getTask: mock(),
  createTask: mock(),
  moveTask: mock(),
  addTaskLog: mock(),
  readTaskboard: mock(() => ({ columns: { todo: [], inProgress: [], review: [], done: [], blocked: [] } })),
}))

import {
  registerNodeRenderer,
  unregisterNodeRenderer,
  getNodeRenderer,
  getAllNodeRenderers,
  listNodeRendererKinds,
} from '../../../plugins/workflows/lib/node-renderer-registry'

/**
 * Stubs — we're not rendering, we just need distinguishable component
 * references so the registry's identity checks pass.
 */
const StubA: ComponentType<NodeProps> = () => null
const StubB: ComponentType<NodeProps> = () => null

describe('node-renderer-registry', () => {
  afterEach(() => {
    // Clear anything our tests added so they don't leak into each other or
    // into unrelated suites that happen to import builtin renderer wiring.
    for (const kind of listNodeRendererKinds()) {
      if (kind.startsWith('test.')) unregisterNodeRenderer(kind)
    }
  })

  it('returns undefined for unknown kinds', () => {
    expect(getNodeRenderer('test.never-registered')).toBeUndefined()
  })

  it('registers and retrieves a renderer', () => {
    registerNodeRenderer('test.alpha', StubA)
    expect(getNodeRenderer('test.alpha')).toBe(StubA)
  })

  it('replaces the existing renderer on re-register (newest wins)', () => {
    registerNodeRenderer('test.beta', StubA)
    registerNodeRenderer('test.beta', StubB)
    expect(getNodeRenderer('test.beta')).toBe(StubB)
  })

  it('unregisters a renderer', () => {
    registerNodeRenderer('test.gamma', StubA)
    unregisterNodeRenderer('test.gamma')
    expect(getNodeRenderer('test.gamma')).toBeUndefined()
  })

  it('getAllNodeRenderers produces a NodeTypes-compatible map', () => {
    registerNodeRenderer('test.delta', StubA)
    const all = getAllNodeRenderers()
    expect(all['test.delta']).toBe(StubA)
  })

  it('listNodeRendererKinds returns registered kinds', () => {
    registerNodeRenderer('test.epsilon', StubA)
    expect(listNodeRendererKinds()).toContain('test.epsilon')
  })
})
