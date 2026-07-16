/**
 * Canonical Health registrations contributed by the Pi adapter package.
 *
 * These probes are intentionally separate from AgentRuntimeAdapter: app
 * composition registers them with adapter ownership in the one Health
 * registry. Runs are diagnostic-only and never provision or repair Pi state.
 */
import { accessSync, constants, existsSync } from 'fs'

import type {
  ActionIncidentInput,
  HealthCheckRegistrationInput,
  HealthCheckRunInput,
  JsonObject,
  WatchIncidentInput,
} from '@bakin/core/plugin-types'

import { listAuthProviders } from './config'
import { getPiAgentsRoot, getPiHome, getPiRegistryPath } from './home'
import { getModelRegistry } from './models'
import { readRegistry } from './registry'
import { createExtensionsSurface } from './extensions'

const RUNTIME_GROUP = { key: 'runtime', label: 'Runtime' } as const

function observedHealthy(key: string, summary: string, evidence?: JsonObject): HealthCheckRunInput {
  return {
    outcome: 'observed',
    observations: [{ key, status: 'healthy', summary, evidence }],
  }
}

function observedError(
  key: string,
  summary: string,
  incident: ActionIncidentInput,
  detail?: string,
): HealthCheckRunInput {
  return {
    outcome: 'observed',
    observations: [{ key, status: 'error', summary, detail, incident }],
  }
}

function observedWarning(
  key: string,
  summary: string,
  incident: ActionIncidentInput,
  evidence?: JsonObject,
): HealthCheckRunInput {
  return {
    outcome: 'observed',
    observations: [{ key, status: 'warning', summary, evidence, incident }],
  }
}

function observedUnknown(
  key: string,
  summary: string,
  incident: WatchIncidentInput,
  detail?: string,
): HealthCheckRunInput {
  return {
    outcome: 'observed',
    observations: [{ key, status: 'unknown', summary, detail, incident }],
  }
}

function installationIncident(resourceId: 'pi.home' | 'pi.agents-root', resourceLabel: string): ActionIncidentInput {
  return {
    key: 'installation',
    disposition: 'action_required',
    title: 'Pi runtime files are unavailable',
    impact: 'Pi cannot load or create Bakin agent workspaces until its runtime directories are available.',
    resources: [{ kind: 'directory', id: resourceId, label: resourceLabel }],
    resolution: {
      key: 'initialize-pi',
      type: 'instructions',
      label: 'Initialize Pi',
      steps: [
        'Install Pi if it is not already installed.',
        'Run Pi once and confirm its agent directory is writable by the Bakin process.',
        'Rerun Health checks.',
      ],
      command: 'pi',
    },
  }
}

function providerConfigurationIncident(): ActionIncidentInput {
  return {
    key: 'provider-configuration',
    disposition: 'action_required',
    title: 'Pi has no usable model provider',
    impact: 'Pi cannot serve agent turns until at least one authenticated model is available.',
    resources: [
      { kind: 'file', id: 'pi.auth', label: 'Pi provider authentication' },
      { kind: 'capability', id: 'runtime.models', label: 'Runtime models' },
    ],
    resolution: {
      key: 'configure-provider',
      type: 'instructions',
      label: 'Configure a Pi provider',
      steps: [
        'Run Pi and sign in to, or add an API key for, a model provider.',
        'Confirm at least one model is available.',
        'Rerun Health checks.',
      ],
      command: 'pi',
    },
  }
}

