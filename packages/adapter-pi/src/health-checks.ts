/**
 * Canonical Health registrations contributed by the Pi adapter package.
 *
 * These probes are intentionally separate from AgentRuntimeAdapter: app
 * composition registers them with adapter ownership in the one Health
 * registry. Runs are diagnostic-only and never provision or repair Pi state.
 *
 * Three-outcomes contract (self-healing 1.7, re-homing rows 196–201): every
 * incident is either a human need with the control it lands on — an install
 * or a sign-in the operator performs in a shell rides a `handoff` the Health
 * card hands to a Terminal session — or `core.diagnose` for what only an
 * investigation can explain. A state Bakin merely could not see is a plain
 * observation, never a card.
 */
import { accessSync, constants, existsSync } from 'fs'

import type {
  ActionIncidentInput,
  HealthCheckRegistrationInput,
  HealthCheckRunInput,
  HealthIncidentDeclaration,
  HealthSubject,
  JsonObject,
} from '@bakin/core/plugin-types'

import { healthError, healthHealthy, healthObserved, healthUnknown, healthWarning } from '@bakin/core/health/observation-builders'
import { listAuthProviders } from './config'
import { getPiAgentsRoot, getPiHome, getPiRegistryPath } from './home'
import { getModelRegistry } from './models'
import { readRegistry } from './registry'
import { createExtensionsSurface } from './extensions'

const RUNTIME_GROUP = { key: 'runtime', label: 'Runtime' } as const

/** Every Pi incident is about the Pi runtime (row subject `runtime:pi`). */
export const PI_SUBJECT: HealthSubject = { kind: 'runtime', id: 'pi', label: 'Pi' }

/** The npm package the in-process adapter pins; installing it globally is the shell-side install the handoff names. */
export const PI_INSTALL_COMMAND = 'npm install -g @earendil-works/pi-coding-agent'
/** Pi signs in from its own TUI (`/login`); there is no `pi login` subcommand. */
export const PI_LOGIN_COMMAND = 'pi'

