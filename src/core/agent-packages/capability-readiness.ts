/**
 * Capability readiness — ONE engine behind every surface that answers
 * "can agents actually use this capability right now?": the REST endpoint
 * (`GET /api/packages/capabilities`), the doctor check, the onboarding
 * component, and the runtime hub's Capabilities tab.
 *
 * A capability pack is ready when all three legs stand:
 *   content — its skills are projected where the active runtime reads them
 *   bins    — every declared binary is installed in the Bakin bin dir
 *   secrets — every REQUIRED declared env var is set (env) or backed by a
 *             stored secret (store; injected at boot)
 * Anything else is an honest per-leg `missing` with a remediation string —
 * never a silent failure.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { readLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { safeParseManifest, type SkillPackManifest } from '../../../packages/core/src/agent-packages/manifest'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import { getStoredSecret, parseSecretSlot } from '@bakin/core/media'
import { SKILL_SECRET_PROVIDER } from '../../../packages/core/src/agent-packages/skill-secret-slot'
import { isBindableSecretSlot } from '../secret-env'
import { getContentDir, getBakinPaths } from '@/core/content-dir'
import { createAppServices, maybeGetAppServices } from '@/core/app-services'
import { createLogger } from '@/core/logger'
import { binPlatformKey } from './bin-installer'
import { modelDest, npmPayloadDir } from './requirements-installer'

const log = createLogger('capability-readiness')

export interface CapabilitySkillStatus {
  name: string
  status: 'ok' | 'missing'
}

export interface CapabilityBinStatus {
  name: string
  status: 'ok' | 'missing' | 'unsupported-platform'
}

export interface CapabilitySecretStatus {
  name: string
  required: boolean
  secretSlot?: string
  help?: string
  status: 'env' | 'store' | 'missing'
}

export interface CapabilityNpmStatus {
  name: string
  status: 'ok' | 'missing'
}

export interface CapabilityModelStatus {
  name: string
  /** Declared size — UIs surface it so a giant download is never a surprise. */
  bytes: number
  status: 'ok' | 'missing'
}

export interface CapabilityPrereqStatus {
  name: string
  kind: 'binary' | 'app'
  help: string
  optional: boolean
  status: 'ok' | 'missing'
}

export interface CapabilityReadiness {
  capability: string
  packageId: string
  version: string
  name: string
  /** What this capability adds/unlocks — the pack manifest's description. */
  description: string
  skills: CapabilitySkillStatus[]
  bins: CapabilityBinStatus[]
  npm: CapabilityNpmStatus[]
  models: CapabilityModelStatus[]
  prereqs: CapabilityPrereqStatus[]
  secrets: CapabilitySecretStatus[]
  /** False when the pack declares `platforms` and this box isn't one of them. */
  platformSupported: boolean
  ready: boolean
  /** Human remediation lines for every non-ok leg (empty when ready). */
  missing: string[]
}

const GLOBAL_SKILL_TARGET = 'runtime:global-skill:'