/** Independent Pi signals registered by the application composition root. */
export function createPiHealthChecks(
  getSettings: () => Record<string, unknown> | undefined,
): HealthCheckRegistrationInput[] {
  return [
    {
      id: 'home',
      name: 'Pi home and agent registry',
      description: 'Verifies that the Pi home exists and Bakin can read its Pi agent registry.',
      group: RUNTIME_GROUP,
      run: async () => {
        const home = getPiHome()
        if (!existsSync(home)) {
          return observedError(
            'home',
            `Pi home is missing at ${home}.`,
            installationIncident('pi.home', 'Pi home'),
          )
        }

        try {
          const registry = readRegistry()
          return observedHealthy(
            'home',
            `Pi home is available with ${registry.agents.length} registered Bakin agent${registry.agents.length === 1 ? '' : 's'}.`,
            { home, registryPath: getPiRegistryPath(), registeredAgents: registry.agents.length },
          )
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          return observedError(
            'home',
            'The Pi agent registry cannot be read.',
            {
              key: 'agent-registry',
              disposition: 'action_required',
              title: 'Pi agent registry is unreadable',
              impact: 'Bakin cannot safely resolve the Pi agent roster or its workspaces.',
              resources: [{ kind: 'file', id: 'pi.registry', label: 'Pi agent registry' }],
              resolution: {
                key: 'repair-registry',
                type: 'instructions',
                label: 'Repair the Pi agent registry',
                steps: [
                  'Inspect the Pi agent registry for invalid JSON or an unsupported shape.',
                  'Restore a valid registry or recover it from backup.',
                  'Rerun Health checks.',
                ],
              },
            },
            detail,
          )
        }
      },
    },
    {
      id: 'agents-root',
      name: 'Pi agent workspace directory',
      description: 'Verifies that the Pi agent workspace root exists and is writable without modifying it.',
      group: RUNTIME_GROUP,
      run: async () => {
        const root = getPiAgentsRoot()
        try {
          accessSync(root, constants.W_OK)
          return observedHealthy(
            'agents-root',
            'The Pi agent workspace root is writable.',
            { path: root },
          )
        } catch (err) {
          return observedError(
            'agents-root',
            `The Pi agent workspace root is not writable at ${root}.`,
            installationIncident('pi.agents-root', 'Pi agent workspace root'),
            err instanceof Error ? err.message : String(err),
          )
        }
      },
    },
    {
      id: 'auth',
      name: 'Pi provider authentication',
      description: 'Verifies that Pi has authentication configured for at least one model provider.',
      group: RUNTIME_GROUP,
      run: async () => {
        const providers = listAuthProviders()
        if (providers.length === 0) {
          return observedError(
            'auth',
            'Pi has no configured model-provider authentication.',
            providerConfigurationIncident(),
          )
        }
        return observedHealthy(
          'auth',
          `Pi authentication is configured for ${providers.join(', ')}.`,
          { providers },
        )
      },
    },
    {
      id: 'models',
      name: 'Pi model availability',
      description: 'Refreshes the Pi model registry and verifies that at least one authenticated model is available.',
      group: RUNTIME_GROUP,
      run: async () => {
        try {
          const { registry } = getModelRegistry()
          registry.refresh()
          const available = registry.getAvailable()
          if (available.length === 0) {
            return observedError(
              'models',
              'Pi has no models with configured authentication.',
              providerConfigurationIncident(),
            )
          }
          return observedHealthy(
            'models',
            `${available.length} Pi model${available.length === 1 ? ' is' : 's are'} available.`,
            { availableModels: available.length },
          )
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          return observedError(
            'models',
            'The Pi model registry could not be refreshed.',
            {
              key: 'model-registry',
              disposition: 'action_required',
              title: 'Pi model registry failed',
              impact: 'Bakin cannot determine which Pi models are available for agent turns.',
              resources: [
                { kind: 'file', id: 'pi.models', label: 'Pi model configuration' },
                { kind: 'capability', id: 'runtime.models', label: 'Runtime models' },
              ],
              resolution: {
                key: 'repair-model-config',
                type: 'instructions',
                label: 'Repair Pi model configuration',
                steps: [
                  'Inspect Pi model and provider configuration for invalid entries.',
                  'Correct the configuration or restore a known-good copy.',
                  'Rerun Health checks.',
                ],
                command: 'pi',
              },
            },
            detail,
          )
        }
      },
    },
    {
      id: 'extensions',
      name: 'Pi extension trust',
      description: 'Verifies that installed Pi extensions follow the active trust policy and highlights approvals still awaiting review.',
      group: RUNTIME_GROUP,
      run: async () => {
        try {
          const extensions = await createExtensionsSurface(getSettings).list()
          const pending = extensions.filter((extension) => extension.status === 'pending')
          const evidence = {
            installedExtensions: extensions.length,
            allowedExtensions: extensions.filter((extension) => extension.status === 'allowed').length,
            blockedExtensions: extensions.filter((extension) => extension.status === 'blocked').length,
            pendingExtensions: pending.length,
          }
          if (pending.length === 0) {
            return observedHealthy(
              'extensions',
              extensions.length === 0
                ? 'No Pi extensions are installed.'
                : `${extensions.length} Pi extension${extensions.length === 1 ? ' is' : 's are'} governed by the active trust policy with no approvals pending.`,
              evidence,
            )
          }
          return observedWarning(
            'extensions',
            `${pending.length} Pi extension${pending.length === 1 ? ' is' : 's are'} installed but will not load until approved.`,
            {
              key: 'extension-approval',
              disposition: 'action_required',
              title: 'Pi extensions are awaiting approval',
              impact: 'Pending extension code remains disabled until an operator reviews and approves it.',
              resources: [{ kind: 'capability', id: 'runtime.extensions', label: 'Pi extension trust' }],
              resolution: {
                key: 'review-extensions',
                type: 'navigate',
                label: 'Review Pi extensions',
                href: '/runtime?tab=runtimes',
              },
            },
            {
              ...evidence,
              pendingLabels: pending.slice(0, 20).map((extension) => extension.label),
            },
          )
        } catch (err) {
          return observedUnknown(
            'extensions',
            'Pi extension trust could not be verified.',
            {
              key: 'extension-discovery',
              disposition: 'watch',
              title: 'Pi extension discovery is unavailable',
              impact: 'Bakin cannot confirm which Pi extensions are installed or awaiting approval.',
              resources: [{ kind: 'capability', id: 'runtime.extensions', label: 'Pi extension trust' }],
              resolution: { key: 'rerun', type: 'rerun', label: 'Rerun Health checks' },
            },
            err instanceof Error ? err.message : String(err),
          )
        }
      },
    },
  ]
}
