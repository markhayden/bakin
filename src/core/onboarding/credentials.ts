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
import { existsSync, readFileSync } from 'fs'
import { createLogger } from '../logger'
import { getMainAgentId } from '@bakin/core/main-agent'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

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

// ---------------------------------------------------------------------------
// LLM component
// ---------------------------------------------------------------------------

async function checkLlm(): Promise<CheckResult> {
  const profilePath = getOpenClawPath('agents', getMainAgentId(), 'agent', 'auth-profiles.json')

  if (!existsSync(profilePath)) {
    return {
      name: 'llm',
      status: 'warn',
      message: `No LLM provider configured — ${profilePath} is missing`,
      remediation: `Configure at least one LLM provider via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { profilePath, installUrl: OPENCLAW_DOCS },
    }
  }

  try {
    const raw = readFileSync(profilePath, 'utf-8')
    const parsed = JSON.parse(raw)
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
        message: `auth-profiles.json has no provider entries`,
        remediation: `Configure at least one LLM provider via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
        details: { profilePath },
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
        message: 'No LLM provider in auth-profiles.json has a non-empty apiKey',
        remediation: `Configure at least one LLM provider via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
        details: { profilePath, installUrl: OPENCLAW_DOCS },
      }
    }
    return {
      name: 'llm',
      status: 'ok',
      message: `${providers.length} LLM provider${providers.length === 1 ? '' : 's'} configured: ${providers.join(', ')}`,
      details: { profilePath, providers },
    }
  } catch (err) {
    log.warn('Failed to read auth-profiles.json', err)
    return {
      name: 'llm',
      status: 'warn',
      message: `Could not parse ${profilePath}: ${err instanceof Error ? err.message : String(err)}`,
      remediation: `Fix or regenerate the file via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { profilePath },
    }
  }
}

async function installLlm(_opts: OnboardingOptions): Promise<InstallResult> {
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
  const configPath = getOpenClawPath('openclaw.json')

  if (!existsSync(configPath)) {
    return {
      name: 'channels',
      status: 'warn',
      message: `No messaging channels configured — ${configPath} is missing`,
      remediation: `Configure at least one channel (Discord, Telegram, Slack) via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configPath, installUrl: OPENCLAW_DOCS },
    }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as { channels?: Record<string, unknown> }
    const channels = parsed.channels ?? {}
    if (typeof channels !== 'object' || channels === null) {
      return {
        name: 'channels',
        status: 'warn',
        message: `openclaw.json "channels" key is not an object`,
        remediation: `Check the file's shape or regenerate it via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
        details: { configPath },
      }
    }
    const configured = Object.entries(channels)
      .filter(([, entry]) => hasCredentialField(entry))
      .map(([name]) => name)
    if (configured.length === 0) {
      return {
        name: 'channels',
        status: 'warn',
        message: 'No messaging channel in openclaw.json has a non-empty credential field',
        remediation: `Configure at least one channel (Discord, Telegram, Slack) via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
        details: { configPath, installUrl: OPENCLAW_DOCS },
      }
    }
    return {
      name: 'channels',
      status: 'ok',
      message: `${configured.length} channel${configured.length === 1 ? '' : 's'} configured: ${configured.join(', ')}`,
      details: { configPath, channels: configured },
    }
  } catch (err) {
    log.warn('Failed to read openclaw.json', err)
    return {
      name: 'channels',
      status: 'warn',
      message: `Could not parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      remediation: `Fix or regenerate the file via OpenClaw. Docs: ${OPENCLAW_DOCS}`,
      details: { configPath },
    }
  }
}

async function installChannels(_opts: OnboardingOptions): Promise<InstallResult> {
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
