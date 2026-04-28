/**
 * credentials component — warn-only checks for LLM providers and
 * messaging channels configured in OpenClaw's own files.
 *
 * Bakin does NOT prompt users to paste secrets (that would be OpenClaw's
 * territory — OpenClaw has its own `openclaw setup` flow that knows
 * about Anthropic keys, Discord bot tokens, guild IDs, etc.). What this
 * module does is *verify* that OpenClaw has at least one provider and
 * one channel configured, so we can tell a new user "your agents won't
 * be able to reach any LLM until you run OpenClaw's setup" instead of
 * letting them discover that from a broken dispatch at 3am.
 *
 * Both checks are **warn-only** — they never return `error`, and
 * `install()` is always a noop with a remediation pointer. The
 * orchestrator in T9 writes `components.llm: "warn"` and
 * `components.channels: "warn"` to the .onboarded marker on decline;
 * Bakin still starts.
 */
import { selectRuntimeMainAgent, type AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createLogger } from '../logger'
import { createAppServices, maybeGetAppServices } from '../app-services'
import type { CheckResult, InstallResult, OnboardingComponent } from './types'

const log = createLogger('onboarding:credentials')

const OPENCLAW_DOCS = 'https://openclaw.ai/docs/'

/**
 * Fields on a channel entry in openclaw.json that count as "a credential
 * is present." OpenClaw's own channel drivers accept different key names
 * (token for Discord/Slack, apiKey for some skill plugins, etc.) so we
 * check for any of them.
 */
const CHANNEL_CREDENTIAL_FIELDS = ['token', 'apiKey', 'api_key', 'botToken', 'bot_token']

function hasCredentialField(entry: unknown): boolean {
  if (entry === null || typeof entry !== 'object') return false
  const obj = entry as Record<string, unknown>
  for (const field of CHANNEL_CREDENTIAL_FIELDS) {
    const value = obj[field]
    if (typeof value === 'string' && value.trim().length > 0) return true
  }
  return false
}

async function getRuntimeForCredentials(): Promise<AgentRuntimeAdapter> {
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

async function readRuntimeRaw<T>(runtime: AgentRuntimeAdapter, key: string, reason: string): Promise<T | null> {
  const value = await runtime.config.raw<T | null>(key, reason)
  return value ?? null
}

// ---------------------------------------------------------------------------
// LLM component
// ---------------------------------------------------------------------------

async function checkLlm(): Promise<CheckResult> {
  const runtime = await getRuntimeForCredentials()
  const mainAgent = selectRuntimeMainAgent(await runtime.agents.list())
  const mainAgentId = mainAgent?.id ?? 'main'
  const configKey = `agents.${mainAgentId}.authProfiles`
  const configLabel = `runtime auth profiles for ${mainAgentId}`

  let parsed: unknown
  try {
    parsed = await readRuntimeRaw<unknown>(runtime, configKey, 'onboarding.llm.check')
  } catch (err) {
    log.warn('Failed to read runtime auth profiles', err)
    return {
      name: 'llm',
      status: 'warn',
      message: `Could not parse ${configLabel}: ${err instanceof Error ? err.message : String(err)}`,
      remediation: `Fix or regenerate credentials via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configKey },
    }
  }

  if (parsed === null) {
    return {
      name: 'llm',
      status: 'warn',
      message: `No LLM provider configured — ${configLabel} is missing`,
      remediation: `Configure at least one LLM provider via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configKey, installUrl: OPENCLAW_DOCS },
    }
  }

  // OpenClaw has produced multiple shapes over its versions:
  //   1. Bare array:   [{ provider, apiKey }]       (imitation crab)
  //   2. Object+array: { profiles: [{ provider }] } (docker setup)
  //   3. Object+dict:  { profiles: { k: { provider } } }
  // Normalize into a flat array of entry objects for scanning.
  let entries: unknown[]
  if (Array.isArray(parsed)) {
    entries = parsed
  } else if (parsed !== null && typeof parsed === 'object') {
    const inner = (parsed as Record<string, unknown>).profiles
    if (Array.isArray(inner)) {
      entries = inner
    } else if (inner !== null && typeof inner === 'object') {
      entries = Object.values(inner as Record<string, unknown>)
    } else {
      entries = []
    }
  } else {
    entries = []
  }
  if (entries.length === 0) {
    return {
      name: 'llm',
      status: 'warn',
      message: `auth profiles have no provider entries`,
      remediation: `Configure at least one LLM provider via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configKey },
    }
  }
  const providers = entries
    .filter((p): p is { provider?: string; apiKey?: string } => p !== null && typeof p === 'object')
    .filter((p) => typeof p.provider === 'string' && typeof p.apiKey === 'string' && p.apiKey.trim().length > 0)
    .map((p) => p.provider as string)
  if (providers.length === 0) {
    return {
      name: 'llm',
      status: 'warn',
      message: 'No LLM provider in auth profiles has a non-empty apiKey',
      remediation: `Configure at least one LLM provider via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configKey, installUrl: OPENCLAW_DOCS },
    }
  }
  return {
    name: 'llm',
    status: 'ok',
    message: `${providers.length} LLM provider${providers.length === 1 ? '' : 's'} configured: ${providers.join(', ')}`,
    details: { configKey, providers },
  }
}

