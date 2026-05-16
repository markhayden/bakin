export function workflowDefinitionNameFromHookInput(input: Record<string, unknown>): string | undefined {
  if (typeof input.name === 'string' && input.name.length > 0) return input.name
  if (typeof input.workflowId === 'string' && input.workflowId.length > 0) return input.workflowId
  return undefined
}
