import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { getSettings } from './settings'

export interface ChannelAliasResolution {
  requested: string
  normalized: string
  resolved: string
  aliasUsed?: string
}

interface ResolveChannelOptions {
  aliases?: Record<string, string>
  knownChannelIds?: Iterable<string>
  allowUnknownBare?: boolean
}

function normalizeChannelName(channel: string): string {
  return channel.trim().replace(/^#/, '')
}

export function readConfiguredChannelAliases(): Record<string, string> {
  const notifications = getSettings().notifications as {
    channel?: unknown
    target?: unknown
    channelAliases?: unknown
  }
  const raw = notifications.channelAliases
  const aliases: Record<string, string> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const normalizedKey = normalizeChannelName(key)
      if (!normalizedKey || typeof value !== 'string') continue
      const normalizedValue = normalizeChannelName(value)
      if (normalizedValue) aliases[normalizedKey] = normalizedValue
    }
  }
  if (!aliases.general) {
    const channel = typeof notifications.channel === 'string' ? normalizeChannelName(notifications.channel) : ''
    const target = typeof notifications.target === 'string' ? normalizeChannelName(notifications.target) : ''
    if (channel && channel !== 'none') {
      if (channel.includes(':')) aliases.general = channel
      else if (target) aliases.general = target.startsWith(`${channel}:`) ? target : `${channel}:${target}`
    }
  }
  return aliases
}

function resolveAliasTarget(
  channel: string,
  aliases: Record<string, string>,
  seen = new Set<string>(),
): { target: string; aliasUsed?: string } {
  const normalized = normalizeChannelName(channel)
  const target = aliases[normalized]
  if (!target) return { target: normalized }
  if (seen.has(normalized)) {
    throw new Error(`Channel alias cycle detected at "${normalized}"`)
  }
  seen.add(normalized)
  const nested = resolveAliasTarget(target, aliases, seen)
  return { target: nested.target, aliasUsed: normalized }
}

export function resolveChannelRef(channel: string, options: ResolveChannelOptions = {}): ChannelAliasResolution {
  const normalized = normalizeChannelName(channel)
  if (!normalized) throw new Error('Channel is required')

  const aliases = options.aliases ?? readConfiguredChannelAliases()
  const known = new Set(Array.from(options.knownChannelIds ?? []).map(normalizeChannelName).filter(Boolean))

  if (normalized.includes(':')) {
    return { requested: channel, normalized, resolved: normalized }
  }

  const resolved = resolveAliasTarget(normalized, aliases)
  if (resolved.aliasUsed) {
    return {
      requested: channel,
      normalized,
      resolved: resolved.target,
      aliasUsed: resolved.aliasUsed,
    }
  }

  if (known.has(normalized) || options.allowUnknownBare) {
    return { requested: channel, normalized, resolved: normalized }
  }

  throw new Error(
    `No channel alias configured for #${normalized}. Configure notifications.channelAliases.${normalized} with a runtime target such as "discord:<target>", or use a runtime channel id directly.`
  )
}

export async function resolveRuntimeChannelRef(
  runtime: Pick<AgentRuntimeAdapter, 'channels'>,
  channel: string,
): Promise<ChannelAliasResolution> {
  let knownChannelIds: string[] = []
  try {
    knownChannelIds = (await runtime.channels.list()).map((entry) => entry.id)
  } catch {
    knownChannelIds = []
  }
  return resolveChannelRef(channel, { knownChannelIds })
}
