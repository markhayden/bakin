/**
 * `bakin tasks {list,get,create,move,log,block,depend,complete}` — task-store
 * commands. Relocated verbatim from cli/bakin.ts (B5.3 command-module split).
 */
import { apiGet, apiPost, getCliAgent } from '../http'
import { print, printTable } from '../output'
import { exitCommandIssue, exitUsage, exitUnknownSubcommand, exitCommandFailure } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { TaskActionData } from '../../core/cli/ui/readonly'

async function printTasksListTui(columns: Record<string, Array<Record<string, unknown>>>, column?: string): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.TasksListReport, { columns, column })
}

async function printTaskActionTui(action: TaskActionData): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.TaskActionReport, { action })
}

async function printTaskDetailTui(taskId: string, column: string, task: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.TaskDetailReport, { taskId, column, task })
}

async function cmdTasksList(column?: string): Promise<void> {
  // Read tasks from the API
  const result = await apiGet('/api/plugins/tasks/') as { columns: Record<string, Array<Record<string, unknown>>> }
  const columns = result.columns || {}

  if (column) {
    const col = columns[column]
    if (!col) {
      if (process.stdout.isTTY) {
        await exitCommandIssue(`Unknown tasks column: ${column}`, {
          command: 'bakin tasks list',
          detail: Object.keys(columns).length > 0
            ? `Available columns: ${Object.keys(columns).join(', ')}`
            : 'No task columns were returned by the server.',
          usage: 'bakin tasks list [--column=<column>]',
          available: Object.keys(columns),
          availableLabel: 'columns',
        })
      }
      console.error(`Unknown column: ${column}. Available: ${Object.keys(columns).join(', ')}`)
      process.exit(1)
    }
    if (process.stdout.isTTY) {
      await printTasksListTui({ [column]: col as Array<Record<string, unknown>> }, column)
      return
    }
    printTable(col as Record<string, unknown>[], ['id', 'title', 'agent'])
  } else {
    if (process.stdout.isTTY) {
      await printTasksListTui(columns as Record<string, Array<Record<string, unknown>>>)
      return
    }
    for (const [name, tasks] of Object.entries(columns)) {
      if ((tasks as unknown[]).length === 0) continue
      console.log(`\n=== ${name} ===`)
      printTable(tasks as Record<string, unknown>[], ['id', 'title', 'agent'])
    }
  }
}

async function cmdTasksCreate(title: string, assignee?: string, workflowId?: string, skipWorkflowReason?: string): Promise<void> {
  const body: Record<string, string> = { title }
  if (assignee) body.assignee = assignee
  if (workflowId) body.workflowId = workflowId
  if (skipWorkflowReason) body.skipWorkflowReason = skipWorkflowReason
  const result = await apiPost('/api/plugins/tasks/', body) as { ok?: boolean; id?: string; workflowId?: string; suggestedWorkflow?: string; error?: string }

  if (result.error) {
    await exitCommandFailure(result.error, {
      command: 'bakin tasks create',
      code: 'TASK_CREATE_FAILED',
    })
  }

  const suggestedWorkflow = result.suggestedWorkflow && !workflowId && !skipWorkflowReason
    ? result.suggestedWorkflow
    : undefined

  if (process.stdout.isTTY) {
    await printTaskActionTui({
      action: 'created',
      taskId: result.id,
      title,
      agent: assignee,
      workflowId: result.workflowId ?? workflowId,
      suggestedWorkflow,
    })
    return
  }

  // Warn if a workflow was suggested but not used and no reason given
  if (suggestedWorkflow) {
    console.warn(`\n⚠  Workflow "${result.suggestedWorkflow}" matches this task but was not started.`)
    console.warn(`   Re-run with --workflow=${result.suggestedWorkflow} to use it,`)
    console.warn(`   or --no-workflow="<reason>" to skip with an audit trail.\n`)
  }

  print(result)
}

async function cmdTasksMove(id: string, to: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/move`, { id, to, agent: await getCliAgent() })
  if (process.stdout.isTTY) {
    await printTaskActionTui({
      action: 'moved',
      taskId: id,
      column: to,
    })
    return
  }
  print(result)
}

async function cmdTasksLog(id: string, message: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/log`, { id, author: await getCliAgent(), message })
  if (process.stdout.isTTY) {
    await printTaskActionTui({
      action: 'logged',
      taskId: id,
      detail: message,
    })
    return
  }
  print(result)
}

