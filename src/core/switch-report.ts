/**
 * Honest can't-carry reporting for runtime switches (runtime-switch-carry
 * spec, D7/D8). Derived from the neutral capability surface only — presence
 * of the OPTIONAL `channels`/`cron` members plus best-effort counts — never
 * from provider config introspection (adapter-private by design, D7 bans
 * deep enumeration). The user learns what stays behind from the report, not
 * by discovering it broken.
 */
import type { AgentRuntimeAdapter, CronJob } from '@bakin/core/adapters/runtime'
import type { CapabilityMode } from '@bakin/core/adapters/runtime'
import { projectChannelReadiness, CHANNELS_SETTINGS_HREF, type ChannelOwner, type ChannelReadinessState, type ProjectedChannelState } from '@bakin/core/delivery'

export interface CantCarryLine {
  concern: 'channels' | 'cron' | 'sessions' | 'provider-config'
  detail: string
  count?: number
}

/**
 * What switch-time adoption did with every source cron job. The schedule
 * plugin's `schedule.adoptCronJobs` hook satisfies this structurally; core
 * never imports the plugin. `refused` = not a task prompt (spec D5): the job
 * stays native and is named in the report, never silently dropped.
 */
export interface CronAdoptionOutcome {
  adopted: string[]
  skipped: string[]
  refused: Array<{ jobId: string; name: string; reason: string }>
  failed: Array<{ jobId: string; error: string }>
  listing: Array<{ jobId: string; name: string; outcome: 'adopt' | 'skip' | 'refuse' | 'failed'; commandPreview: string; reason?: string }>
}

/** A source cron job captured pre-teardown for switch-time adoption. */
export interface SnapshottedCronJob {
  job: CronJob
  /** Provider-raw snapshot (cron.getRaw) — preserved on the adopted Bakin job. */
  raw: unknown
}

export interface SourceCapabilitySnapshot {
  hasChannels: boolean
  /** Best-effort; undefined when the surface exists but the count fetch failed. */
  channelCount?: number
  hasCron: boolean
  /** Best-effort; undefined when the surface exists but the count fetch failed. */
  cronJobCount?: number
  /**
   * Full job snapshots — captured ONLY when the caller asked to adopt cron
   * (the source runtime is torn down before adoption runs, so this is the
   * one window to read them). Per-job read failures drop that job with a
   * warn; adoption reports what it received.
   */
  cronJobs?: SnapshottedCronJob[]
}

export interface SnapshotSourceCapabilitiesOptions {
  /** Capture full cron job payloads (list + per-job getRaw) for adoption. */
  captureCronJobs?: boolean
}

/**
 * Capture the source's optional-surface presence + counts BEFORE teardown.
 * Count fetch failures degrade to "present, count unknown" — reported
 * without a number, never guessed, never thrown.
 */
