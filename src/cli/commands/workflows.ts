/**
 * `bakin workflows {list,start,step,submit}` — workflow definitions and
 * instance stepping. Relocated verbatim from cli/bakin.ts (B5.3
 * command-module split).
 */
import { apiGet, apiPost, getCliAgent } from '../http'
import { print, printTable } from '../output'
import { exitCommandIssue, exitUsage, exitUnknownSubcommand } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { WorkflowActionData } from '../../core/cli/ui/readonly'

async function printWorkflowsListTui(templates: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.WorkflowsListReport, { templates })
}

async function printWorkflowActionTui(action: WorkflowActionData): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.WorkflowActionReport, { action })
}

async function cmdWorkflowsList(): Promise<void> {
  const result = await apiGet('/api/plugins/workflows/definitions') as { templates?: Array<Record<string, unknown>> }
  const templates = result?.templates || []
  if (process.stdout.isTTY) {
    await printWorkflowsListTui(templates)
    return
  }
  if (templates.length === 0) {
    console.log('No workflow definitions found.')
    return
  }
  printTable(templates, ['filename', 'name', 'description', 'stepCount'])
}

async function cmdWorkflowsStart(taskId: string, workflowId: string): Promise<void> {
  const result = await apiPost('/api/plugins/workflows/instances/start', { taskId, workflowId })
  if (process.stdout.isTTY) {
    await printWorkflowActionTui({
      action: 'started',
      taskId,
      workflowId,
      result,
    })
    return
  }
  print(result)
}

async function cmdWorkflowsStep(taskId: string): Promise<void> {
  const result = await apiGet(`/api/plugins/workflows/steps/${encodeURIComponent(taskId)}`)
  if (process.stdout.isTTY) {
    await printWorkflowActionTui({
      action: 'step',
      taskId,
      result,
    })
    return
  }
  print(result)
}

async function cmdWorkflowsSubmit(taskId: string, stepId: string, outputJson: string): Promise<void> {
  let output: Record<string, unknown>
  try {
    output = JSON.parse(outputJson)
  } catch {
    const usage = 'bakin workflows submit <taskId> <stepId> \'{"key":"value"}\''
    if (process.stdout.isTTY) {
      await exitCommandIssue('Invalid JSON for output.', {
        command: 'bakin workflows submit',
        detail: 'Output must parse as a JSON object.',
        usage,
      })
    }
    console.error(`Invalid JSON for output. Usage: ${usage}`)
    process.exit(1)
  }
  const result = await apiPost(`/api/plugins/workflows/steps/${encodeURIComponent(taskId)}/complete`, { stepId, agentId: await getCliAgent(), output })
  if (process.stdout.isTTY) {
    await printWorkflowActionTui({
      action: 'submitted',
      taskId,
      stepId,
      result,
    })
    return
  }
  print(result)
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (sub === 'list') {
    await cmdWorkflowsList()
  } else if (sub === 'start') {
    if (!args[2] || !args[3]) await exitUsage('bakin workflows start <taskId> <workflowId>')
    await cmdWorkflowsStart(args[2], args[3])
  } else if (sub === 'step') {
    if (!args[2]) await exitUsage('bakin workflows step <taskId>')
    await cmdWorkflowsStep(args[2])
  } else if (sub === 'submit') {
    if (!args[2] || !args[3] || !args[4]) await exitUsage('bakin workflows submit <taskId> <stepId> \'<json>\'')
    await cmdWorkflowsSubmit(args[2], args[3], args[4])
  } else {
    await exitUnknownSubcommand('workflows', sub, ['list', 'start', 'step', 'submit'])
  }
}
