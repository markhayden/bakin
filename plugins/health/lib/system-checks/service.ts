/**
 * System check — macOS LaunchAgent plist health.
 *
 * Migrated out of src/core/doctor.ts (#139 C6). Verifies the bakin
 * service plist exists, does not reference Bun's virtual compiled
 * filesystem, and is loaded into launchd. macOS-only; gated on
 * settings.service.enabled. NOT auto-fixable — stale paths require
 * human judgment.
 */
import { execSync } from 'child_process'
import { healthError, healthHealthy, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput } from '@makinbakin/sdk'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { getSettings } from '../../../../src/core/settings'

const SERVICE_LABEL = 'com.makinbakin.bakin'

export async function checkService(projectRoot: string): Promise<HealthCheckRunInput> {
  const settings = getSettings()
  if (!settings.service.enabled) {
    return healthNotApplicable('Service management is disabled in settings.')
  }

  if (process.platform !== 'darwin') {
    return healthNotApplicable('The managed background service is only available on macOS.')
  }

  const observations: HealthObservationInput[] = []
  const homedir = process.env.HOME || '~'
  const plistPath = join(homedir, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)

  if (!existsSync(plistPath)) {
    return healthObserved([healthWarning({
      key: 'plist',
      summary: 'Background service is not installed.',
      detail: `Expected a LaunchAgent definition at ${plistPath}.`,
      evidence: { plistPath, installed: false },
      incident: serviceIncident(
        'plist-missing',
        'Background service is not installed',
        'Bakin will not start automatically in the background.',
      ),
    })])
  }

  try {
    const plistContent = readFileSync(plistPath, 'utf-8')

    if (plistContent.includes('/$bunfs/')) {
      observations.push(serviceError(
        'plist.bunfs-path',
        'Background service uses a temporary Bun path.',
        'The LaunchAgent points into Bun\'s virtual filesystem and will not survive runtime changes.',
        plistPath,
      ))
    }

    const wdMatch = plistContent.match(/<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/)
    const serverMatch = plistContent.match(/<string>([^<]*server\.ts)<\/string>/)

    if (!wdMatch) {
      observations.push(serviceError(
        'plist.working-directory',
        'Background service has no working directory.',
        'The LaunchAgent is missing WorkingDirectory.',
        plistPath,
      ))
    }

    if (serverMatch && wdMatch && wdMatch[1] !== projectRoot) {
      observations.push(serviceError(
        'plist.project-path',
        'Background service points to a different project directory.',
        `Configured ${wdMatch[1]}; expected ${projectRoot}.`,
        plistPath,
        { configuredPath: wdMatch[1], expectedPath: projectRoot },
      ))
    }

    if (serverMatch && serverMatch[1] !== join(projectRoot, 'server.ts')) {
      observations.push(serviceError(
        'plist.server-path',
        'Background service references a stale server path.',
        `Configured ${serverMatch[1]}; expected ${join(projectRoot, 'server.ts')}.`,
        plistPath,
        { configuredPath: serverMatch[1], expectedPath: join(projectRoot, 'server.ts') },
      ))
    }

    if (!serverMatch && !/<string>serve<\/string>/.test(plistContent)) {
      observations.push(serviceError(
        'plist.command',
        'Background service does not run Bakin.',
        'The LaunchAgent command does not invoke `bakin serve`.',
        plistPath,
      ))
    }
  } catch (err) {
    return healthObserved([healthUnknown({
      key: 'plist.read',
      summary: 'Background service configuration could not be verified.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'plist-unreadable',
        title: 'Background service configuration is unreadable',
        impact: 'Health cannot verify whether the managed service will start correctly.',
        disposition: 'watch',
        resources: [{ kind: 'file', id: 'launch-agent-plist', label: 'Bakin LaunchAgent plist' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }

  // Check service is loaded
  try {
    execSync(`launchctl list ${SERVICE_LABEL}`, { encoding: 'utf-8', stdio: 'pipe' })
  } catch {
    observations.push(healthWarning({
      key: 'launchd.loaded',
      summary: 'Background service is installed but not loaded.',
      evidence: { installed: true, loaded: false },
      incident: serviceIncident(
        'service-unloaded',
        'Background service is not loaded',
        'Bakin will not run in the background until launchd loads the service.',
      ),
    }))
  }

  if (observations.length === 0) {
    observations.push(healthHealthy({
      key: 'ready',
      summary: 'Background service is installed and loaded.',
      evidence: { installed: true, loaded: true, plistPath },
    }))
  }

  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

function serviceError(
  key: string,
  summary: string,
  detail: string,
  plistPath: string,
  evidence: Record<string, string> = {},
) {
  return healthError({
    key,
    summary,
    detail,
    evidence: { plistPath, ...evidence },
    incident: serviceIncident(
      key,
      'Background service configuration is stale',
      'The managed service may fail to start or may run the wrong project.',
    ),
  })
}

function serviceIncident(key: string, title: string, impact: string) {
  return {
    key,
    title,
    impact,
    disposition: 'action_required' as const,
    resources: [
      { kind: 'service' as const, id: SERVICE_LABEL, label: 'Bakin background service' },
      { kind: 'file' as const, id: 'launch-agent-plist', label: 'Bakin LaunchAgent plist' },
    ],
    resolution: {
      key: 'reinstall-service',
      type: 'instructions' as const,
      label: 'Reinstall the background service',
      steps: ['Run the service setup command, then rerun Health.'] as [string],
      command: 'bakin setup service',
    },
  }
}
