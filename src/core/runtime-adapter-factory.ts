import type { AgentRuntimeAdapter, RuntimeCompatibility } from '@bakin/core/adapters/runtime'
import type { HealthCheckRegistrationInput } from '@bakin/core/plugin-types'
import { createOpenClawHealthChecks, createOpenClawRuntimeAdapter, isOpenClawPresent } from '@bakin/adapter-openclaw'
import { createPiHealthChecks, createPiRuntimeAdapter, isPiPresent, PI_CLI_INSTALL_HINT } from '@bakin/adapter-pi'
import { withModelAvailabilityObservation } from './model-availability'
import type { RuntimeAdapterName } from './settings'

export interface RuntimeAdapterSupportInfo {
  /** The runtime's name as people write it. */
  label: string
  /** One line on what choosing it means, for a first-run choice. */
  summary: string
  setupUrl: string
  docsUrl: string
  /** What to do when the runtime itself cannot be used. One sentence, no URL. */
  setupHint: string
  /** How to log a provider in. Bakin never handles the secret; the operator does this in the runtime. */
  loginSteps: readonly string[]
}

const RUNTIME_ADAPTER_SUPPORT: Record<RuntimeAdapterName, RuntimeAdapterSupportInfo> = {
  openclaw: {
    label: 'OpenClaw',
    summary: 'A separate gateway you install and run alongside Bakin.',
    setupUrl: 'https://makinbakin.com/docs/start/first-time-setup/',
    docsUrl: 'https://openclaw.ai/docs/',
    setupHint: 'Install OpenClaw and start its gateway, then rerun onboarding.',
    loginSteps: [
      'Add a provider login in OpenClaw (its docs cover each provider).',
      'Make sure the OpenClaw gateway is running.',
    ],
  },
  pi: {
    label: 'Pi',
    summary: 'Runs inside Bakin; nothing else to install.',
    setupUrl: 'https://pi.dev/docs/latest/quickstart',
    docsUrl: 'https://pi.dev/docs/latest',
    setupHint: 'Pi runs inside Bakin and needs no separate install; if it cannot start, check the Pi home it reports.',
    loginSteps: [
      `Open another terminal and run \`pi\`. ${PI_CLI_INSTALL_HINT}`,
      'Type `/login` and pick a provider (there is no `pi login` command).',
      'Finish the sign-in, then quit pi.',
    ],
  },
}

export function createRuntimeAdapter(name: RuntimeAdapterName): AgentRuntimeAdapter {
  // Every adapter is observed at this single composition point (#852):
  // model rejections/successes become durable availability evidence for
  // ALL consumers — AppServices.runtime and every plugin ctx.runtime bind
  // the same wrapped instance.
  switch (name) {
    case 'openclaw':
      return withModelAvailabilityObservation(createOpenClawRuntimeAdapter())
    case 'pi':
      return withModelAvailabilityObservation(createPiRuntimeAdapter())
    default:
      throw new Error(`Unknown runtime adapter: ${name}`)
  }
}

/**
 * Canonical Health registrations are composed beside an adapter, never
 * exposed as methods on the runtime contract itself. `adapter` is the LIVE
 * (wrapped) instance — OpenClaw's override-authorization check reads its
 * dynamic routingSupport() (#880).
 */
export function createRuntimeAdapterHealthChecks(
  name: RuntimeAdapterName,
  getRuntimeSettings: () => Record<string, unknown> | undefined,
  adapter?: AgentRuntimeAdapter,
): HealthCheckRegistrationInput[] {
  switch (name) {
    case 'pi':
      return createPiHealthChecks(getRuntimeSettings)
    case 'openclaw': {
      // Without the adapter instance (read-only CLI composition) there is nothing to observe — no stub checks.
      if (!adapter) return []
      // Adapter-specific evidence accessors (duck-typed through the
      // availability Proxy — not contract members): scopesVerified false =
      // the check reports unknown, never healthy, pre-connect; the probe is
      // a bounded fresh handshake for a rerun whose cached verdict is not ok.
      const evidence = adapter as unknown as { gatewayScopesVerified?: () => boolean; probeGatewayCompatibility?: () => Promise<RuntimeCompatibility> }
      const probe = evidence.probeGatewayCompatibility
      // Status-only inventory (optional contract member) for the provider-configuration check.
      const credentials = adapter.credentials
      return createOpenClawHealthChecks({
        routingSupport: () => adapter.models.routingSupport(),
        scopesVerified: () => evidence.gatewayScopesVerified?.() ?? false,
        ...(probe ? { probeCompatibility: () => probe.call(adapter) } : {}),
        ...(credentials ? { credentials: () => credentials.providers() } : {}),
      })
    }
    default:
      throw new Error(`Unknown runtime adapter: ${name}`)
  }
}

export function getRuntimeAdapterSupport(name: RuntimeAdapterName): RuntimeAdapterSupportInfo {
  const support = RUNTIME_ADAPTER_SUPPORT[name]
  if (!support) throw new Error(`Unknown runtime adapter: ${name}`)
  return support
}

/**
 * Which supported runtimes are set up on this machine. Each adapter owns
 * its own read-only presence probe (one stat inside its own home); this
 * only composes them. The order is fixed, so a result is the same on every
 * run and a message that lists what was found is stable.
 */
const RUNTIME_PRESENCE_PROBES: ReadonlyArray<readonly [RuntimeAdapterName, () => boolean]> = [
  ['openclaw', isOpenClawPresent],
  ['pi', isPiPresent],
]

export function detectRuntimes(): RuntimeAdapterName[] {
  return RUNTIME_PRESENCE_PROBES.filter(([, present]) => present()).map(([name]) => name)
}

/** The one registry of adapter names — consumers derive, never duplicate. */
export function getSupportedRuntimeAdapterNames(): RuntimeAdapterName[] {
  return Object.keys(RUNTIME_ADAPTER_SUPPORT) as RuntimeAdapterName[]
}