async function cmdTasksBlock(id: string, reason: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/block`, { id, reason, agent: await getCliAgent() })
  if (process.stdout.isTTY) {
    await printTaskActionTui({
      action: 'blocked',
      taskId: id,
      detail: reason,
    })
    return
  }
  print(result)
}

async function cmdTasksDepend(id: string, dependsOn: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/dependency`, { id, dependsOn })
  if (process.stdout.isTTY) {
    await printTaskActionTui({
      action: 'dependency',
      taskId: id,
      detail: `depends on ${dependsOn}`,
    })
    return
  }
  print(result)
}

async function cmdTasksComplete(id: string, summary: string): Promise<void> {
  const agent = await getCliAgent()
  // Log the summary, then move to done
  await apiPost(`/api/plugins/tasks/${id}/log`, { id, author: agent, message: `Task complete: ${summary}` })
  const result = await apiPost(`/api/plugins/tasks/${id}/move`, { id, to: 'done', agent })
  if (process.stdout.isTTY) {
    await printTaskActionTui({
      action: 'completed',
      taskId: id,
      column: 'done',
      detail: summary,
    })
    return
  }
  print(result)
}

async function cmdTasksGet(id: string, opts: { json?: boolean } = {}): Promise<void> {
  const result = await apiGet('/api/plugins/tasks/') as { columns: Record<string, Array<Record<string, unknown>>> }
  const columns = result.columns || {}
  for (const [colName, tasks] of Object.entries(columns)) {
    const task = (tasks as Array<Record<string, unknown>>).find(t => t.id === id)
    if (task) {
      if (opts.json) {
        print({ column: colName, task })
        return
      }
      if (process.stdout.isTTY) {
        await printTaskDetailTui(id, colName, task)
        return
      }
      console.log(`Column: ${colName}`)
      print(task)
      return
    }
  }
  await exitCommandFailure(`Task ${id} not found`, {
    command: 'bakin tasks get',
    code: 'TASK_NOT_FOUND',
    next: 'Run `bakin tasks list` to inspect current task IDs.',
    plainLines: [`Task ${id} not found`],
  })
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (sub === 'list') {
    const colFlag = args.find(a => a.startsWith('--column='))
    await cmdTasksList(colFlag?.split('=')[1])
  } else if (sub === 'get') {
    if (!args[2]) await exitUsage('bakin tasks get <id>')
    await cmdTasksGet(args[2], { json: args.includes('--json') })
  } else if (sub === 'create') {
    if (!args[2]) await exitUsage('bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow="<reason>"]')
    // Parse flags from remaining args
    const createArgs = args.slice(2)
    const wfFlag = createArgs.find(a => a.startsWith('--workflow='))
    const noWfFlag = createArgs.find(a => a.startsWith('--no-workflow='))
    const positional = createArgs.filter(a => !a.startsWith('--'))
    const createTitle = positional[0]
    const createAssignee = positional[1]
    const createWorkflowId = wfFlag?.split('=').slice(1).join('=')
    const createSkipReason = noWfFlag?.split('=').slice(1).join('=')
    if (!createTitle) await exitUsage('bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow="<reason>"]')
    await cmdTasksCreate(createTitle, createAssignee, createWorkflowId, createSkipReason)
  } else if (sub === 'move') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks move <id> <column>')
    await cmdTasksMove(args[2], args[3])
  } else if (sub === 'log') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks log <id> <message>')
    await cmdTasksLog(args[2], args.slice(3).join(' '))
  } else if (sub === 'block') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks block <id> <reason>')
    await cmdTasksBlock(args[2], args.slice(3).join(' '))
  } else if (sub === 'depend') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks depend <id> <dependsOn>')
    await cmdTasksDepend(args[2], args[3])
  } else if (sub === 'complete') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks complete <id> <summary>')
    await cmdTasksComplete(args[2], args.slice(3).join(' '))
  } else {
    await exitUnknownSubcommand('tasks', sub, ['list', 'get', 'create', 'move', 'log', 'block', 'depend', 'complete'])
  }
}
