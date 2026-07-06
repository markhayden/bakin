/**
 * Synchronous dispatch prompt assembly. Pure string builders extracted from
 * dispatch.ts — no dispatch state, no I/O. Async/cached context blocks
 * (lessons, assets) live in dispatch-context-blocks.ts and are passed in here
 * as already-resolved strings.
 *
 * The ONE non-pure touch: tool-call lines render per the active runtime's
 * declared tool access (`describeToolAccess`) — mcporter shell commands for
 * OpenClaw, bare native tool calls for in-process runtimes (Pi). Resolved
 * via `resolveToolInvocation()` so the context-report measurement path and
 * production dispatch render identically; every builder also accepts the
 * style explicitly for pure/testable use.
 */
import { join } from 'path'
// Namespace import: suites mock.module() app-services with partial export
// sets; a named import would break the whole import graph under those mocks.
import * as appServices from './app-services'
import type {
  DispatchContinuationContext,
  DispatchRosterAgent,
  SessionDeathState,
} from './dispatch-types'

const IMAGE_MCPORTER_TIMEOUT_MS = 600000

export type ToolInvocation = 'native' | 'mcporter-cli'

/** Tool-invocation style of the ACTIVE runtime; 'mcporter-cli' when unset (legacy default). */
export function resolveToolInvocation(): ToolInvocation {
  try {
    if (typeof appServices.maybeGetAppServices !== 'function') return 'mcporter-cli'
    return appServices.maybeGetAppServices()?.runtime.describeToolAccess?.().invocation ?? 'mcporter-cli'
  } catch {
    return 'mcporter-cli'
  }
}

export function mcporterHelpers(agentName: string, invocation: ToolInvocation = resolveToolInvocation()) {
  const server = `bakin-${agentName}`
  if (invocation === 'native') {
    // Exec tools are first-class session tools — render bare calls.
    const call = (tool: string, args: string) => `${tool} ${args}`
    return { server, invocation, mc: call, mcImage: call }
  }
  return {
    server,
    invocation,
    mc: (tool: string, args: string) => `mcporter call ${server}.${tool} ${args}`,
    mcImage: (tool: string, args: string) => `mcporter call ${server}.${tool} --timeout ${IMAGE_MCPORTER_TIMEOUT_MS} ${args}`,
  }
}

/**
 * Shared execution-tool documentation — single source so the regular and
 * workflow prompt builders cannot drift. Intentional differences (e.g.
 * channel posting only for output steps) are explicit parameters.
 */
export function sharedExecutionToolDocs(agentName: string, taskId: string, opts: { allowChannelPost: boolean }): string[] {
  const { mc, mcImage } = mcporterHelpers(agentName)
  // Bare taskId-templated invocations only — the per-tool explanations live in
  // the "Bakin Execution Tools" role-layer section of AGENTS.md (#357 trim).
  const lines = [
    '# execution tools — full reference: "Bakin Execution Tools" in your AGENTS.md',
    mc('bakin_exec_assets_save', `taskId=${taskId} type=<images|text|video|audio|plans|data|other> filePath="<path>" description="<what it is>"`),
    mc('bakin_exec_images_recommend', 'surface=instagram-feed-portrait objective="<goal>"'),
    mcImage('bakin_exec_images_generate', `taskId=${taskId} prompt="<text>" surface=instagram-feed-portrait provider=auto`),
    mc('bakin_exec_check_gates', `taskId=${taskId}`),
  ]
  if (opts.allowChannelPost) {
    lines.push(mc('bakin_exec_post_channel', `channel="<name>" content="<message>" taskId=${taskId}`))
  }
  return lines
}

/**
 * The prevention half of session-death hardening: a short artifact-first
 * reminder injected into EVERY dispatch prompt, carrying the taskId-templated
 * save command. The full rule prose lives in the subagent role-context layer
 * composed into each agent's AGENTS.md managed block (maintained by
 * `bakin agents sync` / doctor) — this inline reminder keeps the
 * safety-critical presence per-dispatch without re-shipping the static
 * catalog every turn.
 */
export function outputDisciplineSection(agentName: string, taskId: string, opts: { subtasksAllowed: boolean }): string[] {
  const { mc } = mcporterHelpers(agentName)
  return [
    '## OUTPUT DISCIPLINE — MANDATORY',
    '',
    `Oversized chat output KILLS your runtime session. Deliverables larger than ~8KB go to workspace files, saved as assets ONE AT A TIME: \`${mc('bakin_exec_assets_save', `taskId=${taskId} type=<type> filePath="<path>" description="<what it is>"`)}\``,
    opts.subtasksAllowed
      ? 'Keep chat short — status + asset ids only. Numerous independent deliverables → split into subtasks. Full rules: "Bakin Execution Tools" in your AGENTS.md.'
      : 'Keep chat short — status + asset ids only. Large step output → save as asset, reference the asset id in your submitted output. Full rules: "Bakin Execution Tools" in your AGENTS.md.',
  ]
}

/**
 * Corrective guidance injected at the TOP of a re-dispatch prompt after a
 * session death (position primacy — the agent must read this before the
 * task). Explains WHY the previous attempt died and how this one differs.
 */
