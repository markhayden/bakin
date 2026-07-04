/**
 * Edge connection rule enforcement for the canvas editor.
 *
 * Each NodeTypeDef carries optional `edgeRules` with `maxInbound` /
 * `maxOutbound`. The canvas editor's `isValidConnection` hook calls
 * `canConnect()` on every pending connection — rejections surface as a
 * toast and xyflow refuses to draw the edge.
 *
 * Plugin-registered kinds default to agent-style rules (`maxOutbound: 1`)
 * unless the plugin supplies its own; unregistered kinds are permissive
 * so legacy / pre-activation definitions don't break the editor.
 */

import type { EdgeRules } from '@bakin/core/workflows/node-type-registry'
import { getNodeType } from '@bakin/core/workflows/node-type-registry'

export interface EdgeLike {
  source: string
  target: string
}

export interface CanConnectResult {
  ok: boolean
  reason?: string
}

const DEFAULT_PLUGIN_RULES: EdgeRules = { maxOutbound: 1 }

function rulesFor(kind: string): EdgeRules {
  const def = getNodeType(kind)
  if (!def) return {}
  return def.edgeRules ?? (def.runtime === 'plugin' ? DEFAULT_PLUGIN_RULES : {})
}

/**
 * Resolve the node kind for a given node id by consulting a lookup map.
 * The canvas editor supplies this as `(id) => state.steps[id]?.type`.
 */
export type KindResolver = (nodeId: string) => string | undefined

/**
 * Decide whether an edge from `source` to `target` is allowed given the
 * current edge set. Callers pass a `kindResolver` so the helper stays
 * decoupled from the canvas editor's state shape.
 */
export function canConnect(
  sourceId: string,
  targetId: string,
  currentEdges: EdgeLike[],
  kindResolver: KindResolver,
): CanConnectResult {
  if (sourceId === targetId) {
    return { ok: false, reason: 'A node cannot connect to itself.' }
  }

  const sourceKind = kindResolver(sourceId)
  const targetKind = kindResolver(targetId)
  if (!sourceKind || !targetKind) return { ok: true }

  const sourceRules = rulesFor(sourceKind)
  const targetRules = rulesFor(targetKind)

  if (sourceRules.maxOutbound === 0) {
    return { ok: false, reason: `${sourceKind} nodes cannot have outbound edges.` }
  }
  if (targetRules.maxInbound === 0) {
    return { ok: false, reason: `${targetKind} nodes cannot have inbound edges.` }
  }

  if (typeof sourceRules.maxOutbound === 'number') {
    const outbound = currentEdges.filter((e) => e.source === sourceId).length
    if (outbound >= sourceRules.maxOutbound) {
      return {
        ok: false,
        reason: `${sourceKind} can have only ${sourceRules.maxOutbound} outbound edge(s).`,
      }
    }
  }
  if (typeof targetRules.maxInbound === 'number') {
    const inbound = currentEdges.filter((e) => e.target === targetId).length
    if (inbound >= targetRules.maxInbound) {
      return {
        ok: false,
        reason: `${targetKind} can have only ${targetRules.maxInbound} inbound edge(s).`,
      }
    }
  }

  return { ok: true }
}
