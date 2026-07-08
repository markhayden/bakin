/**
 * Exec-tool bridge: RuntimeExecToolDescriptor[] (core seam) → Pi custom
 * tools. Each Bakin tool becomes a first-class session tool; the model
 * calls bakin_exec_* directly (describeToolAccess: 'native').
 *
 * Errors: provider.invoke never throws across the seam — it returns
 * ok:false + ERROR text. Pi's tool contract signals failure by THROWING
 * from execute (the agent loop sets isError on the tool result), so the
 * bridge converts ok:false into a throw.
 */
import { defineTool } from '@earendil-works/pi-coding-agent'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

import type {
  RuntimeExecToolDescriptor,
  RuntimeExecToolProvider,
  RuntimeMessageToolPolicy,
} from '@bakin/core/adapters/runtime'

type PiToolSchema = ToolDefinition['parameters']

export function bridgeExecTools(
  provider: RuntimeExecToolProvider,
  agentId: string,
  descriptors: RuntimeExecToolDescriptor[],
): ToolDefinition[] {
  return descriptors.map((descriptor) =>
    defineTool({
      name: descriptor.name,
      label: descriptor.name,
      description: descriptor.description,
      // Descriptors carry plain JSON Schema; TypeBox schemas are JSON Schema
      // at runtime, so the cast is structural, not a lie.
      parameters: descriptor.parametersSchema as unknown as PiToolSchema,
      async execute(_toolCallId, params) {
        const result = await provider.invoke(
          descriptor.name,
          (params ?? {}) as Record<string, unknown>,
          agentId,
        )
        if (!result.ok) throw new Error(result.text)
        return { content: [{ type: 'text' as const, text: result.text }], details: undefined }
      },
    }),
  )
}

/**
 * Apply the per-turn tool policy + the agent's recorded allowlist to the
 * Bakin exec-tool set. Built-in Pi tools (read/bash/edit/…) are governed
 * separately at session build (noTools when toolsMode is 'none').
 */
export function filterExecToolDescriptors(
  descriptors: RuntimeExecToolDescriptor[],
  policy: RuntimeMessageToolPolicy,
  agentAllowlist?: string[],
): RuntimeExecToolDescriptor[] {
  if (policy.toolsMode === 'none') return []
  let out = descriptors
  if (agentAllowlist && agentAllowlist.length > 0) {
    const allowed = new Set(agentAllowlist)
    out = out.filter((d) => allowed.has(d.name))
  }
  if (policy.toolsAllow && policy.toolsAllow.length > 0) {
    const allowed = new Set(policy.toolsAllow)
    out = out.filter((d) => allowed.has(d.name))
  }
  if (policy.toolsDeny && policy.toolsDeny.length > 0) {
    const denied = new Set(policy.toolsDeny)
    out = out.filter((d) => !denied.has(d.name))
  }
  return out
}