export async function snapshotSourceCapabilities(
  source: AgentRuntimeAdapter,
  opts: SnapshotSourceCapabilitiesOptions = {},
): Promise<SourceCapabilitySnapshot> {
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
      const jobs = await source.cron.list()
      snapshot.cronJobCount = jobs.length
      if (opts.captureCronJobs && jobs.length > 0) {
        const captured: SnapshottedCronJob[] = []
        for (const job of jobs) {
          try {
            const raw = source.cron.getRaw
              ? await source.cron.getRaw(job.id, 'runtime switch: preserve native cron for Bakin adoption')
              : null
            captured.push({ job, raw })
          } catch {
            // Unreadable job — adoption reports it missing from the snapshot.
          }
        }
        snapshot.cronJobs = captured
      }
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

// ── channel ownership across a switch (#908 §4.9) ────────────────────────

export interface ChannelSwitchReport {
  source: { owner: ChannelOwner; state: ChannelReadinessState }
  target: { owner: ChannelOwner; projectedState: ProjectedChannelState; tokenSource: 'env' | 'store' | null }
  /** Owner-facing steps; empty when nothing needs doing. */
  setup: string[]
  /** The explicit ownership copy, both directions. */
  ownership: string
}

export interface ChannelSwitchInput {
  source: { adapter: string; deliveryMode: CapabilityMode; state: ChannelReadinessState }
  target: {
    adapter: string
    deliveryMode: CapabilityMode
    enabled: boolean
    tokenPresent: boolean
    tokenSource: 'env' | 'store' | null
    guildCount: number
  }
}

function ownerFor(mode: CapabilityMode): ChannelOwner {
  return mode === 'native' ? 'runtime' : 'bridge'
}

/**
 * Pure: who owns channel delivery on each side, what the bridge WOULD be on
 * the target (projection — never a connection outcome), and the setup the
 * owner must do. Bakin never reads the runtime's own token (the issue's
 * explicit non-goal): a runtime-owned token and a Bakin bridge token are
 * separate responsibilities, and the copy says so in both directions.
 */
export function buildChannelSwitchReport(input: ChannelSwitchInput): ChannelSwitchReport {
  const sourceOwner = ownerFor(input.source.deliveryMode)
  const targetOwner = ownerFor(input.target.deliveryMode)
  const projectedState = projectChannelReadiness({
    deliveryMode: input.target.deliveryMode,
    enabled: input.target.enabled,
    tokenPresent: input.target.tokenPresent,
    guildCount: input.target.guildCount,
  })
  const setup: string[] = []
  let ownership: string

  if (sourceOwner === 'runtime' && targetOwner === 'bridge') {
    ownership = `${input.source.adapter}'s bot token stays in ${input.source.adapter}'s own config. ${input.target.adapter} delivers through Bakin's Discord bridge, which needs its OWN token in Settings → Channels — Bakin never reads the runtime's secret.`
    if (projectedState === 'disabled') setup.push(`Enable Discord delivery in Settings → Channels (${CHANNELS_SETTINGS_HREF}) if you want channel alerts, approval cards, and inbound chat on ${input.target.adapter}.`)
    if (projectedState === 'missing_token') setup.push(`Add the Discord bot token in Settings → Channels (${CHANNELS_SETTINGS_HREF}) — the bridge cannot connect without it.`)
    if (projectedState === 'missing_guild') setup.push(`Add at least one Discord server (guild ID) in Settings → Channels (${CHANNELS_SETTINGS_HREF}).`)
    if (projectedState === 'ready_to_connect') setup.push('Nothing to add: the bridge is configured in Bakin and connects when the switch completes (plugin-bound surfaces follow at restart).')
  } else if (sourceOwner === 'bridge' && targetOwner === 'runtime') {
    ownership = `Bakin's Discord bridge goes idle by design: ${input.target.adapter}'s own channel config owns delivery, and the token stored in Bakin stays unused until you switch back.`
    setup.push(`Make sure ${input.target.adapter} has its own Discord configuration — Bakin's stored bot token is not shared with it.`)
  } else if (targetOwner === 'bridge') {
    ownership = `Both runtimes deliver through Bakin's Discord bridge; its configuration and token live in Settings → Channels and carry across unchanged.`
    if (projectedState === 'missing_token') setup.push(`Add the Discord bot token in Settings → Channels (${CHANNELS_SETTINGS_HREF}).`)
    if (projectedState === 'missing_guild') setup.push(`Add at least one Discord server (guild ID) in Settings → Channels (${CHANNELS_SETTINGS_HREF}).`)
  } else {
    ownership = `Both runtimes own channel delivery natively; each keeps its own channel configuration and token — nothing crosses.`
    setup.push(`Make sure ${input.target.adapter} has its own channel configuration.`)
  }

  return {
    source: { owner: sourceOwner, state: input.source.state },
    target: { owner: targetOwner, projectedState, tokenSource: input.target.tokenSource },
    setup,
    ownership,
  }
}
