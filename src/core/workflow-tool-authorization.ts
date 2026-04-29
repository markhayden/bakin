import { getHookRegistry } from '../lib/plugin-registry'

export type WorkflowToolUseAction = 'progress-log' | 'task-complete' | 'task-block' | 'channel-post'

interface WorkflowToolUseInput {
  taskId?: string
  agent: string
  action: WorkflowToolUseAction
}

interface WorkflowToolUseResult {
  allowed?: boolean
  reason?: string
}

export async function assertWorkflowToolAllowed(input: WorkflowToolUseInput): Promise<void> {
  if (!input.taskId) return

  const registry = getHookRegistry()
  if (!registry.has('workflows.authorizeToolUse')) return

  const result = await registry.invoke<WorkflowToolUseResult>('workflows.authorizeToolUse', input)
  if (result?.allowed === false) {
    throw new Error(result.reason || `Workflow denied ${input.action} for task "${input.taskId}"`)
  }
}
