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
import { createLogger } from '../logger'
import { createAppServices, maybeGetAppServices } from '../app-services'
import { DEFAULT_RUNTIME_ADAPTER_SUPPORT } from '../runtime-adapter-factory'
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

async function checkChannels(): Promise<CheckResult> {
  const runtime = await getRuntimeForCredentials()

  // Optional capability (P2.1): a runtime without a channel layer has no
  // channel credentials to configure — by design, not a degraded state.
  if (!runtime.channels) {
    return {
      name: 'channels',
      status: 'ok',
      message: 'The active runtime has no channel layer — no channel credentials to configure.',
    }
  }

  let status: RuntimeCredentialStatus
  try {
    status = await runtime.credentialStatus()
  } catch (err) {
    log.warn('Failed to read runtime credential status', err)
    return {
      name: 'channels',
      status: 'warn',
      message: `Could not read runtime credential status: ${err instanceof Error ? err.message : String(err)}`,
      remediation: `Fix or regenerate runtime channel credentials. Docs: ${RUNTIME_DOCS}`,
    }
  }

  const configured = status.channels
  if (configured.length === 0) {
    return {
      name: 'channels',
      status: 'warn',
      message: 'No messaging channel with usable credentials is configured in the runtime',
      remediation: `Configure at least one runtime channel. Docs: ${RUNTIME_DOCS}`,
      details: { installUrl: RUNTIME_DOCS },
    }
  }
  return {
    name: 'channels',
    status: 'ok',
    message: `${configured.length} channel${configured.length === 1 ? '' : 's'} configured: ${configured.join(', ')}`,
    details: { channels: configured },
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
