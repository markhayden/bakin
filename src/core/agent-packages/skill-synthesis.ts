/**
 * Manifest synthesis for raw Agent-Skills bundles (#687).
 *
 * A staged directory containing a SKILL.md (the ecosystem-standard skill
 * format: ClawHub, pi-skills, anthropics/skills, Hermes) becomes a normal
 * Bakin skill-pack: the bundle moves into `skills/<name>/` and a
 * `bakin-package.json` is written so the EXISTING installer/projector/
 * readiness machinery runs unchanged.
 *
 * Two hard rules (D12):
 *  - SKILL.md and every support file ride VERBATIM — never rewritten.
 *  - The requirement translation table below is FROZEN. It covers exactly
 *    the documented `metadata.openclaw` namespace and is never extended —
 *    any other dialect, namespace, or prose requirement routes to the agent
 *    mapping lane (`bakin skills map`), not to core code. A test pins the
 *    key list; extending it requires a spec change.
 *
 * Nothing here executes bundle content. Upstream "install steps" are data
 * shown in the consent preview, full stop (the ClawHavoc vector).
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { load as parseYaml } from 'js-yaml'
import { mintSkillSecretSlot } from '../../../packages/core/src/agent-packages/skill-secret-slot'
import { createLogger } from '../logger'

const log = createLogger('skill-synthesis')

/**
 * D12 pin: the complete, permanent list of upstream keys core translates.
 * NEVER add to this list — new dialects belong to the agent mapping lane.
 */
export const FROZEN_TRANSLATION_KEYS = [
  'metadata.openclaw.requires.env',
  'metadata.openclaw.requires.bins',
  'metadata.openclaw.requires.anyBins',
  'metadata.openclaw.envVars',
  'metadata.openclaw.primaryEnv',
  'metadata.openclaw.os',
] as const

export interface SynthesisSourceInfo {
  /** Canonical source ref (clawhub:@owner/slug, github:…, local path). */
  source: string
  /** Upstream version/ref this fetch resolved to. */
  ref?: string
  /** Content sha observed at fetch time (hub artifact sha or commit sha). */
  resolvedSha?: string
  /** Hub-resolved version, used when the frontmatter has none. */
  hubVersion?: string
  /**
   * Name to use when the frontmatter declares none. Computed by the FETCH
   * site from the already-parsed ref (repo/subpath/slug) — a flat split of
   * `source` would wrongly pick a trailing `@version`/`#subpath` segment.
   */
  fallbackName?: string
}

export type SynthesisResult =
  | { ok: true; skillName: string; warnings: string[]; mentions: string[] }
  | { ok: false; reason: 'no-skill-md' | 'binary-files' | 'has-manifest' | 'invalid-name' | 'unsupported-os'; error: string; binaryFiles?: string[] }

interface Frontmatter {
  name?: string
  description?: string
  version?: string
  homepage?: string
  metadata?: { openclaw?: OpenClawMetadata }
}

interface OpenClawMetadata {
  os?: string[]
  requires?: { env?: string[]; bins?: string[]; anyBins?: string[] }
  envVars?: Record<string, { required?: boolean } | null>
  primaryEnv?: string
}

const ENV_VAR_RE = /^[A-Z_][A-Z0-9_]*$/

// ─── Small pure helpers ──────────────────────────────────────────────────────

