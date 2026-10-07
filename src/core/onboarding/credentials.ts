/**
 * credentials component - warn-only checks for LLM providers and
 * messaging channels configured in the active runtime adapter.
 *
 * Bakin does NOT prompt users to paste secrets. That is the runtime
 * adapter's territory. This module only verifies that the runtime has
 * at least one provider and one channel configured, so we can tell a new
 * user "your agents won't be able to reach any LLM until you configure
 * the runtime" instead of letting them discover that from a broken
 * dispatch at 3am.
 *
 * P2.2: reads go through the runtime-neutral `credentialStatus()` contract
 * method (presence-only — names, never secrets). Each adapter parses its own
 * credential shapes internally; core never touches raw runtime config here.
 *
 * Both checks are **warn-only** - they never return `error`, and
 * `install()` is always a noop with a remediation pointer. The
 * orchestrator in T9 writes `components.llm: "warn"` and
 * `components.channels: "warn"` to the .onboarded marker on decline;
 * Bakin still starts.
 */
import type { AgentRuntimeAdapter, RuntimeCredentialStatus } from '@bakin/core/adapters/runtime'
import { CHANNELS_SETTINGS_HREF, projectChannelReadiness, type ChannelReadiness } from '@bakin/core/delivery'
import { SECRET_SLOT, resolveSecretSlotStatus } from '@bakin/core/secrets'
import { createLogger } from '../logger'
import { createAppServices, maybeGetAppServices } from '../app-services'
import { getChannelReadiness, isChannelReadinessStarted } from '../delivery/readiness'
import { DEFAULT_RUNTIME_ADAPTER_SUPPORT } from '../runtime-adapter-factory'
import { getSettings } from '../settings'
import type { CheckResult, InstallResult, OnboardingComponent } from './types'

const log = createLogger('onboarding:credentials')

const RUNTIME_DOCS = DEFAULT_RUNTIME_ADAPTER_SUPPORT.docsUrl