async function installLlm(): Promise<InstallResult> {
  log.info('llm.install() is a noop — LLM credentials are user-managed via OpenClaw')
  return {
    name: 'llm',
    status: 'noop',
    message: `LLM credentials must be configured via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
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

async function checkChannels(): Promise<CheckResult> {
  const runtime = await getRuntimeForCredentials()
  const configKey = 'channels'

  let channels: unknown
  try {
    channels = await readRuntimeRaw<unknown>(runtime, configKey, 'onboarding.channels.check')
  } catch (err) {
    log.warn('Failed to read runtime channels config', err)
    return {
      name: 'channels',
      status: 'warn',
      message: `Could not parse runtime channels config: ${err instanceof Error ? err.message : String(err)}`,
      remediation: `Fix or regenerate channel credentials via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configKey },
    }
  }

  if (channels === null) {
    return {
      name: 'channels',
      status: 'warn',
      message: `No messaging channels configured — runtime channels config is missing`,
      remediation: `Configure at least one channel (Discord, Telegram, Slack) via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configKey, installUrl: OPENCLAW_DOCS },
    }
  }
  if (typeof channels !== 'object' || channels === null) {
    return {
      name: 'channels',
      status: 'warn',
      message: `runtime channels config is not an object`,
      remediation: `Check the config shape or regenerate it via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configKey },
    }
  }
  const configured = Object.entries(channels)
    .filter(([, entry]) => hasCredentialField(entry))
    .map(([name]) => name)
  if (configured.length === 0) {
    return {
      name: 'channels',
      status: 'warn',
      message: 'No messaging channel in runtime config has a non-empty credential field',
      remediation: `Configure at least one channel (Discord, Telegram, Slack) via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configKey, installUrl: OPENCLAW_DOCS },
    }
  }
  return {
    name: 'channels',
    status: 'ok',
    message: `${configured.length} channel${configured.length === 1 ? '' : 's'} configured: ${configured.join(', ')}`,
    details: { configKey, channels: configured },
  }
}

async function installChannels(): Promise<InstallResult> {
  log.info('channels.install() is a noop — channel credentials are user-managed via OpenClaw')
  return {
    name: 'channels',
    status: 'noop',
    message: `Channel credentials must be configured via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
    durationMs: 0,
  }
}

export const channelsComponent: OnboardingComponent = {
  name: 'channels',
  check: checkChannels,
  install: installChannels,
}

export const OPENCLAW_DOCS_URL = OPENCLAW_DOCS
export const _internals = { CHANNEL_CREDENTIAL_FIELDS, hasCredentialField }
