/**
 * `bakin schedule {list,add,pause,resume,remove,run,runs}` — thin subcommand
 * router over the existing src/cli/schedule.ts command functions. Case body
 * relocated verbatim from cli/bakin.ts (B5.3 command-module split).
 */
import {
  cmdScheduleList, cmdScheduleAdd, cmdSchedulePause,
  cmdScheduleResume, cmdScheduleRemove, cmdScheduleRun, cmdScheduleRuns,
} from '../schedule'
import { exitUsage, exitUnknownSubcommand } from '../help'

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (!sub || sub === 'list') {
    await cmdScheduleList({ agent: args.includes('--agent') ? args[args.indexOf('--agent') + 1] : undefined })
  } else if (sub === 'add') {
    if (!args[2] || !args[3]) await exitUsage('bakin schedule add <name> <schedule> [--agent <id>] [--prompt <text>]')
    const agentIdx = args.indexOf('--agent')
    const promptIdx = args.indexOf('--prompt')
    await cmdScheduleAdd({
      name: args[2],
      schedule: args[3],
      agent: agentIdx > -1 ? args[agentIdx + 1] : undefined,
      prompt: promptIdx > -1 ? args.slice(promptIdx + 1).join(' ') : undefined,
    })
  } else if (sub === 'pause') {
    if (!args[2]) await exitUsage('bakin schedule pause <jobId> [--until <date>] [--skip <n>]')
    const untilIdx = args.indexOf('--until')
    const skipIdx = args.indexOf('--skip')
    await cmdSchedulePause(args[2], {
      until: untilIdx > -1 ? args[untilIdx + 1] : undefined,
      skip: skipIdx > -1 ? Number(args[skipIdx + 1]) : undefined,
    })
  } else if (sub === 'resume') {
    if (!args[2]) await exitUsage('bakin schedule resume <jobId>')
    await cmdScheduleResume(args[2])
  } else if (sub === 'remove') {
    if (!args[2]) await exitUsage('bakin schedule remove <jobId>')
    await cmdScheduleRemove(args[2])
  } else if (sub === 'run') {
    if (!args[2]) await exitUsage('bakin schedule run <jobId>')
    await cmdScheduleRun(args[2])
  } else if (sub === 'runs') {
    if (!args[2]) await exitUsage('bakin schedule runs <jobId>')
    await cmdScheduleRuns(args[2], { limit: 20 })
  } else {
    await exitUnknownSubcommand('schedule', sub, ['list', 'add', 'pause', 'resume', 'remove', 'run', 'runs'])
  }
}