async function getRuntimeForCredentials(): Promise<AgentRuntimeAdapter> {
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

// ---------------------------------------------------------------------------
// LLM component
// ---------------------------------------------------------------------------

async function checkLlm(): Promise<CheckResult> {
  const runtime = await getRuntimeForCredentials()

  let status: RuntimeCredentialStatus
  try {
    status = await runtime.credentialStatus()
  } catch (err) {
    log.warn('Failed to read runtime credential status', err)
    return {
      name: 'llm',
      status: 'warn',
      message: `Could not read runtime credential status: ${err instanceof Error ? err.message : String(err)}`,
      remediation: `Fix or regenerate runtime credentials. Docs: ${RUNTIME_DOCS}`,
    }
  }

  const providers = status.llmProviders
  if (providers.length === 0) {
    return {
      name: 'llm',
      status: 'warn',
      message: 'No LLM provider with usable credentials is configured in the runtime',
      remediation: `Configure at least one LLM provider via the runtime adapter. Docs: ${RUNTIME_DOCS}`,
      details: { installUrl: RUNTIME_DOCS },
    }
  }
  return {
    name: 'llm',
    status: 'ok',
    message: `${providers.length} LLM provider${providers.length === 1 ? '' : 's'} configured: ${providers.join(', ')}`,
    details: { providers },
  }
}

async function installLlm(): Promise<InstallResult> {
  log.info('llm.install() is a noop - LLM credentials are user-managed by the runtime adapter')
  return {
    name: 'llm',
    status: 'noop',
    message: `LLM credentials must be configured via the runtime adapter. Docs: ${RUNTIME_DOCS}`,
    durationMs: 0,
  }
}

export const llmComponent: OnboardingComponent = {
  name: 'llm',
  check: checkLlm,
  install: installLlm,
}

// ---------------------------------------------------------------------------
// Channels component
// ---------------------------------------------------------------------------

/**
 * Channel readiness has ONE engine (#908 §4.10). This check speaks from it
 * in two modes:
 *
 * - server mode: inside the server process (the collector is started) the
 *   snapshot is read directly; from a CLI process a reachable server is
 *   asked over HTTP — so `bakin check channels` reports the SERVER's truth
 *   (its connection, its env token), never a local guess.
 * - configuration-only mode: no server is reachable. Settings + the local
 *   token slot are projected (native / disabled / missing_token /
 *   missing_guild / ready_to_connect) and the result SAYS SO — it never
 *   claims connected and never says "no channel layer".
 */
const SERVER_PROBE_TIMEOUT_MS = 3_000

function channelsBaseUrl(): string {
  return process.env.BAKIN_URL || `http://localhost:${process.env.PORT || 3737}`
}

function serverModeResult(readiness: ChannelReadiness, via: 'in-process' | 'http'): CheckResult {
  const { state } = readiness.connection
  const href = CHANNELS_SETTINGS_HREF
  const details = { mode: 'server', via, state, owner: readiness.owner, href, token: readiness.token }
  if (state === 'native') {
    const count = readiness.channels.items.length
    return {
      name: 'channels',
      status: 'ok',
      message: readiness.channels.error
        ? `The runtime (${readiness.runtime.adapter}) owns channel delivery; its channel list could not be read: ${readiness.channels.error.message}`
        : `The runtime (${readiness.runtime.adapter}) owns channel delivery — ${count} channel${count === 1 ? '' : 's'} listed.`,
      details: { ...details, channels: readiness.channels.items.map((channel) => channel.id) },
    }
  }
  if (state === 'connected') {
    const count = readiness.channels.items.length
    return {
      name: 'channels',
      status: 'ok',
      message: `Discord bridge connected — ${count} channel${count === 1 ? '' : 's'} across ${readiness.guilds.length} server${readiness.guilds.length === 1 ? '' : 's'}.`,
      details: { ...details, channels: readiness.channels.items.map((channel) => channel.id) },
    }
  }
  if (state === 'disabled') {
    return { name: 'channels', status: 'ok', message: 'Discord delivery is disabled — nothing to configure until it is enabled in Settings → Channels.', details }
  }
  const remediation = readiness.remediation
  return {
    name: 'channels',
    status: 'warn',
    message: remediation?.summary ?? `Channel delivery is ${state}.`,
    remediation: remediation ? `${remediation.nextStep} (${href})` : `Open Settings → Channels (${href}).`,
    details,
  }
}

function configurationOnlyResult(): CheckResult {
  const settings = getSettings()
  const discord = settings.integrations.discord
  const token = resolveSecretSlotStatus(SECRET_SLOT.discordBotToken)
  const projected = projectChannelReadiness({
    deliveryMode: settings.runtime.adapter === 'openclaw' ? 'native' : 'unavailable',
    enabled: discord.enabled,
    tokenPresent: token.present,
    guildCount: discord.guildIds.length,
  })
  const label = 'Server not running — configuration only; connection state unknown.'
  const details = { mode: 'configuration-only', projected, token, href: CHANNELS_SETTINGS_HREF }
  switch (projected) {
    case 'native':
      return { name: 'channels', status: 'ok', message: `${label} The runtime (${settings.runtime.adapter}) owns channel delivery.`, details }
    case 'disabled':
      return { name: 'channels', status: 'ok', message: `${label} Discord delivery is disabled.`, details }
    case 'ready_to_connect':
      return { name: 'channels', status: 'ok', message: `${label} Discord is configured here; the bridge connects when the server runs.`, details }
    case 'missing_token':
      return {
        name: 'channels',
        status: 'warn',
        message: `${label} Discord is enabled but no bot token is set in this environment or the Bakin store (a server-side environment token is not visible from here).`,
        remediation: `Add the token in Settings → Channels (${CHANNELS_SETTINGS_HREF}), or start the server and run this check again.`,
        details,
      }
    case 'missing_guild':
      return {
        name: 'channels',
        status: 'warn',
        message: `${label} Discord is enabled but no server (guild ID) is configured.`,
        remediation: `Add a guild ID in Settings → Channels (${CHANNELS_SETTINGS_HREF}).`,
        details,
      }
  }
}

async function fetchServerReadiness(): Promise<ChannelReadiness | null> {
  try {
    const response = await fetch(`${channelsBaseUrl()}/api/channels`, { signal: AbortSignal.timeout(SERVER_PROBE_TIMEOUT_MS) })
    if (!response.ok) return null
    return await response.json() as ChannelReadiness
  } catch (err) {
    log.debug('No reachable server for the channels check — configuration-only mode', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

async function checkChannels(): Promise<CheckResult> {
  if (isChannelReadinessStarted()) {
    return serverModeResult(getChannelReadiness(), 'in-process')
  }
  const remote = await fetchServerReadiness()
  if (remote) return serverModeResult(remote, 'http')
  return configurationOnlyResult()
}

async function installChannels(): Promise<InstallResult> {
  log.info('channels.install() is a noop - channel credentials are user-managed by the runtime adapter')
  return {
    name: 'channels',
    status: 'noop',
    message: `Channel credentials must be configured via the runtime adapter. Docs: ${RUNTIME_DOCS}`,
    durationMs: 0,
  }
}

export const channelsComponent: OnboardingComponent = {
  name: 'channels',
  check: checkChannels,
  install: installChannels,
}

export const RUNTIME_DOCS_URL = RUNTIME_DOCS
