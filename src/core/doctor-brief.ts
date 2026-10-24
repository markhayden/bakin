/**
 * The ONE brief builder for every agent-run Health task (self-healing 1.5,
 * spec §3.4). The delegated-repair task (today's escalation) and the
 * fallback investigation (`core.diagnose`) share the same integrity rules
 * and the same sanctioned-fix lines; the fallback adds what the engine
 * already tried, the hand-back contract, the sanctioned CLI verbs, the
 * Terminal convention and the turn budget.
 *
 * The margo forgery (2026-09-21, #898): a delegated repair agent whose
 * installer hung hand-built the artifact and forged its receipt — because
 * the brief never told it what the sanctioned path was, nor that
 * fabrication is worse than failure. Every incident names its published
 * resolution explicitly, and every brief carries the integrity rules.
 */
import type { HealthIncident } from '../../packages/core/src/plugin-types'

export interface RepairAttemptSummary {
  actionId: string
  attempt: number
  outcome: 'failed' | 'stalled' | 'refused'
  message: string
  operationId?: string
  /** Bounded by the caller — the brief never carries a whole log. */
  logExcerpt?: string
}

export interface FallbackBriefInput {
  subject?: { kind: string; id: string; label?: string }
  /** What the engine already tried, newest last; empty when the incident goes straight to diagnosis. */
  attempts: RepairAttemptSummary[]
  turnBudget: { total: number; remaining: number }
  /** Registered repair action ids the agent may propose for this subject (never the diagnose action itself). */
  proposableActions: string[]
  /** `bakin_exec_terminal_session` is registered for the assignee (Terminal is a Bits plugin — feature-detected). */
  terminalAvailable: boolean
  /** Which fallback exec tools this release registers; the brief never names a tool that does not exist. */
  tools: { handback: boolean; repair: boolean }
}

export interface RepairBriefInput {
  requestId: string
  incidents: readonly HealthIncident[]
  fallback?: FallbackBriefInput
}

/** Spec §3.5: the verbs `--yes` is honoured for in agent mode. */
export const SANCTIONED_AGENT_VERBS: readonly string[] = Object.freeze([
  'bakin plugins upgrade <id> --yes (only when the consent delta is empty)',
  'bakin packages sync --yes',
  'bakin agents sync --yes',
  'bakin install {search,search-models,media,plugin-assets,agent-sync,capabilities} --yes',
  'bakin reindex (repair mode only — never --force)',
  'bakin doctor --fix --yes (self-heal items only)',
  'bakin search:stats',
  'bakin check <component>',
])

/** Spec §3.5: refused in agent mode regardless of flags. */
export const REFUSED_AGENT_VERBS: readonly string[] = Object.freeze([
  'approvals (any decision)',
  'bakin updates apply',
  'bakin update',
  'bakin search:reset',
  'bakin plugins remove|install',
  'bakin packages remove',
  'bakin skills install',
  'anything with --as human',
])

/**
 * One line naming the incident's SANCTIONED fix. A repair resolution is a
 * published one-click; instructions carry their command; everything else
 * points back at Health.
 */
function describeSanctionedFix(incident: HealthIncident): string[] {
  const resolution = incident.resolution
  if (!resolution) {
    return ['  Sanctioned fix: none published — diagnose and report findings; do NOT improvise a fix.']
  }
  switch (resolution.type) {
    case 'repair':
      return [`  Sanctioned fix: one-click repair "${resolution.label}" — run the matching documented \`bakin\` command if the incident names one; otherwise report that this repair must be applied from Health.`]
    case 'instructions':
      return [
        `  Sanctioned fix: ${resolution.label}${resolution.command ? ` — run \`${resolution.command}\`` : ''}`,
        ...resolution.steps.slice(0, 4).map((step) => `    • ${step}`),
      ]
    case 'rerun':
      return [`  Sanctioned fix: re-run the check ("${resolution.label}") after addressing the cause.`]
    default:
      return ['  Sanctioned fix: see the incident in Health.']
  }
}

function subjectLine(subject: NonNullable<FallbackBriefInput['subject']>): string {
  return `${subject.kind}:${subject.id}${subject.label ? ` (${subject.label})` : ''}`
}

function attemptLines(attempts: readonly RepairAttemptSummary[]): string[] {
  if (attempts.length === 0) return ['- none — this incident has no deterministic repair, so it goes straight to diagnosis.']
  return attempts.flatMap((attempt) => [
    `- attempt ${attempt.attempt}: ${attempt.actionId} → ${attempt.outcome}${attempt.operationId ? ` (operation ${attempt.operationId})` : ''}: ${attempt.message}`,
    ...(attempt.logExcerpt ? attempt.logExcerpt.split('\n').slice(0, 12).map((line) => `    ${line}`) : []),
  ])
}

function handbackLines(fallback: FallbackBriefInput): string[] {
  const shapes = [
    '  (a) proposal — a registered action the engine can plan now:',
    '      { "kind": "proposal", "actionId": "<one of the proposable actions>", "target": { "type": "incidents", "ids": ["<incident id>"] }, "reasoning": "<what you found>" }',
    '  (b) human — something only the operator can supply:',
    '      { "kind": "human", "needs": "credential" | "payment" | "decision" | "external-install", "href": "/settings?tab=...", "field": "<field id, when it is a value to enter>", "reasoning": "<why>" }',
    '  (c) upstream-blocked — evidence plus the containment the engine should offer:',
    '      { "kind": "upstream-blocked", "evidence": "<what proves it>", "containment": "disable-plugin" | "pause-capability" | "pause-schedule", "reasoning": "<what it stops>" }',
    '  Free text alone is not a hand-back. An unplannable proposal is rejected back to you while turns remain.',
  ]
  if (fallback.tools.handback) {
    return [
      'HAND-BACK (how this task ends): submit EXACTLY ONE of these through `bakin_exec_health_handback`:',
      ...shapes,
      '  `bakin_exec_tasks_complete` refuses this task without an accepted hand-back and returns this schema.',
    ]
  }
  return [
    'HAND-BACK (how this task ends): this release has no hand-back tool yet, so END by BLOCKING this task with a summary in EXACTLY ONE of these shapes (verbatim JSON on its own line):',
    ...shapes,
  ]
}

function proposableLines(fallback: FallbackBriefInput): string[] {
  if (fallback.proposableActions.length === 0) return ['PROPOSABLE ACTIONS: none registered for this subject — a proposal cannot be accepted; hand back a human need or an upstream block.']
  return ['PROPOSABLE ACTIONS (the only action ids a proposal may name):', ...fallback.proposableActions.map((id) => `- ${id}`)]
}

function terminalLines(fallback: FallbackBriefInput): string[] {
  const title = `Health repair: ${fallback.subject ? subjectLine(fallback.subject) : 'investigation'}`
  if (fallback.terminalAvailable) {
    return [
      'TERMINAL:',
      `- Create ONE session titled "${title}" with \`bakin_exec_terminal_session\`, linked to this task, and run every command there.`,
      '- Leave the session open when you finish: the operator takes over in it. Never close or clear it.',
    ]
  }
  return ['TERMINAL: the Terminal plugin is not available to you — use your own shell, and quote every command you ran in the hand-back.']
}

