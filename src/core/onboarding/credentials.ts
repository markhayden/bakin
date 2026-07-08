/**
 * credentials component - warn-only checks for LLM providers and
 * messaging channels configured in the active runtime adapter.
 *
 * Bakin does NOT prompt users to paste secrets. That is the runtime
 * adapter's territory. This module only verifies that the runtime has
 * at least one provider and
 * one channel configured, so we can tell a new user "your agents won't
 * be able to reach any LLM until you configure the runtime" instead of
 * letting them discover that from a broken dispatch at 3am.
 *
 * Both checks are **warn-only** - they never return `error`, and
 * `install()` is always a noop with a remediation pointer. The
 * orchestrator in T9 writes `components.llm: "warn"` and
 * `components.channels: "warn"` to the .onboarded marker on decline;
 * Bakin still starts.
 */
import { selectRuntimeMainAgent, type AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createLogger } from '../logger'
import { createAppServices, maybeGetAppServices } from '../app-services'
import { DEFAULT_RUNTIME_ADAPTER_SUPPORT } from '../runtime-adapter-factory'
import { readAllowedRuntimeConfigRaw, type RuntimeConfigRawReason } from '../runtime-config-raw'
import {
  LLM_CREDENTIAL_FIELDS,
  authProfileEntryHasField,
  authProfileEntryProvider,
  normalizeAuthProfileEntries,
} from '../runtime-auth-profiles'
import type { CheckResult, InstallResult, OnboardingComponent } from './types'

const log = createLogger('onboarding:credentials')

const RUNTIME_DOCS = DEFAULT_RUNTIME_ADAPTER_SUPPORT.docsUrl

/**
 * Fields on a runtime channel entry that count as "a credential is present."
 * Channel drivers accept different key names (token for chat providers, apiKey
 * for some skill plugins, etc.) so we
 * check for any of them.
 */
const CHANNEL_CREDENTIAL_FIELDS = ['token', 'apiKey', 'api_key', 'botToken', 'bot_token']

function hasCredentialField(entry: unknown): boolean {
  return authProfileEntryHasField(entry, CHANNEL_CREDENTIAL_FIELDS)
}

function authProvider(entry: unknown): string | null {
  const provider = authProfileEntryProvider(entry)
  if (provider === null) return null
  return authProfileEntryHasField(entry, LLM_CREDENTIAL_FIELDS) ? provider : null
}

async function getRuntimeForCredentials(): Promise<AgentRuntimeAdapter> {
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

async function readRuntimeRaw<T>(
  runtime: AgentRuntimeAdapter,
  key: string,
  reason: RuntimeConfigRawReason,
): Promise<T | null> {
  return readAllowedRuntimeConfigRaw<T>(runtime, key, reason)
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
      remediation: `Fix or regenerate runtime credentials. Docs: ${RUNTIME_DOCS}`,
      details: { configKey },
    }
  }

  if (parsed === null) {
    return {
      name: 'llm',
      status: 'warn',
      message: `No LLM provider configured — ${configLabel} is missing`,
      remediation: `Configure at least one LLM provider via the runtime adapter. Docs: ${RUNTIME_DOCS}`,
      details: { configKey, installUrl: RUNTIME_DOCS },
    }
  }

  // Shape normalization is shared with the models plugin's billing-lane
  // detection — see src/core/runtime-auth-profiles.ts.
  const entries = normalizeAuthProfileEntries(parsed)
  if (entries.length === 0) {
    return {
      name: 'llm',
      status: 'warn',
      message: `auth profiles have no provider entries`,
      remediation: `Configure at least one LLM provider via the runtime adapter. Docs: ${RUNTIME_DOCS}`,
      details: { configKey },
    }
  }
  const providers = entries
    .map(authProvider)
    .filter((provider): provider is string => provider !== null)
  if (providers.length === 0) {
    return {
      name: 'llm',
      status: 'warn',
      message: 'No LLM provider in auth profiles has usable API key, token, or OAuth credentials',
      remediation: `Configure at least one LLM provider via the runtime adapter. Docs: ${RUNTIME_DOCS}`,
      details: { configKey, installUrl: RUNTIME_DOCS },
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
      remediation: `Fix or regenerate runtime channel credentials. Docs: ${RUNTIME_DOCS}`,
      details: { configKey },
    }
  }

  if (channels === null) {
    return {
      name: 'channels',
      status: 'warn',
      message: `No messaging channels configured — runtime channels config is missing`,
      remediation: `Configure at least one runtime channel. Docs: ${RUNTIME_DOCS}`,
      details: { configKey, installUrl: RUNTIME_DOCS },
    }
  }
  if (typeof channels !== 'object' || channels === null) {
    return {
      name: 'channels',
      status: 'warn',
      message: `runtime channels config is not an object`,
      remediation: `Check the config shape or regenerate it through the runtime adapter. Docs: ${RUNTIME_DOCS}`,
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
      remediation: `Configure at least one runtime channel. Docs: ${RUNTIME_DOCS}`,
      details: { configKey, installUrl: RUNTIME_DOCS },
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
export const _internals = { CHANNEL_CREDENTIAL_FIELDS, LLM_CREDENTIAL_FIELDS, hasCredentialField, authProvider }