/** Row 196: Pi files unavailable → human external-install (Terminal handoff with the install command). */
export const PI_INSTALLATION_FAMILY: HealthIncidentDeclaration = { id: 'installation', subjectKind: 'runtime', resolution: { type: 'human', needs: 'external-install' }, required: 'owner-decides' }
/** Row 197: registry unreadable → the fallback lane. */
export const PI_AGENT_REGISTRY_FAMILY: HealthIncidentDeclaration = { id: 'agent-registry', subjectKind: 'runtime', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' }
/** Row 198: no provider → human credential (Pi `/login`, Terminal handoff naming provider + home). */
export const PI_PROVIDER_CONFIGURATION_FAMILY: HealthIncidentDeclaration = { id: 'provider-configuration', subjectKind: 'runtime', resolution: { type: 'human', needs: 'credential' }, required: 'always' }
/** Row 199: model registry failed → the fallback lane. */
export const PI_MODEL_REGISTRY_FAMILY: HealthIncidentDeclaration = { id: 'model-registry', subjectKind: 'runtime', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' }
/** Row 200: extensions awaiting approval → human decision (`/runtime?tab=runtimes` Allow); required only while something needs the extension. */
export const PI_EXTENSION_APPROVAL_FAMILY: HealthIncidentDeclaration = { id: 'extension-approval', subjectKind: 'runtime', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' }

/** Catalog per registration (each Pi probe registers on its own). Row 201 (extension-discovery) is an observation — no family. */
export const PI_HOME_INCIDENTS: HealthIncidentDeclaration[] = [PI_INSTALLATION_FAMILY, PI_AGENT_REGISTRY_FAMILY]
export const PI_AGENTS_ROOT_INCIDENTS: HealthIncidentDeclaration[] = [PI_INSTALLATION_FAMILY]
export const PI_AUTH_INCIDENTS: HealthIncidentDeclaration[] = [PI_PROVIDER_CONFIGURATION_FAMILY]
export const PI_MODELS_INCIDENTS: HealthIncidentDeclaration[] = [PI_PROVIDER_CONFIGURATION_FAMILY, PI_MODEL_REGISTRY_FAMILY]
export const PI_EXTENSIONS_INCIDENTS: HealthIncidentDeclaration[] = [PI_EXTENSION_APPROVAL_FAMILY]

// Route through the shared clamped builders — raw observation literals
// bypass the copy-bounds protection (an overlong interpolated error would
// invalidate the whole run instead of truncating; review finding).
function observedHealthy(key: string, summary: string, evidence?: JsonObject): HealthCheckRunInput {
  return healthObserved([healthHealthy({ key, summary, evidence })])
}

function observedError(
  key: string,
  summary: string,
  incident: ActionIncidentInput,
  detail?: string,
): HealthCheckRunInput {
  return healthObserved([healthError({ key, summary, detail, incident })])
}

function observedWarning(
  key: string,
  summary: string,
  incident: ActionIncidentInput,
  evidence?: JsonObject,
): HealthCheckRunInput {
  return healthObserved([healthWarning({ key, summary, evidence, incident })])
}

/** A state Bakin could not see: listed under the check, never a card; the check's `maxAgeMs` re-runs it. */
function observedUnknown(key: string, summary: string, detail?: string): HealthCheckRunInput {
  return healthObserved([healthUnknown({ key, summary, detail })])
}

/**
 * Row 196. These probes only register while Pi is the active adapter, so the
 * subject is required by construction (`AR while Pi is active`).
 */
function installationIncident(resourceId: 'pi.home' | 'pi.agents-root', resourceLabel: string): ActionIncidentInput {
  return {
    key: 'installation',
    declarationId: PI_INSTALLATION_FAMILY.id,
    disposition: 'action_required',
    subject: PI_SUBJECT,
    required: true,
    title: 'Pi runtime files are unavailable',
    impact: `Pi cannot load or create Bakin agent workspaces until its runtime directories are available. Install Pi (or run it once so it creates its home at ${getPiHome()}) and make sure the directory is writable by the Bakin process; Health re-checks when you return.`,
    resources: [{ kind: 'directory', id: resourceId, label: resourceLabel }],
    resolution: {
      key: 'initialize-pi',
      type: 'human',
      needs: 'external-install',
      label: 'Install Pi',
      href: '/runtime?tab=runtimes',
      handoff: { command: PI_INSTALL_COMMAND },
    },
  }
}

/** Row 198. The handoff names the sign-in and the home the credential lands in. */
function providerConfigurationIncident(): ActionIncidentInput {
  return {
    key: 'provider-configuration',
    declarationId: PI_PROVIDER_CONFIGURATION_FAMILY.id,
    disposition: 'action_required',
    subject: PI_SUBJECT,
    title: 'Pi has no usable model provider',
    impact: `Pi cannot serve agent turns until at least one authenticated model is available. Run \`pi\` and sign in with /login (or add a provider API key) — the credential lands in ${getPiHome()}; Health re-checks when you return.`,
    resources: [
      { kind: 'file', id: 'pi.auth', label: 'Pi provider authentication' },
      { kind: 'capability', id: 'runtime.models', label: 'Runtime models' },
    ],
    resolution: {
      key: 'configure-provider',
      type: 'human',
      needs: 'credential',
      label: 'Sign in to a model provider',
      href: '/runtime?tab=overview&field=credentials',
      handoff: { command: PI_LOGIN_COMMAND },
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
      incidents: PI_HOME_INCIDENTS,
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
          // Row 197: an unreadable registry is the fallback lane's business —
          // only an investigation can say whether it is invalid JSON, an
          // unsupported shape, or a file someone else owns.
          return observedError(
            'home',
            'The Pi agent registry cannot be read.',
            {
              key: 'agent-registry',
              declarationId: PI_AGENT_REGISTRY_FAMILY.id,
              disposition: 'action_required',
              subject: PI_SUBJECT,
              title: 'Pi agent registry is unreadable',
              impact: 'Bakin cannot safely resolve the Pi agent roster or its workspaces.',
              resources: [{ kind: 'file', id: 'pi.registry', label: 'Pi agent registry' }],
              resolution: {
                key: 'diagnose-registry',
                type: 'repair',
                label: 'Investigate the Pi agent registry',
                actionId: 'core.diagnose',
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
      incidents: PI_AGENTS_ROOT_INCIDENTS,
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
      incidents: PI_AUTH_INCIDENTS,
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
      incidents: PI_MODELS_INCIDENTS,
      run: async () => {
        try {
          const { registry } = await getModelRegistry()
          await registry.refresh()
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
          // Row 199: the fallback lane reads the provider/model files.
          return observedError(
            'models',
            'The Pi model registry could not be refreshed.',
            {
              key: 'model-registry',
              declarationId: PI_MODEL_REGISTRY_FAMILY.id,
              disposition: 'action_required',
              subject: PI_SUBJECT,
              title: 'Pi model registry failed',
              impact: 'Bakin cannot determine which Pi models are available for agent turns.',
              resources: [
                { kind: 'file', id: 'pi.models', label: 'Pi model configuration' },
                { kind: 'capability', id: 'runtime.models', label: 'Runtime models' },
              ],
              resolution: {
                key: 'diagnose-model-config',
                type: 'repair',
                label: 'Investigate the Pi model configuration',
                actionId: 'core.diagnose',
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
      incidents: PI_EXTENSIONS_INCIDENTS,
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
          // Row 200: required only while something needs the extension. The
          // probe cannot see who depends on a pending extension, so it never
          // claims the subject is required — the decision stays visible,
          // never red on a guess.
          return observedWarning(
            'extensions',
            `${pending.length} Pi extension${pending.length === 1 ? ' is' : 's are'} installed but will not load until approved.`,
            {
              key: 'extension-approval',
              declarationId: PI_EXTENSION_APPROVAL_FAMILY.id,
              disposition: 'action_required',
              subject: PI_SUBJECT,
              required: false,
              title: 'Pi extensions are awaiting approval',
              impact: 'Pending extension code remains disabled until an operator reviews and approves it.',
              resources: [{ kind: 'capability', id: 'runtime.extensions', label: 'Pi extension trust' }],
              resolution: {
                key: 'review-extensions',
                type: 'human',
                needs: 'decision',
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
          // Row 201: discovery failed — an observation, not a card.
          return observedUnknown(
            'extensions',
            'Pi extension trust could not be verified — Bakin cannot confirm which Pi extensions are installed or awaiting approval.',
            err instanceof Error ? err.message : String(err),
          )
        }
      },
    },
  ]
}
