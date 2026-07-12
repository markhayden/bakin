/**
 * Honest can't-carry reporting for runtime switches (runtime-switch-carry
 * spec, D7/D8). Derived from the neutral capability surface only — presence
 * of the OPTIONAL `channels`/`cron` members plus best-effort counts — never
 * from provider config introspection (adapter-private by design, D7 bans
 * deep enumeration). The user learns what stays behind from the report, not
 * by discovering it broken.
 */
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

export interface CantCarryLine {
  concern: 'channels' | 'cron' | 'sessions' | 'provider-config'
  detail: string
  count?: number
}

export interface SourceCapabilitySnapshot {
  hasChannels: boolean
  /** Best-effort; undefined when the surface exists but the count fetch failed. */
  channelCount?: number
  hasCron: boolean
  /** Best-effort; undefined when the surface exists but the count fetch failed. */
  cronJobCount?: number
}

/**
 * Capture the source's optional-surface presence + counts BEFORE teardown.
 * Count fetch failures degrade to "present, count unknown" — reported
 * without a number, never guessed, never thrown.
 */
export async function snapshotSourceCapabilities(source: AgentRuntimeAdapter): Promise<SourceCapabilitySnapshot> {
  const snapshot: SourceCapabilitySnapshot = {
    hasChannels: source.channels !== undefined,
    hasCron: source.cron !== undefined,
  }
  if (source.channels) {
    try {
      snapshot.channelCount = (await source.channels.list()).length
    } catch {
      // Present but unreadable — the line still emits, without a count.
    }
  }
  if (source.cron) {
    try {
      snapshot.cronJobCount = (await source.cron.list()).length
    } catch {
      // Present but unreadable — the line still emits, without a count.
    }
  }
  return snapshot
}

/**
 * The can't-carry lines for a switch. Channels/cron lines emit when the
 * source HAS the surface and it isn't verifiably empty (count 0 means
 * nothing actually stays behind); sessions and provider-config lines emit
 * on every switch — they are true of any runtime pair.
 */
export function buildCantCarryReport(
  source: SourceCapabilitySnapshot,
  target: Pick<AgentRuntimeAdapter, 'channels' | 'cron'>,
): CantCarryLine[] {
  const lines: CantCarryLine[] = []

  if (source.hasChannels && source.channelCount !== 0) {
    lines.push({
      concern: 'channels',
      detail: target.channels
        ? 'channel config stays on the source runtime — reconfigure channels on the target'
        : 'channel config stays behind — the target runtime has no channels surface',
      ...(source.channelCount !== undefined ? { count: source.channelCount } : {}),
    })
  }

  if (source.hasCron && source.cronJobCount !== 0) {
    lines.push({
      concern: 'cron',
      detail: target.cron
        ? 'runtime-owned cron jobs stay on the source runtime — recreate them on the target'
        : 'runtime-owned cron jobs stay behind — the target runtime has no cron surface',
      ...(source.cronJobCount !== undefined ? { count: source.cronJobCount } : {}),
    })
  }

  lines.push({
    concern: 'sessions',
    detail: 'runtime session context resets — chats keep their Bakin-owned transcripts; agents start fresh sessions on the target',
  })
  lines.push({
    concern: 'provider-config',
    detail: 'provider-specific runtime config (credentials, adapter settings) never crosses runtimes — configure the target separately',
  })

  return lines
}
