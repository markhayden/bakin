/**
 * System check — macOS LaunchAgent plist health.
 *
 * Migrated out of src/core/doctor.ts (#139 C6). Verifies the bakin
 * service plist exists, does not reference Bun's virtual compiled
 * filesystem, and is loaded into launchd. macOS-only; gated on
 * settings.service.enabled. Its repair is `service-setup` (self-healing PR1
 * slice 1.3c, rows 8, 9, 11): the ONE service-setup engine WITHOUT a restart
 * — it rewrites the unit, loads it only when nothing would be killed or
 * doubled, and says so otherwise (the maintenance coordinator owns restarts).
 */
import { execSync } from 'child_process'
import { healthError, healthHealthy, healthNotApplicable, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthObservationInput, HealthRepairActionDefinition, HealthSubject } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { getSettings } from '../../../../src/core/settings'

const SERVICE_LABEL = 'com.makinbakin.bakin'
export const SERVICE_SETUP_ACTION = 'service-setup'
const CHECK_ID = 'health.service'
const SUBJECT: HealthSubject = { kind: 'service', id: 'bakin-launchagent', label: 'Bakin background service' }
/** Rows 8, 9 (the five plist keys) and 11 self-heal through `service-setup`; row 10 (unreadable plist) is an observation. */
export const SERVICE_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'plist-missing', subjectKind: 'service', resolution: { type: 'repair', actionId: SERVICE_SETUP_ACTION }, required: 'always' },
  { id: 'plist-stale', subjectKind: 'service', resolution: { type: 'repair', actionId: SERVICE_SETUP_ACTION }, required: 'always' },
  { id: 'service-unloaded', subjectKind: 'service', resolution: { type: 'repair', actionId: SERVICE_SETUP_ACTION }, required: 'always' },
]

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
    // Row 10: "could not see" is an observation; the engine's bound hands it to core.diagnose later.
    return healthObserved([healthUnknown({
      key: 'plist.read',
      summary: 'Background service configuration could not be verified.',
      detail: `${err instanceof Error ? err.message : String(err)} (${plistPath})`,
      evidence: { plistPath },
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
      'plist-stale',
    ),
  })
}

function serviceIncident(key: string, title: string, impact: string, declarationId = key) {
  return {
    key,
    title,
    impact,
    disposition: 'action_required' as const,
    subject: SUBJECT,
    declarationId,
    resources: [
      { kind: 'service' as const, id: SERVICE_LABEL, label: 'Bakin background service' },
      { kind: 'file' as const, id: 'launch-agent-plist', label: 'Bakin LaunchAgent plist' },
    ],
    resolution: { key: SERVICE_SETUP_ACTION, type: 'repair' as const, label: 'Reinstall the background service', actionId: SERVICE_SETUP_ACTION },
  }
}

export function serviceSetupRepair(): HealthRepairActionDefinition {
  return {
    id: SERVICE_SETUP_ACTION,
    name: 'Reinstall the Bakin background service',
    // R=bakin (rows 8–11): the engine never kickstarts here, but loading the
    // unit is restart-class work the maintenance coordinator schedules.
    effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false, restartsService: 'bakin' },
    mutation: 'restart',
    operationPlan: () => ({ stages: [{ id: 'setup', kind: 'installing', label: 'Write and load the service definition' }], pointOfNoReturn: 'setup' }),
    async plan(target) {
      return [{
        id: SERVICE_SETUP_ACTION,
        actionId: SERVICE_SETUP_ACTION,
        title: 'Reinstall the Bakin background service',
        reason: 'The managed service definition is missing, stale or not loaded, so Bakin may not come back on its own.',
        ...repairTargetSelection(target),
        changes: [{ kind: 'service', target: SERVICE_LABEL, action: 'update', description: 'Rewrite the service definition for this Bakin and home, and load it when no server would be killed or doubled. A running service keeps its current definition until its next restart.' }],
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const result = (status: 'applied' | 'failed' | 'skipped', message: string) => items.map((item) => ({ itemId: item.id, actionId: item.actionId, status, message, affectedCheckIds: [CHECK_ID], changes: item.changes }))
      op.stage('setup')
      try {
        const { realServiceSetupIo, setupBakinService } = await import('../../../../src/core/service-setup')
        const outcome = await setupBakinService({ restart: false }, await realServiceSetupIo())
        op.item('setup', { id: 'service', label: SERVICE_LABEL, status: outcome.ok ? 'done' : 'failed', message: outcome.message })
        if (!outcome.ok) return result('failed', outcome.message)
        return result(outcome.loaded === 'deferred' ? 'skipped' : 'applied', outcome.message)
      } catch (err) {
        const message = `Service setup failed: ${err instanceof Error ? err.message : String(err)}`
        op.item('setup', { id: 'service', label: SERVICE_LABEL, status: 'failed', message })
        return result('failed', message)
      }
    },
  }
}