function readInstalledManifest(kind: string, id: string, version: string): SkillPackManifest | null {
  const dir = getPackageSourceDir(getContentDir(), kind as never, id, version)
  const path = join(dir, 'bakin-package.json')
  if (!existsSync(path)) return null
  try {
    const parsed = safeParseManifest(JSON.parse(readFileSync(path, 'utf-8')))
    if (!parsed.success || parsed.data.kind !== 'skill-pack') return null
    return parsed.data
  } catch (err) {
    log.warn(`Unreadable installed manifest for ${id}@${version}`, { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** Readiness for every installed capability pack (lockfile-driven). */
export async function listCapabilities(): Promise<CapabilityReadiness[]> {
  const lock = readLockfile()
  // Standalone CLI checks (`bakin check capabilities`) run without a booted
  // server — create services on demand, same pattern as the credential checks.
  const runtime = (maybeGetAppServices() ?? (await createAppServices())).runtime
  const binDir = getBakinPaths().bin
  const platform = binPlatformKey()
  const out: CapabilityReadiness[] = []

  for (const [key, entry] of Object.entries(lock.packages)) {
    if (entry.kind !== 'skill-pack') continue
    const id = key.includes('@') ? key.slice(0, key.lastIndexOf('@')) : key
    const manifest = readInstalledManifest(entry.kind, id, entry.version)
    if (!manifest?.capability) continue

    const missing: string[] = []

    const skillNames = (entry.projections ?? [])
      .filter((p) => p.kind === 'skill' && p.target.startsWith(GLOBAL_SKILL_TARGET))
      .map((p) => p.target.slice(GLOBAL_SKILL_TARGET.length))
    const skills: CapabilitySkillStatus[] = []
    for (const name of skillNames) {
      const present = (await runtime.skills.get(name)) !== null
      skills.push({ name, status: present ? 'ok' : 'missing' })
      if (!present) missing.push(`skill "${name}" is not projected — run: bakin packages sync ${key}`)
    }

    const bins: CapabilityBinStatus[] = []
    for (const bin of manifest.requires?.bins ?? []) {
      if (!platform || !bin.install[platform]) {
        bins.push({ name: bin.name, status: 'unsupported-platform' })
        missing.push(`binary "${bin.name}" has no build for this platform`)
        continue
      }
      const present = existsSync(join(binDir, bin.name))
      bins.push({ name: bin.name, status: present ? 'ok' : 'missing' })
      if (!present) missing.push(`binary "${bin.name}" is missing — reinstall: bakin packages install ${id}`)
    }

    const npm: CapabilityNpmStatus[] = []
    for (const req of manifest.requires?.npm ?? []) {
      const payload = npmPayloadDir(id, req.name)
      const present = existsSync(payload)
        && (Object.keys(req.dependencies).length === 0 || existsSync(join(payload, 'node_modules')))
      npm.push({ name: req.name, status: present ? 'ok' : 'missing' })
      if (!present) missing.push(`npm payload "${req.name}" is not installed — run: bakin packages sync ${key}`)
    }

    const models: CapabilityModelStatus[] = []
    for (const req of manifest.requires?.models ?? []) {
      const dest = modelDest(req.dest)
      const present = existsSync(dest) && statSync(dest).size === req.bytes
      models.push({ name: req.name, bytes: req.bytes, status: present ? 'ok' : 'missing' })
      if (!present) missing.push(`model "${req.name}" (${Math.round(req.bytes / 1e6)} MB) is missing — run: bakin packages sync ${key}`)
    }

    const prereqs: CapabilityPrereqStatus[] = []
    for (const req of manifest.requires?.prereqs ?? []) {
      // The repo's hand-rolled Bun namespace omits `which` — cast (findSystemBun precedent).
      const bunWhich = (Bun as unknown as { which: (bin: string) => string | null }).which
      const present = req.kind === 'binary'
        ? Boolean(bunWhich(req.probe))
        : existsSync(req.probe)
      prereqs.push({ name: req.name, kind: req.kind, help: req.help, optional: req.optional, status: present ? 'ok' : 'missing' })
      // Prereqs are user-installed, never Bakin-installed — remediation is the
      // help link. Optional prereqs surface as a leg but never block ready.
      if (!present && !req.optional) missing.push(`${req.name} is not installed — get it: ${req.help}`)
    }

    const platformSupported = !manifest.platforms || (platform !== null && manifest.platforms.includes(platform))
    if (!platformSupported) {
      missing.push(`not available on this platform — needs ${manifest.platforms!.join(' or ')}`)
    }

    const secrets: CapabilitySecretStatus[] = []
    for (const secret of manifest.secrets ?? []) {
      let status: CapabilitySecretStatus['status'] = 'missing'
      if (process.env[secret.name]) {
        status = 'env'
      } else if (secret.secretSlot && isBindableSecretSlot(secret.name, secret.secretSlot)) {
        // Only slots the env-injection layer will actually bind can count as
        // satisfied. A pack declaring e.g. `notion.apiKey` is refused by
        // collectPackSecretMappings, so treating a stored value there as
        // "ready" would be a false green — the var never reaches the agent.
        const parsedSlot = parseSecretSlot(secret.secretSlot)
        const provider = parsedSlot?.provider
        const name = parsedSlot?.name
        if (provider && name && getStoredSecret(provider, name)) status = 'store'
      }
      secrets.push({ name: secret.name, required: secret.required, secretSlot: secret.secretSlot, help: secret.help, status })
      if (status === 'missing' && secret.required) {
        missing.push(
          secret.secretSlot && !isBindableSecretSlot(secret.name, secret.secretSlot)
            ? `${secret.name} declares an unsupported secret slot "${secret.secretSlot}" — packs may only bind ${SKILL_SECRET_PROVIDER}.* slots, so this key can never reach the agent`
            : `${secret.name} is not configured — add it in Settings → Integrations & Keys${secret.help ? ` (get one: ${secret.help})` : ''}`,
        )
      }
    }

    out.push({
      capability: manifest.capability,
      packageId: id,
      version: entry.version,
      name: manifest.name,
      description: manifest.description ?? '',
      skills,
      bins,
      npm,
      models,
      prereqs,
      secrets,
      platformSupported,
      ready: missing.length === 0,
      missing,
    })
  }

  return out.sort((a, b) => a.capability.localeCompare(b.capability))
}
