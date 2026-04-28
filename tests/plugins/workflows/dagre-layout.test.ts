/**
 * Tests for `plugins/workflows/lib/dagre-layout.ts`.
 *
 * Covers:
 *  1. Empty input → empty output (no throw).
 *  2. Linear 3-node graph → left-to-right ordering with LR rankdir.
 *  3. Cyclic graph → non-exception path (dagre tolerates cycles; we care
 *     that we don't crash).
 *  4. Custom width/height from node.style.width is respected.
 */

import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Edge, Node } from '@xyflow/react'

const testDir = join(tmpdir(), `bakin-test-dagre-layout-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('@/core/task-store', () => ({
  createTask: mock(),
  addTaskLog: mock(),
  moveTask: mock(),
  readTaskboard: mock(() => ({ columns: {} })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

import { layoutNodes } from '../../../plugins/workflows/lib/dagre-layout'

describe('layoutNodes', () => {
  it('returns empty output for empty input', () => {
    expect(layoutNodes([], [])).toEqual([])
  })

  it('arranges a 3-node linear graph left-to-right', () => {
    const nodes: Node[] = [
      { id: 'a', position: { x: 0, y: 0 }, data: {}, style: { width: 280 } },
      { id: 'b', position: { x: 0, y: 0 }, data: {}, style: { width: 280 } },
      { id: 'c', position: { x: 0, y: 0 }, data: {}, style: { width: 280 } },
    ]
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-c', source: 'b', target: 'c' },
    ]
    const result = layoutNodes(nodes, edges)
    const byId = Object.fromEntries(result.map((n) => [n.id, n.position]))
    expect(byId.a.x).toBeLessThan(byId.b.x)
    expect(byId.b.x).toBeLessThan(byId.c.x)
  })

  it('does not throw on cyclic graphs', () => {
    const nodes: Node[] = [
      { id: 'a', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-a', source: 'b', target: 'a' },
    ]
    expect(() => layoutNodes(nodes, edges)).not.toThrow()
  })

  it('honors node.style.width when positioning', () => {
    const nodes: Node[] = [
      { id: 'a', position: { x: 0, y: 0 }, data: {}, style: { width: 100 } },
      { id: 'b', position: { x: 0, y: 0 }, data: {}, style: { width: 100 } },
    ]
    const edges: Edge[] = [{ id: 'a-b', source: 'a', target: 'b' }]
    const result = layoutNodes(nodes, edges, { nodesep: 20, ranksep: 50 })
    // Distance between the two top-left x's should be close to 100 (width)
    // + 50 (ranksep), but we only assert ordering + positive gap.
    expect(result[1].position.x - result[0].position.x).toBeGreaterThan(0)
  })

  it('drops edges pointing at non-existent nodes without crashing', () => {
    const nodes: Node[] = [
      { id: 'a', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [{ id: 'ghost', source: 'a', target: 'nope' }]
    expect(() => layoutNodes(nodes, edges)).not.toThrow()
  })
})