function listFilesRecursive(root: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listFilesRecursive(root, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Frontmatter parse: tolerant — a missing or broken block yields {}. */
function parseFrontmatter(skillMd: string): { data: Frontmatter; warnings: string[] } {
  if (!skillMd.startsWith('---')) return { data: {}, warnings: [] }
  const end = skillMd.indexOf('\n---', 3)
  if (end < 0) return { data: {}, warnings: ['frontmatter block is unterminated — ignored'] }
  try {
    const raw = parseYaml(skillMd.slice(3, end + 1))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { data: raw as Frontmatter, warnings: [] }
    return { data: {}, warnings: ['frontmatter is not a mapping — ignored'] }
  } catch (err) {
    return { data: {}, warnings: [`frontmatter did not parse as YAML — ignored (${err instanceof Error ? err.message : String(err)})`] }
  }
}

/** Sanitize an upstream skill name to Bakin's slug shape (id budget: hub- + 36). */
function sanitizeName(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 36)
  return /^[a-z0-9][a-z0-9-_]*$/.test(slug) ? slug : null
}

function sanitizeVersion(raw: string | undefined, hubVersion: string | undefined): { version: string; warning?: string } {
  for (const candidate of [raw, hubVersion]) {
    if (!candidate) continue
    const m = String(candidate).match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
    if (!m) continue
    const version = `${m[1]}.${m[2] ?? '0'}.${m[3] ?? '0'}`
    const warning = version === String(candidate) ? undefined : `version "${candidate}" normalized to "${version}"`
    return { version, warning }
  }
  return { version: '0.0.0', warning: raw ? `version "${raw}" is not semver — using 0.0.0` : undefined }
}

/** Where the user gets things — required by prereq legs, derived from the source. */
function helpUrl(source: string, homepage: string | undefined): string {
  if (homepage && /^https?:\/\//.test(homepage)) return homepage
  if (source.startsWith('clawhub:')) {
    const body = source.slice('clawhub:'.length)
    if (body.startsWith('@')) {
      const [owner, slugAndVersion] = body.slice(1).split('/', 2)
      const slug = slugAndVersion?.split('@')[0]
      if (owner && slug) return `https://clawhub.ai/${owner}/skills/${slug}`
    }
    return 'https://clawhub.ai'
  }
  if (source.startsWith('github:')) {
    const backbone = source.slice('github:'.length).split('#')[0]!.split('@')[0]
    return `https://github.com/${backbone}`
  }
  return 'https://agentskills.io/specification'
}

const OS_TO_PLATFORMS: Record<string, string[]> = {
  darwin: ['darwin-arm64', 'darwin-x64'],
  linux: ['linux-x64', 'linux-arm64'],
}

/**
 * Claim-free mentions scan: env-var-shaped strings appearing anywhere in the
 * bundle's text. This is preview honesty, NOT a requirement claim — it feeds
 * the "mentions these env-var-shaped strings" line and the `skills map` hint.
 */
export function scanEnvVarMentions(files: Record<string, string>, exclude: Set<string>): string[] {
  const found = new Set<string>()
  for (const content of Object.values(files)) {
    for (const match of content.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) {
      const name = match[0]!
      if (name.length < 6 || exclude.has(name) || !ENV_VAR_RE.test(name)) continue
      found.add(name)
    }
  }
  return Array.from(found).sort()
}

// ─── Translation (FROZEN — see header) ───────────────────────────────────────

interface TranslatedLegs {
  secrets: Array<{ name: string; description: string; required: boolean; secretSlot: string; help?: string }>
  prereqs: Array<{ name: string; kind: 'binary'; probe: string; help: string; optional: boolean }>
  platforms?: string[]
  warnings: string[]
}

function translateOpenClawMetadata(meta: OpenClawMetadata | undefined, help: string, packageId: string): TranslatedLegs | { unsupportedOs: string } {
  const warnings: string[] = []
  const secrets = new Map<string, { name: string; description: string; required: boolean; secretSlot: string; help?: string }>()
  const prereqs = new Map<string, { name: string; kind: 'binary'; probe: string; help: string; optional: boolean }>()

  const addSecret = (name: string, required: boolean): void => {
    if (!ENV_VAR_RE.test(name)) {
      warnings.push(`declared env var "${name}" is not env-var-shaped — left unmapped`)
      return
    }
    const existing = secrets.get(name)
    // Core mints the slot, per-package under skills.* — never an existing
    // provider slot (that would route real keys into hub-skill env vars) and
    // never shared across skills (that would silently inherit a neighbour's
    // stored key and report "ready"). See skill-secret-slot.ts.
    secrets.set(name, {
      name,
      description: `Required by this skill (declared upstream)`,
      required: existing?.required || required,
      secretSlot: mintSkillSecretSlot(packageId, name),
      help,
    })
  }

  const addPrereq = (bin: string, optional: boolean): void => {
    if (!bin || bin.includes('/') || bin.includes('\\')) {
      warnings.push(`declared binary "${bin}" is not a bare PATH name — left unmapped`)
      return
    }
    const existing = prereqs.get(bin)
    prereqs.set(bin, { name: bin, kind: 'binary', probe: bin, help, optional: existing ? existing.optional && optional : optional })
  }

  for (const name of meta?.requires?.env ?? []) addSecret(name, true)
  for (const [name, spec] of Object.entries(meta?.envVars ?? {})) addSecret(name, spec?.required !== false)
  if (meta?.primaryEnv) addSecret(meta.primaryEnv, true)
  for (const bin of meta?.requires?.bins ?? []) addPrereq(bin, false)
  for (const bin of meta?.requires?.anyBins ?? []) addPrereq(bin, true)

  let platforms: string[] | undefined
  if (meta?.os && meta.os.length > 0) {
    platforms = meta.os.flatMap((os) => {
      const mapped = OS_TO_PLATFORMS[os]
      if (!mapped) warnings.push(`declared os "${os}" has no Bakin platform — dropped`)
      return mapped ?? []
    })
    if (platforms.length === 0) return { unsupportedOs: meta.os.join(', ') }
  }

  return { secrets: [...secrets.values()], prereqs: [...prereqs.values()], platforms, warnings }
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Restructure a staged raw bundle into a synthesizable skill-pack IN PLACE:
 * bundle files move to `skills/<name>/` and a bakin-package.json lands at
 * the staging root. Refuses (never partially mutates) on: existing manifest,
 * no SKILL.md, binary files, unusable name, upstream os with no Bakin
 * platform.
 */
export function synthesizeSkillPack(stagingDir: string, sourceInfo: SynthesisSourceInfo): SynthesisResult {
  const rootEntries = readdirSync(stagingDir, { withFileTypes: true })
  if (rootEntries.some((e) => e.isFile() && e.name === 'bakin-package.json')) {
    return { ok: false, reason: 'has-manifest', error: 'directory already contains a bakin-package.json — not a raw bundle' }
  }
  const skillMdEntry = rootEntries.find((e) => e.isFile() && /^skill\.md$/i.test(e.name))
  if (!skillMdEntry) {
    return { ok: false, reason: 'no-skill-md', error: `no SKILL.md found in the bundle root — not an Agent-Skills bundle` }
  }

  // Binary scan over the whole tree BEFORE any mutation (D1: refused honestly).
  const relFiles = listFilesRecursive(stagingDir)
  const textFiles: Record<string, string> = {}
  const binaryFiles: string[] = []
  for (const rel of relFiles) {
    const decoded = decodeUtf8Strict(readFileSync(join(stagingDir, rel)))
    if (decoded === null) binaryFiles.push(rel)
    else textFiles[rel] = decoded
  }
  if (binaryFiles.length > 0) {
    return {
      ok: false,
      reason: 'binary-files',
      binaryFiles: binaryFiles.sort(),
      error: `bundle contains binary files, which Bakin does not project yet: ${binaryFiles.sort().join(', ')}`,
    }
  }

  const warnings: string[] = []
  const skillMd = textFiles[skillMdEntry.name]!
  const { data: fm, warnings: fmWarnings } = parseFrontmatter(skillMd)
  warnings.push(...fmWarnings)

  const rawName = fm.name?.trim() || undefined
  // Prefer the fetch-site fallback (repo/subpath/slug from the parsed ref);
  // the flat-split legacy path would pick a trailing @version segment.
  const fallbackName = sourceInfo.fallbackName ?? sourceInfo.source.split(/[/#@]/).filter(Boolean).pop() ?? 'skill'
  const skillName = sanitizeName(rawName ?? fallbackName)
  if (!skillName) {
    return { ok: false, reason: 'invalid-name', error: `cannot derive a usable skill name from "${rawName ?? fallbackName}"` }
  }
  if (rawName && skillName !== rawName) warnings.push(`skill name "${rawName}" sanitized to "${skillName}"`)

  const { version, warning: versionWarning } = sanitizeVersion(fm.version, sourceInfo.hubVersion)
  if (versionWarning) warnings.push(versionWarning)

  const help = helpUrl(sourceInfo.source, fm.homepage)
  const packageId = `hub-${skillName}`
  const translated = translateOpenClawMetadata(fm.metadata?.openclaw, help, packageId)
  if ('unsupportedOs' in translated) {
    return { ok: false, reason: 'unsupported-os', error: `skill declares os [${translated.unsupportedOs}] — no supported Bakin platform` }
  }
  warnings.push(...translated.warnings)

  const hasLegs = translated.secrets.length > 0 || translated.prereqs.length > 0 || (translated.platforms?.length ?? 0) > 0
  const capability = hasLegs ? sanitizeName(skillName)?.replace(/_/g, '-').slice(0, 40) : undefined

  const mentions = scanEnvVarMentions(textFiles, new Set(translated.secrets.map((s) => s.name)))

  // ── Mutate staging: move bundle → skills/<name>/, write the manifest ──────
  const holding = join(stagingDir, `.synth-${process.pid}`)
  mkdirSync(holding)
  for (const entry of rootEntries) renameSync(join(stagingDir, entry.name), join(holding, entry.name))
  mkdirSync(join(stagingDir, 'skills'), { recursive: true })
  renameSync(holding, join(stagingDir, 'skills', skillName))

  const manifest = {
    id: packageId,
    name: skillName,
    version,
    kind: 'skill-pack' as const,
    ...(fm.description ? { description: String(fm.description).slice(0, 1024) } : {}),
    contributions: { skills: [`skills/${skillName}`] },
    ...(translated.secrets.length > 0 ? { secrets: translated.secrets } : {}),
    ...(translated.prereqs.length > 0 ? { requires: { prereqs: translated.prereqs } } : {}),
    ...(translated.platforms && translated.platforms.length > 0 ? { platforms: translated.platforms } : {}),
    ...(capability ? { capability } : {}),
    upstream: {
      source: sourceInfo.source,
      ...(sourceInfo.ref ? { ref: sourceInfo.ref } : {}),
      ...(sourceInfo.resolvedSha ? { resolvedSha: sourceInfo.resolvedSha } : {}),
    },
  }
  writeFileSync(join(stagingDir, 'bakin-package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  log.info('Synthesized skill-pack from raw bundle', { skillName, source: sourceInfo.source, legs: hasLegs })
  return { ok: true, skillName, warnings, mentions }
}
