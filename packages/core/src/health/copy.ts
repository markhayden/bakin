/**
 * ONE copy table for Health and Updates (spec A15): the user-facing words for
 * every reason automation did not run. Cards, dialogs, toasts, Discord,
 * History and the CLI render these; the internal reason codes stay in
 * details and JSON. Repair states and terminal outcomes join this table with
 * the repair engine.
 */
import { MUTATION_REFUSAL_REASONS } from './authorize-mutation'

const AUTO_APPLY_BLOCK_REASONS = ['turn-in-flight', 'restart-pending', 'preflight-failed', 'skipped'] as const

export const AUTOMATION_BLOCK_REASONS = Object.freeze([...MUTATION_REFUSAL_REASONS, ...AUTO_APPLY_BLOCK_REASONS] as const)
export type AutomationBlockReason = (typeof AUTOMATION_BLOCK_REASONS)[number]

export interface AutomationBlockContext {
  /** consent-delta: how many new permissions/binaries/secrets/payloads are asked for. */
  permissions?: number
  bins?: number
  secrets?: number
  npm?: number
  /** operator-only: the concrete consequence ("Deletes 12 files", "Changes the spending limit"). */
  consequence?: string
  /** quarantined: when the installed identity failed here, in the user's words ("Tuesday", "2 days ago"). */
  failedOn?: string
  /** turn-in-flight: who is working on what. */
  agent?: string
  task?: string
}

export interface AutomationBlockCopy {
  title: string
  detail?: string
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function deltaDetail(ctx: AutomationBlockContext): string | undefined {
  const parts: string[] = []
  if (ctx.permissions) parts.push(plural(ctx.permissions, 'new permission', 'new permissions'))
  if (ctx.bins) parts.push(plural(ctx.bins, 'new binary', 'new binaries'))
  if (ctx.secrets) parts.push(plural(ctx.secrets, 'new secret', 'new secrets'))
  if (ctx.npm) parts.push(plural(ctx.npm, 'new package', 'new packages'))
  if (parts.length === 0) return undefined
  const last = parts.pop()!
  return `Asks for ${parts.length > 0 ? `${parts.join(', ')} and ${last}` : last}.`
}

export function automationBlockCopy(reason: AutomationBlockReason, ctx: AutomationBlockContext = {}): AutomationBlockCopy {
  switch (reason) {
    case 'consent-unreviewed':
      return { title: 'Your approval is needed before automatic updates', detail: 'Review what this tool is allowed to do once; matching releases then update on their own.' }
    case 'consent-delta':
      return { title: 'This update needs additional access', detail: deltaDetail(ctx) }
    case 'declined':
      return { title: 'Automatic changes are off for this tool', detail: 'You chose to review every change here. Updates and repairs wait for you.' }
    case 'untrusted-source':
      return { title: 'Updates from this source need your approval', detail: 'Only trusted sources update on their own. You can trust this source in Settings.' }
    case 'hub-skill':
      return { title: 'Review this skill update before installing', detail: 'Hub skills are always reviewed.' }
    case 'operator-only':
      return { title: ctx.consequence ?? 'This change needs your confirmation', detail: ctx.consequence ? 'This change needs your confirmation.' : undefined }
    case 'quarantined':
      return { title: `This version failed here${ctx.failedOn ? ` on ${ctx.failedOn}` : ''}; automatic retries are paused` }
    case 'disabled':
      return { title: 'Automatic updates are off', detail: 'Turn them on in Settings → System & Alerts → Updates.' }
    case 'skipped':
      return { title: 'This version is hidden', detail: 'You hid this version. A newer one will show again.' }
    case 'turn-in-flight':
      return { title: ctx.agent && ctx.task ? `Waiting for ${ctx.agent}’s “${ctx.task}” to finish` : 'Waiting for the current agent work to finish' }
    case 'restart-pending':
      return { title: 'Update ready — waiting to restart' }
    case 'preflight-failed':
      return { title: 'Update paused: these installed tools need attention' }
  }
}