export function buildCorrectiveSection(taskId: string, recovery: SessionDeathState): string {
  const d = recovery.lastDiagnosis
  const sizeLabel = d.completionBytes !== undefined
    ? `~${Math.round(d.completionBytes / 1024)}KB`
    : 'too much'
  const salvageLine = recovery.salvagedAssetIds.length > 0
    ? `\nA partial copy of that output was salvaged as asset ${recovery.salvagedAssetIds.join(', ')} — open it with bakin_exec_assets_open and REUSE it instead of regenerating from scratch.`
    : ''
  return `## PREVIOUS ATTEMPT FAILED — READ FIRST
Your previous attempt on this task died before completion: ${d.detail ?? `the runtime session ended (${d.sessionStatus ?? d.reason})`}. The session was killed because ${sizeLabel} of output was emitted as chat text instead of being written to files — the runtime cannot deliver responses that large.${salvageLine}

Do this attempt differently:
- Produce deliverables ONE AT A TIME: write each to a workspace file, then immediately save it: bakin_exec_assets_save taskId=${taskId} type=<type> filePath="<path>" description="<what it is>"
- Log progress after each save, then move to the next deliverable.
- Keep every chat/completion message SHORT: status + asset ids only. NEVER put deliverable content in chat output.

`
}

/**
 * Decomposition dispatch (recovery-ladder rung 2): the agent must NOT do the
 * work — only split it into chained single-deliverable subtasks. Emitting a
 * handful of tool calls is a tiny output, the structural opposite of the
 * failure being recovered from.
 */
export function buildDecompositionMessage(
  task: { id: string; title: string; description?: string },
  agentName: string,
  recovery: SessionDeathState,
): string {
  const { mc } = mcporterHelpers(agentName)
  const d = recovery.lastDiagnosis
  const detailsBlock = task.description ? `\n\nOriginal task details:\n${task.description}` : ''
  const salvageBlock = recovery.salvagedAssetIds.length > 0
    ? `\n\nSalvaged partial output from the failed attempts is saved as asset ${recovery.salvagedAssetIds.join(', ')} (open with bakin_exec_assets_open). Use it to determine which deliverables are already partially done and reference it in the subtask descriptions.`
    : ''

  return `## DECOMPOSITION REQUIRED — DO NOT DO THE WORK

Task "${task.title}" (ID: ${task.id}) has failed ${recovery.deaths} times because the runtime session died mid-attempt${d.oversizedOutput ? ' from oversized chat output' : ''}. Producing everything in one turn does not work. Your ONLY job right now is to split it into subtasks — do NOT produce any deliverable content in this turn.${detailsBlock}${salvageBlock}

Steps:
1. Identify the distinct deliverables this task requires (a checklist).
2. Create one subtask per deliverable, in order:
   \`${mc('bakin_exec_tasks_create', `title="<deliverable>" parentId=${task.id} agent=${agentName} description="Produce <deliverable>. Write it to a file and save it with bakin_exec_assets_save taskId=${task.id} (link assets to the PARENT task so the final review sees them). Keep chat output short."`)}\`
3. Chain them so they run one at a time: for every subtask after the first, \`${mc('bakin_exec_tasks_set_dependency', 'taskId=<subtask> dependsOn=<previous subtask>')}\`. Then make THIS task wait for the chain: \`${mc('bakin_exec_tasks_set_dependency', `taskId=${task.id} dependsOn=<last subtask>`)}\` — it will re-dispatch automatically for final assembly when the chain completes.
4. Log what you created: \`${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="Decomposed into N subtasks: <ids>"`)}\`
5. STOP. Do not start any subtask, do not draft content, do not call tasks_complete.`
}

/**
 * One labeled piece of a dispatch prompt. `text` carries its exact separator
 * prefix so sections concatenate byte-identically to the assembled message —
 * the context-report diagnostics measure the same strings production sends.
 */
export interface PromptSection {
  source: string
  text: string
}

