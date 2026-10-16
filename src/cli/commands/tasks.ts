/**
 * `bakin tasks {list,get,create,move,log,block,depend,complete}` — task-store
 * commands. Relocated verbatim from cli/bakin.ts (B5.3 command-module split).
 */
import { apiGet, apiPost } from '../http'
import { resolveCliActor, stripActorFlag, type CliActor } from '../actor'
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

async function cmdTasksCreate(actor: CliActor, title: string, assignee?: string, workflowId?: string, skipWorkflowReason?: string, team?: string): Promise<void> {
  const body: Record<string, string> = { title, createdBy: actor.agent }
  if (assignee) body.assignee = assignee
  if (team) body.team = team
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
      agent: assignee ?? (team ? `team:${team}` : undefined),
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

/** `channel: 'human'` rides along only for the operator (`--as human`). */
function actorFields(actor: CliActor): { agent: string; channel?: 'human' } {
  return { agent: actor.agent, ...(actor.channel ? { channel: actor.channel } : {}) }
}

async function cmdTasksMove(actor: CliActor, id: string, to: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/move`, { id, to, ...actorFields(actor) })
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

async function cmdTasksLog(actor: CliActor, id: string, message: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/log`, { id, author: actor.agent, message })
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

async function cmdTasksBlock(actor: CliActor, id: string, reason: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/block`, { id, reason, ...actorFields(actor) })
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

async function cmdTasksDepend(actor: CliActor, id: string, dependsOn: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/dependency`, { id, dependsOn, agent: actor.agent })
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

async function cmdTasksComplete(actor: CliActor, id: string, summary: string): Promise<void> {
  // Log the summary, then move to done
  await apiPost(`/api/plugins/tasks/${id}/log`, { id, author: actor.agent, message: `Task complete: ${summary}` })
  const result = await apiPost(`/api/plugins/tasks/${id}/move`, { id, to: 'done', ...actorFields(actor) })
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

export async function run(argv: string[]): Promise<void> {
  // `--as` may sit anywhere; strip it before positional parsing. Resolution
  // (sidecar walk / roster lookup) is lazy — read-only commands never pay.
  const { as, rest: args, invalid } = stripActorFlag(argv)
  if (invalid) await exitUsage(invalid)
  const actor = () => resolveCliActor(as)
  const sub = args[1]
  if (sub === 'list') {
    const colFlag = args.find(a => a.startsWith('--column='))
    await cmdTasksList(colFlag?.split('=')[1])
  } else if (sub === 'get') {
    if (!args[2]) await exitUsage('bakin tasks get <id>')
    await cmdTasksGet(args[2], { json: args.includes('--json') })
  } else if (sub === 'create') {
    const createUsage = 'bakin tasks create <title> [agent] [--team=<id>] [--workflow=<id>] [--no-workflow="<reason>"] [--as=<actor>]'
    if (!args[2]) await exitUsage(createUsage)
    // Parse flags from remaining args
    const createArgs = args.slice(2)
    const wfFlag = createArgs.find(a => a.startsWith('--workflow='))
    const noWfFlag = createArgs.find(a => a.startsWith('--no-workflow='))
    const teamFlag = createArgs.find(a => a.startsWith('--team='))
    const positional = createArgs.filter(a => !a.startsWith('--'))
    const createTitle = positional[0]
    const createAssignee = positional[1]
    const createWorkflowId = wfFlag?.split('=').slice(1).join('=')
    const createSkipReason = noWfFlag?.split('=').slice(1).join('=')
    const createTeam = teamFlag?.split('=').slice(1).join('=')
    if (!createTitle) await exitUsage(createUsage)
    if (createAssignee && createTeam) await exitUsage(`${createUsage}\n(agent and --team are mutually exclusive)`)
    await cmdTasksCreate(await actor(), createTitle, createAssignee, createWorkflowId, createSkipReason, createTeam)
  } else if (sub === 'move') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks move <id> <column> [--as=<actor>]')
    await cmdTasksMove(await actor(), args[2], args[3])
  } else if (sub === 'log') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks log <id> <message> [--as=<actor>]')
    await cmdTasksLog(await actor(), args[2], args.slice(3).join(' '))
  } else if (sub === 'block') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks block <id> <reason> [--as=<actor>]')
    await cmdTasksBlock(await actor(), args[2], args.slice(3).join(' '))
  } else if (sub === 'depend') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks depend <id> <dependsOn> [--as=<actor>]')
    await cmdTasksDepend(await actor(), args[2], args[3])
  } else if (sub === 'complete') {
    if (!args[2] || !args[3]) await exitUsage('bakin tasks complete <id> <summary> [--as=<actor>]')
    await cmdTasksComplete(await actor(), args[2], args.slice(3).join(' '))
  } else {
    await exitUnknownSubcommand('tasks', sub, ['list', 'get', 'create', 'move', 'log', 'block', 'depend', 'complete'])
  }
}
