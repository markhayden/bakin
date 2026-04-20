/**
 * Client-side node-renderer registry.
 *
 * Each workflow node kind (built-in or plugin-registered) is paired with a
 * React component that renders it on the xyflow canvas. The server-side
 * `node-type-registry` is the source of truth for *schema* (zod + form
 * fields + edge rules); this file is the source of truth for *visual
 * rendering* on the editor canvas.
 *
 * Kinds are globally unique — built-ins use their bare name (`agent`,
 * `gate`, `parallel`, `output`, `workflow`, `trigger`, `subflowGroup`) and
 * plugin-owned kinds arrive pre-namespaced as `{pluginId}.{kind}`.
 *
 * This module is client-only (imports xyflow types) so it's safe to ship
 * through `'use client'` renderers and plugin manifests that are statically
 * imported by `src/lib/plugin-manifest.ts`. Registration is idempotent —
 * re-registering the same kind replaces the renderer (newest wins), which
 * is what you want for hot-reload.
 */
import type { NodeProps, NodeTypes } from '@xyflow/react'
import type { ComponentType } from 'react'

/** A renderer is just a React component that xyflow will pass NodeProps into. */
export type NodeRenderer = ComponentType<NodeProps>

const registry = new Map<string, NodeRenderer>()

/** Register a renderer for a node kind. Newest wins on re-registration. */
export function registerNodeRenderer(kind: string, component: NodeRenderer): void {
  registry.set(kind, component)
}

/** Remove a renderer. Used at plugin teardown (hot reload). */
export function unregisterNodeRenderer(kind: string): void {
  registry.delete(kind)
}

/** Look up a renderer by kind. */
export function getNodeRenderer(kind: string): NodeRenderer | undefined {
  return registry.get(kind)
}

/** Return the full kind→component map in the shape xyflow's nodeTypes prop expects. */
export function getAllNodeRenderers(): NodeTypes {
  const result: NodeTypes = {}
  for (const [kind, component] of registry.entries()) {
    result[kind] = component
  }
  return result
}

/** List registered kinds — used by the palette to enumerate available node types. */
export function listNodeRendererKinds(): string[] {
  return [...registry.keys()]
}