/** @internal Exported for testing and the context-report diagnostics. */
export function buildDispatchSections(
  task: { id: string; title: string; description?: string; agent?: string; projectId?: string },
  agentName: string,
  contentDir: string,
  mainAgentId = 'main',
  lessonBlock = '',
  continuation: DispatchContinuationContext = {},
  recovery?: SessionDeathState,
  roster: DispatchRosterAgent[] = [],
  assetsBlock = '',
): PromptSection[] {
  const sections: PromptSection[] = []
  const add = (source: string, text: string) => {
    if (text) sections.push({ source, text })
  }

  add('corrective', recovery?.stage === 'corrective' ? buildCorrectiveSection(task.id, recovery) : '')
  const detailsBlock = task.description ? `\n\nDetails:\n${task.description}` : ''
  const lessonSection = lessonBlock ? `\n\n${lessonBlock}` : ''
  // Dependency continuations run in a fresh session — the prompt must carry
  // the completion context the old shared-session resume nudge relied on.
  const continuationBlock = continuation.completedDependency
    ? `\n\n## Completed Dependency\nYour dependency task "${continuation.completedDependency.title}" (task ${continuation.completedDependency.id}) is now done. Review its outcome before resuming: \`bakin_exec_tasks_get taskId=${continuation.completedDependency.id}\` shows its log and completion summary, and its saved assets are linked to that task. Continue this task from where it left off.`
    : ''
  const contactsRef = `Reference info is in ${join(contentDir, 'team/CONTACTS.md')}.`

  const { server, mc, invocation } = mcporterHelpers(agentName)

  if (!task.agent) {
    // Roster comes from the live runtime — never a hardcoded agent list
    // (custom-agent installs broke against baked-in names).
    const rosterAgents = roster.filter((a) => a.id !== mainAgentId)
    const rosterText = rosterAgents.length > 0
      ? ` (${rosterAgents.map((a) => (a.role ? `${a.id}=${a.role}` : a.id)).join(', ')})`
      : ''
    add('task-header', `Triage this task: "${task.title}".`)
    add('description', detailsBlock)
    add('continuation', continuationBlock)
    add('assets', assetsBlock)
    add('lessons', lessonSection)
    add('triage-instructions', `\n\nEither handle it yourself or assign it to the right agent${rosterText} via \`${mc('bakin_exec_tasks_assign', `taskId=${task.id} agent="<agent>"`)}\`. ${contactsRef}\n\nLog progress: \`${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<update>"`)}\``)
    return sections
  }

  if (task.agent === mainAgentId) {
    add('task-header', `Work on this task: "${task.title}".`)
    add('description', detailsBlock)
    add('continuation', continuationBlock)
    add('assets', assetsBlock)
    add('lessons', lessonSection)
    add('main-instructions', `\n\n${contactsRef} When done: \`${mc('bakin_exec_tasks_complete', `taskId=${task.id} summary="<what you did>"`)}\`\n\nLog progress: \`${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<update>"`)}\``)
    return sections
  }

  add('task-header', `Work on this task: "${task.title}".`)
  add('description', detailsBlock)
  add('continuation', continuationBlock)
  add('assets', assetsBlock)
  // Project context — lightweight mention if task has a projectId
  add('project', task.projectId
    ? `\n\n**Project:** id ${task.projectId}\nThe project spec may contain detailed requirements. Call bakin_exec_projects_get to read it before starting work.`
    : '')
  add('lessons', lessonSection)
  add('progress-logging', `

## PROGRESS LOGGING — MANDATORY

Log progress at EVERY major step (start, each step, decisions, blockers, completion; at least every 2 minutes). Full logging rules: "Bakin Execution Tools" in your AGENTS.md.`)
  add('output-discipline', `

${outputDisciplineSection(agentName, task.id, { subtasksAllowed: true }).join('\n')}`)
  add('task-commands', `

${invocation === 'native'
    ? '## TASK COMMANDS — call these tools directly (they are available in your session)'
    : `## TASK COMMANDS — via mcporter (server \`${server}\`)`}

\`\`\`bash
# log progress (mandatory at every major step)
${mc('bakin_exec_tasks_log_progress', `taskId=${task.id} message="<what you did or are doing>"`)}
# complete / block
${mc('bakin_exec_tasks_complete', `taskId=${task.id} summary="<what you accomplished>"`)}
${mc('bakin_exec_tasks_block', `taskId=${task.id} reason="<what went wrong>"`)}
# subtask + dependency chain (then stop — you'll be re-dispatched)
${mc('bakin_exec_tasks_create', `title="<subtask>" assignee="<agent>" description="<brief>" parentId=${task.id}`)}
${mc('bakin_exec_tasks_set_dependency', `taskId=${task.id} dependsOn="<other-task-id>"`)}
# your task details
${mc('bakin_exec_tasks_get', `taskId=${task.id}`)}
`)
  add('shared-tool-docs', sharedExecutionToolDocs(agentName, task.id, { allowChannelPost: true }).join('\n'))
  add('project-tools', task.projectId ? `

# Project tools (this task is part of a project)
${mc('bakin_exec_projects_get', `projectId="${task.projectId}"`)}
${mc('bakin_exec_projects_mark_item', `projectId="${task.projectId}" taskItemId="<itemId>" checked=true`)}
${mc('bakin_exec_projects_add_item', `projectId="${task.projectId}" title="<item title>"`)}` : '')
  add('task-commands-close', `
\`\`\`

Tool reference + dependency pattern: "Bakin Execution Tools" in your AGENTS.md.`)
  return sections
}

/** @internal Exported for testing. */
export function buildDispatchMessage(
  task: { id: string; title: string; description?: string; agent?: string; projectId?: string },
  agentName: string,
  contentDir: string,
  mainAgentId = 'main',
  lessonBlock = '',
  continuation: DispatchContinuationContext = {},
  recovery?: SessionDeathState,
  roster: DispatchRosterAgent[] = [],
  assetsBlock = '',
): string {
  return buildDispatchSections(task, agentName, contentDir, mainAgentId, lessonBlock, continuation, recovery, roster, assetsBlock)
    .map((s) => s.text)
    .join('')
}