function budgetLines(fallback: FallbackBriefInput): string[] {
  const { total, remaining } = fallback.turnBudget
  return [
    `TURN BUDGET: ${remaining} of ${total} agent turn${total === 1 ? '' : 's'} remain. Every turn counts — the first dispatch, a requeue, the turn that reads an asynchronous repair's result.`,
    fallback.tools.repair
      ? '- Never wait on a restart-class or long repair: submit it through `bakin_exec_health_repair` (it returns the operation id) and END your turn. Bakin re-dispatches this task with the verified outcome while budget remains, or settles it itself.'
      : '- Never wait on a restart-class or long repair: report it as a proposal and END your turn.',
    '- When the budget ends without an accepted hand-back, Bakin completes this task itself as handed-back ("no valid hand-back") with the raw log attached.',
    '- No sub-delegation: `tasks_create` is refused from this task.',
  ]
}

export function buildRepairBrief(input: RepairBriefInput): string {
  const { requestId, incidents, fallback } = input
  const header = fallback
    ? [
      `Health investigation: ${requestId}`,
      '',
      fallback.subject ? `SUBJECT: ${subjectLine(fallback.subject)}` : 'SUBJECT: see the incidents below',
      '',
      'Bakin could not repair this deterministically. Diagnose the cause, then hand back ONE outcome the engine can act on (below). Use the incidents\' stable IDs when recording progress.',
    ]
    : [
      `Health repair request: ${requestId}`,
      '',
      'Resolve these Bakin Health incidents. Use their stable IDs when recording progress.',
    ]
  const incidentLines = incidents.flatMap((incident) => [
    `- ${incident.title} (${incident.id})`,
    `  Impact: ${incident.impact}`,
    ...describeSanctionedFix(incident),
  ])
  const fallbackSections = fallback
    ? [
      '',
      'ENGINE ATTEMPTS (what Bakin already tried):',
      ...attemptLines(fallback.attempts),
      '',
      ...handbackLines(fallback),
      '',
      ...proposableLines(fallback),
      '',
      'SANCTIONED CLI VERBS (agent mode honours --yes for exactly these):',
      ...SANCTIONED_AGENT_VERBS.map((verb) => `- ${verb}`),
      'Refused regardless of flags:',
      ...REFUSED_AGENT_VERBS.map((verb) => `- ${verb}`),
      '',
      ...terminalLines(fallback),
      '',
      ...budgetLines(fallback),
    ]
    : []
  return [
    ...header,
    '',
    ...incidentLines,
    ...fallbackSections,
    '',
    'INTEGRITY RULES (non-negotiable):',
    '- Repair ONLY through the sanctioned fixes above, documented `bakin` commands, or published exec tools.',
    '- NEVER create, edit, or fabricate Bakin-internal state by hand: receipts, stores under ~/.bakin (media/, packages/, bin/, models/), lockfiles, .installedBy/.userEdited sidecars, the .onboarded marker, health acks, or databases. A hand-built artifact poisons health reporting and bricks the real repair.',
    '- If a sanctioned fix fails, hangs, or cannot be verified: STOP and block this task with exactly what you ran and what happened. A clearly reported failure is a SUCCESS outcome for this task; a fabricated fix is the worst possible outcome.',
    '- Verification means fresh Health checks passing on their own. Never edit anything to make a check pass without fixing the underlying cause.',
    '- NEVER silence an incident instead of fixing it: do not acknowledge or snooze Health incidents, do not change doctor or escalation settings, and do not move this task to review to make it go quiet. If you cannot fix it, block this task and report why.',
    '',
    fallback
      ? 'When you have a hand-back, submit it and end your turn. Do not keep working past an accepted hand-back.'
      : 'When the root causes are addressed, run fresh Health checks and complete this task with a short summary.',
  ].join('\n')
}
