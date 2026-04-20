/**
 * Dagre-based auto-layout for canvas nodes.
 *
 * Used in two places:
 *   1. On load, when a definition has no `layout.positions` (empty
 *      workflow, or YAML that pre-dates the layout field) — gives the
 *      editor a sensible starting arrangement instead of stacking every
 *      node at (0, 0).
 *   2. The "Auto-arrange" toolbar button, which re-runs layout on demand
 *      after a user has shuffled things by hand.
 *
 * Pure function — takes nodes + edges, returns nodes with new positions.
 * Edges are untouched.
 */

import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'

export interface LayoutOptions {
  rankdir?: 'LR' | 'TB' | 'RL' | 'BT'
  nodesep?: number
  ranksep?: number
  /** Fallback dimensions when a node hasn't measured yet. */
  nodeWidth?: number
  nodeHeight?: number
}

const DEFAULTS = {
  rankdir: 'LR' as const,
  nodesep: 40,
  ranksep: 100,
  nodeWidth: 280,
  nodeHeight: 100,
}

/**
 * Run dagre on (nodes, edges) and return a new node array with computed
 * `position` fields. The dagre centre-of-node coordinates are converted
 * to xyflow top-left coordinates before being returned.
 */
export function layoutNodes(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {},
): Node[] {
  if (nodes.length === 0) return []

  const rankdir = options.rankdir ?? DEFAULTS.rankdir
  const nodesep = options.nodesep ?? DEFAULTS.nodesep
  const ranksep = options.ranksep ?? DEFAULTS.ranksep
  const defaultWidth = options.nodeWidth ?? DEFAULTS.nodeWidth
  const defaultHeight = options.nodeHeight ?? DEFAULTS.nodeHeight

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir, nodesep, ranksep })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    const w =
      typeof node.width === 'number'
        ? node.width
        : typeof (node.style as { width?: number } | undefined)?.width === 'number'
          ? ((node.style as { width?: number }).width as number)
          : defaultWidth
    const h = typeof node.height === 'number' ? node.height : defaultHeight
    g.setNode(node.id, { width: w, height: h })
  }
  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const dn = g.node(node.id)
    if (!dn) return node
    // dagre returns the centre; xyflow wants the top-left.
    const w =
      typeof node.width === 'number'
        ? node.width
        : typeof (node.style as { width?: number } | undefined)?.width === 'number'
          ? ((node.style as { width?: number }).width as number)
          : defaultWidth
    const h = typeof node.height === 'number' ? node.height : defaultHeight
    return {
      ...node,
      position: { x: dn.x - w / 2, y: dn.y - h / 2 },
    }
  })
}
