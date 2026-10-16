/**
 * `bakin channels {status,verify,reconnect}` — thin HTTP clients over the
 * ONE readiness surface (/api/channels, channel-readiness spec §4.10 /
 * D12). Every verb needs a reachable server (the standard "Cannot connect"
 * path handles the rest) and speaks from the SERVER's snapshot — never a
 * local guess. `--json` prints the raw payload.
 *
 * Exit codes — status: 0 deliverable (connected/native), 2 otherwise.
 * verify: 0 all pass, 1 any fail, 2 everything skipped. reconnect (per
 * spec §4.5): connected 0; degraded / disabled / missing_token /
 * missing_guild 2; failed / disconnected / timed out 1; native 0.
 */
import type { ChannelReadiness } from '@bakin/core/delivery'
import { api, apiGet } from '../http'
import { print, printTable } from '../output'
import { exitUnknownSubcommand } from '../help'

const KNOWN_FLAGS = ['--json']

interface ProbeItem {
  key: string
  status: 'pass' | 'fail' | 'skipped'
  summary: string
  detail?: string
  setting?: string
}

function rejectUnknownFlags(args: string[]): void {
  const unknown = args.filter((arg) => arg.startsWith('--') && !KNOWN_FLAGS.includes(arg))
  if (unknown.length > 0) {
    console.error(`Unknown flag(s): ${unknown.join(', ')}. Supported: ${KNOWN_FLAGS.join(', ')}`)
    process.exit(1)
  }
}

function tokenLabel(token: ChannelReadiness['token']): string {
  if (!token.present) return 'not set'
  return token.source === 'env' ? 'environment variable' : 'Bakin store'
}

export function renderStatus(readiness: ChannelReadiness): string[] {
  const lines: string[] = []
  const { connection } = readiness
  lines.push(`State:      ${connection.state}${connection.since ? ` (since ${connection.since})` : ''}`)
  lines.push(`Owner:      ${readiness.owner}  (runtime ${readiness.runtime.adapter}, delivery ${readiness.runtime.deliveryMode})`)
  lines.push(`Enabled:    ${readiness.enabled ? 'yes' : 'no'}`)
  lines.push(`Token:      ${tokenLabel(readiness.token)}`)
  if (connection.botUser) lines.push(`Bot:        ${connection.botUser.name} (${connection.botUser.id})`)
  if (connection.lastError) lines.push(`Last error: ${connection.lastError.kind} — ${connection.lastError.message}`)
  if (readiness.guilds.length > 0) {
    lines.push('Servers:')
    for (const guild of readiness.guilds) {
      const joined = guild.joined === null ? 'unknown' : guild.joined ? 'joined' : 'NOT joined'
      const count = guild.channelCount === null ? '' : `, ${guild.channelCount} channel${guild.channelCount === 1 ? '' : 's'}`
      lines.push(`  ${guild.id}${guild.name ? ` (${guild.name})` : ''}: ${joined}${count}${guild.error ? ` — ${guild.error.kind}: ${guild.error.message}` : ''}`)
    }
  }
  lines.push(`Channels:   ${readiness.channels.items.length} (${readiness.channels.source})${readiness.channels.error ? ` — ${readiness.channels.error.message}` : ''}`)
  const routing = [readiness.routing.alertChannel, readiness.routing.approvalsChannel, ...readiness.routing.aliases]
  for (const target of routing) {
    if (target.value === null) continue
    lines.push(`  ${target.setting}: ${target.value} → ${target.resolved}${target.channelId ? ` (${target.channelId})` : ''}`)
  }
  if (readiness.remediation) {
    lines.push(`Next step:  ${readiness.remediation.summary} ${readiness.remediation.nextStep}`)
  }
  return lines
}

export function statusExitCode(readiness: ChannelReadiness): number {
  const state = readiness.connection.state
  return state === 'connected' || state === 'native' ? 0 : 2
}

export function verifyExitCode(items: ProbeItem[]): number {
  if (items.some((item) => item.status === 'fail')) return 1
  if (items.every((item) => item.status === 'skipped')) return 2
  return 0
}

export function reconnectExitCode(readiness: ChannelReadiness, timedOut: boolean): number {
  if (timedOut) return 1
  switch (readiness.connection.state) {
    case 'connected':
    case 'native':
      return 0
    case 'degraded':
    case 'disabled':
    case 'missing_token':
    case 'missing_guild':
      return 2
    default:
      return 1
  }
}

async function cmdStatus(json: boolean): Promise<void> {
  const readiness = await apiGet('/api/channels') as ChannelReadiness
  if (json) {
    print(readiness)
  } else {
    for (const line of renderStatus(readiness)) console.log(line)
  }
  process.exit(statusExitCode(readiness))
}

async function cmdVerify(json: boolean): Promise<void> {
  const result = await api('/api/channels/verify', { method: 'POST' }) as { items: ProbeItem[]; readiness: ChannelReadiness }
  if (json) {
    print(result)
  } else {
    printTable(
      result.items.map((item) => ({ check: item.key, result: item.status.toUpperCase(), summary: item.summary + (item.detail ? ` — ${item.detail}` : '') })),
      ['check', 'result', 'summary'],
    )
    console.log(`State: ${result.readiness.connection.state}`)
  }
  process.exit(verifyExitCode(result.items))
}

async function cmdReconnect(json: boolean): Promise<void> {
  const response = await fetch(`${(await import('../http')).BASE_URL}/api/channels/reconnect?wait=1`, { method: 'POST' })
  const body = await response.json().catch(() => ({})) as { readiness?: ChannelReadiness; error?: string; message?: string }
  if (!response.ok && response.status !== 202) {
    if (response.status === 409 && body.error === 'owner_is_runtime') {
      if (json) print(body)
      else console.log(body.message ?? 'The active runtime delivers natively; the Bakin bridge is idle by design.')
      process.exit(0)
    }
    console.error(body.message ?? body.error ?? `Reconnect failed (${response.status})`)
    process.exit(1)
  }
  const readiness = body.readiness as ChannelReadiness
  const timedOut = response.status === 202 && readiness.connection.state === 'connecting'
  if (json) {
    print({ timedOut, readiness })
  } else {
    if (timedOut) console.log('Timed out waiting for the bridge to settle — it is still connecting.')
    for (const line of renderStatus(readiness)) console.log(line)
  }
  process.exit(reconnectExitCode(readiness, timedOut))
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1] ?? 'status'
  const rest = args.slice(2)
  rejectUnknownFlags(rest)
  const json = rest.includes('--json')
  if (sub === 'status') return cmdStatus(json)
  if (sub === 'verify') return cmdVerify(json)
  if (sub === 'reconnect') return cmdReconnect(json)
  await exitUnknownSubcommand('channels', sub, ['status', 'verify', 'reconnect'])
}
