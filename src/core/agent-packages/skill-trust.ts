/**
 * Skill install trust gate (#687, SPEC §3.4).
 *
 * Two-phase consent mirroring the plugin install gate: `buildSkillPreview`
 * fetches into staging, assembles everything the user must see (files,
 * translated requirements, untranslated metadata, mentions, instruction-risk
 * findings, hub badge), signs a consent token bound to (canonical ref,
 * staging content sha), and TEARS DOWN staging. `confirmSkillInstall`
 * re-fetches, re-hashes, and bounces to a fresh preview when the content
 * drifted between preview and commit — consent is never replayed against
 * changed content.
 *
 * Hard refusals (hub verdicts, binary files, unsafe paths, caps) live in
 * the fetch layer and surface here as refusal results with an audit trail.
 * The instruction-risk scan is deterministic pattern matching — a loud
 * WARNING (the run-time ClawHavoc vector made visible), never a claim.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { readSkillTree } from '@bakin/core/adapters/runtime'
import { signConsentToken, verifyConsentToken } from '@/core/plugins/consent-token'
import { computeDirSha } from '../../../packages/core/src/agent-packages/markers'
import { safeParseManifest } from '../../../packages/core/src/agent-packages/manifest'
import { readLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { appendAudit } from '../audit'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { normalizeSkillRef, parseClawhubRef } from './ref-normalize'
import { fetchSourceAsync, isClawhubSource, type FetchedSource } from './source-fetcher'
import { createClawhubClient } from './clawhub-client'
import { binPlatformKey } from './bin-installer'
import { SkillRefusalError } from './errors'
import { installPackage, type InstallResult } from './installer'
import { removePackageById } from './uninstaller'

const log = createLogger('skill-trust')

export interface RiskFinding {
  file: string
  line: number
  pattern: string
  snippet: string
}

/**
 * Deterministic network-install / hidden-execution patterns. This is the
 * documented ClawHavoc vector (fake "prerequisite install steps"), surfaced
 * loudly for sources with no hub verdict (github/local) and all previews.
 */
const RISK_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'curl-pipe-shell', re: /\bcurl\b[^\n|]*\|\s*(?:ba|z|da)?sh\b/ },
  { name: 'wget-pipe-shell', re: /\bwget\b[^\n|]*\|\s*(?:ba|z|da)?sh\b/ },
  { name: 'base64-decode-exec', re: /\bbase64\b[^\n|]*\|\s*(?:ba|z|da)?sh\b/ },
  { name: 'remote-powershell', re: /\b(?:iwr|Invoke-WebRequest)\b[^\n|]*\|\s*iex\b/i },
  { name: 'eval-download', re: /\beval\s*["'`$(]*\s*(?:curl|wget)\b/ },
]

export function scanInstructionRisk(files: Record<string, string>): RiskFinding[] {
  const findings: RiskFinding[] = []
  for (const [file, content] of Object.entries(files)) {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const { name, re } of RISK_PATTERNS) {
        if (re.test(lines[i]!)) {
          findings.push({ file, line: i + 1, pattern: name, snippet: lines[i]!.trim().slice(0, 200) })
        }
      }
    }
  }
  return findings
}

export interface SkillPreviewRequirements {
  secrets: Array<{ name: string; required: boolean; secretSlot?: string; help?: string }>
  prereqs: Array<{ name: string; probe: string; optional: boolean }>
  platforms?: string[]
  /**
   * DOWNLOADABLE legs (#687 security review) — these fetch AND EXECUTE at
   * install time (`verifyArgs`), so they must be surfaced loudly and bound
   * into consent. A raw hub bundle never declares them (synthesis can't
   * produce them); only a source shipping its own bakin-package.json can.
   */
  bins: Array<{ name: string; url?: string; willExecute: boolean }>
  npm: string[]
  models: Array<{ name: string; bytes: number }>
}

export interface SkillPreview {
  ref: string
  packageId: string
  skillName: string
  version: string
  description?: string
  sourceKind: FetchedSource['kind']
  pinnedRef: string
  resolvedSha?: string
  files: Array<{ path: string; bytes: number }>
  requirements: SkillPreviewRequirements
  /** The SKILL.md frontmatter `metadata` object, verbatim — untranslated namespaces included. */
  rawMetadata?: unknown
  mentions: string[]
  warnings: string[]
  risk: RiskFinding[]
  hub?: { downloads?: number; stars?: number; installs?: number }
  /** 'none' = non-hub source (github/local). Never re-derived from copy. */
  verdictState: 'clean' | 'unscanned' | 'unverified' | 'none'
  contentSha: string
  consentToken: string
}

export type PreviewResult =
  | { ok: true; preview: SkillPreview }
  | { ok: false; refused: boolean; error: string }

export type ConfirmResult =
  | { status: 'installed'; result: InstallResult; warnings: string[] }
  | { status: 'drift'; preview: SkillPreview }
  | { status: 'invalid-token'; error: string }
  | { status: 'refused'; error: string }
  | { status: 'error'; error: string }

interface StagedAssessment {
  fetched: FetchedSource
  ref: string
  contentSha: string
  preview: Omit<SkillPreview, 'consentToken'>
}

/** Fetch + assemble everything preview/commit share. Caller owns staging teardown. */
async function assess(input: string): Promise<StagedAssessment> {
  const normalized = normalizeSkillRef(input)
  if (!normalized.ok) throw new Error(normalized.error)
  const ref = normalized.ref

  const fetched = await fetchSourceAsync(ref)
  const staging = fetched.stagingDir
  const manifestRaw = JSON.parse(readFileSync(join(staging, 'bakin-package.json'), 'utf-8')) as Record<string, unknown>
  const parsed = safeParseManifest(manifestRaw)
  if (!parsed.success) throw new Error(`staged manifest failed validation: ${parsed.error.issues[0]?.message}`)
  const manifest = parsed.data

  const skillName = fetched.synthesis?.skillName ?? manifest.name
  // Scan the WHOLE staged tree, not just contributions.skills[0]: a pack can
  // contribute multiple skill dirs, and reading only the first hid a second
  // payload dir from the file list, risk scan, and mentions scan. Reading our
  // own staging tree (never join(staging, attacker-path)) also removes the
  // preview-time traversal surface. bakin-package.json is Bakin's synthesized
  // manifest, shown as structured requirements instead.
  const files = readSkillTree(staging)
  delete (files as Record<string, string>)['bakin-package.json']

  // Untranslated frontmatter metadata, verbatim (preview honesty). Locate a
  // SKILL.md: prefer the first contribution's, else any in the tree.
  let rawMetadata: unknown
  const skillMdKey = manifest.kind === 'skill-pack' && manifest.contributions.skills[0]
    ? `${manifest.contributions.skills[0]}/SKILL.md`
    : undefined
  const skillMd = (skillMdKey && files[skillMdKey])
    ?? files[Object.keys(files).find((k) => /(^|\/)SKILL\.md$/i.test(k)) ?? '']
  if (skillMd?.startsWith('---')) {
    const end = skillMd.indexOf('\n---', 3)
    if (end > 0) {
      try {
        const { load } = await import('js-yaml')
        const fm = load(skillMd.slice(3, end + 1))
        rawMetadata = (fm as { metadata?: unknown } | null)?.metadata
      } catch {
        rawMetadata = undefined
      }
    }
  }

  const requires = manifest.kind === 'skill-pack' ? manifest.requires : undefined
  const platformKey = binPlatformKey()
  const requirements: SkillPreviewRequirements = {
    secrets: (manifest.secrets ?? []).map((s) => ({
      name: s.name, required: s.required, secretSlot: s.secretSlot, help: s.help,
    })),
    prereqs: (requires?.prereqs ?? []).map((p) => ({ name: p.name, probe: p.probe, optional: p.optional })),
    ...(manifest.kind === 'skill-pack' && manifest.platforms ? { platforms: manifest.platforms } : {}),
    // Downloadable-and-executable legs, surfaced loudly (security review).
    bins: (requires?.bins ?? []).map((b) => ({
      name: b.name,
      url: platformKey ? b.install[platformKey]?.url : undefined,
      willExecute: Boolean(b.verifyArgs && b.verifyArgs.length > 0),
    })),
    npm: (requires?.npm ?? []).map((n) => n.name),
    models: (requires?.models ?? []).map((m) => ({ name: m.name, bytes: m.bytes })),
  }

  let hub: SkillPreview['hub']
  if (fetched.kind === 'clawhub' && isClawhubSource(ref)) {
    try {
      const parsedRef = parseClawhubRef(ref)
      const detail = await createClawhubClient().getDetail(parsedRef.slug, parsedRef.owner)
      const stats = detail.skill.stats
      if (stats) hub = { downloads: stats.downloads, stars: stats.stars, installs: stats.installs }
    } catch (err) {
      log.warn('ClawHub stats unavailable for preview', { ref, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const contentSha = computeDirSha(staging)
  const fileList = Object.entries(files)
    .map(([path]) => ({ path, bytes: statSync(join(staging, path)).size }))
    .sort((a, b) => a.path.localeCompare(b.path))

  return {
    fetched,
    ref,
    contentSha,
    preview: {
      ref,
      packageId: manifest.id,
      skillName,
      version: manifest.version,
      description: manifest.description,
      sourceKind: fetched.kind,
      pinnedRef: fetched.ref,
      ...(fetched.commitSha ? { resolvedSha: fetched.commitSha } : {}),
      files: fileList,
      requirements,
      ...(rawMetadata !== undefined ? { rawMetadata } : {}),
      mentions: fetched.synthesis?.mentions ?? [],
      warnings: [...(fetched.synthesis?.warnings ?? []), ...(fetched.fetchWarnings ?? [])],
      risk: scanInstructionRisk(files),
      ...(hub ? { hub } : {}),
      // Carried verbatim from the fetch layer — NEVER re-derived from copy.
      // Non-hub sources have no verdict; refused never reaches preview (fetch
      // throws), so map it defensively to 'unscanned'.
      verdictState: fetched.verdictState
        ? (fetched.verdictState === 'refused' ? 'unscanned' : fetched.verdictState)
        : 'none',
      contentSha,
    },
  }
}

function teardown(fetched: FetchedSource | null): void {
  if (fetched && existsSync(fetched.stagingDir)) {
    rmSync(fetched.stagingDir, { recursive: true, force: true })
  }
}

function isRefusal(err: unknown): boolean {
  return err instanceof SkillRefusalError
}

/** Phase 1 — preview + consent token. Staging never survives this call. */
export async function buildSkillPreview(input: string): Promise<PreviewResult> {
  let staged: StagedAssessment | null = null
  try {
    staged = await assess(input)
    const consentToken = signConsentToken({
      source: staged.ref,
      manifestSha: staged.contentSha,
      permissions: summarizeConsent(staged.preview),
    })
    return { ok: true, preview: { ...staged.preview, consentToken } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const refused = isRefusal(err)
    if (refused) {
      appendAudit(getContentDir(), 'skill.hub.refused', input, { ref: input, reason: message }, 'rest')
    }
    return { ok: false, refused, error: message }
  } finally {
    teardown(staged?.fetched ?? null)
  }
}

/** What the user is actually consenting to — rides inside the token. */
function summarizeConsent(preview: Omit<SkillPreview, 'consentToken'>): string[] {
  const r = preview.requirements
  return [
    ...r.secrets.map((s) => `secret:${s.name}@${s.secretSlot ?? 'unbound'}`),
    ...r.prereqs.map((p) => `prereq:${p.probe}`),
    // Downloadable/executable legs are part of what's consented to.
    ...r.bins.map((b) => `bin:${b.name}${b.willExecute ? ':exec' : ''}`),
    ...r.npm.map((n) => `npm:${n}`),
    ...r.models.map((m) => `model:${m.name}`),
    ...preview.risk.map((rf) => `risk:${rf.pattern}`),
  ]
}

/** Existing installed skill-pack lockfile keys for this manifest id (any version). */
function existingSkillPackKeys(packageId: string): string[] {
  const lock = readLockfile()
  return Object.entries(lock.packages)
    .filter(([key, entry]) => entry.kind === 'skill-pack' && (key === packageId || key.startsWith(`${packageId}@`)))
    .map(([key]) => key)
}

/**
 * Phase 2 — token-validated install. Installs the EXACT staging tree whose
 * sha the consent token bound (no third re-fetch — that was a TOCTOU), and
 * SUPERSEDES any existing install of the same id (re-install = update, D4).
 * Content drift bounces to a FRESH preview so stale consent never installs
 * changed content.
 */
export async function confirmSkillInstall(input: string, token: string): Promise<ConfirmResult> {
  const normalized = normalizeSkillRef(input)
  if (!normalized.ok) return { status: 'error', error: normalized.error }
  const ref = normalized.ref

  const payload = verifyConsentToken(token)
  if (!payload) return { status: 'invalid-token', error: 'consent token is invalid or expired — re-run preview' }
  if (payload.source !== ref) {
    return { status: 'invalid-token', error: 'consent token was issued for a different ref — re-run preview' }
  }

  let staged: StagedAssessment | null = null
  try {
    staged = await assess(input)
    if (staged.contentSha !== payload.manifestSha) {
      const freshToken = signConsentToken({
        source: staged.ref,
        manifestSha: staged.contentSha,
        permissions: summarizeConsent(staged.preview),
      })
      return { status: 'drift', preview: { ...staged.preview, consentToken: freshToken } }
    }

    // Re-install-as-update: remove any existing install of this id first, so
    // the same version doesn't collide and a bumped version doesn't leave a
    // stale duplicate entry projecting the same runtime skill.
    for (const key of existingSkillPackKeys(staged.preview.packageId)) {
      await removePackageById({ packageId: key })
    }

    // Install the VERIFIED staging verbatim (installer consumes the dir).
    const result = await installPackage({ source: ref, prefetched: staged.fetched })
    appendAudit(getContentDir(), 'skill.hub.installed', result.packageId, {
      ref,
      packageId: result.packageId,
      version: staged.preview.version,
      resolvedSha: staged.preview.resolvedSha ?? '',
      verdictState: staged.preview.verdictState,
    }, 'rest')
    return { status: 'installed', result, warnings: staged.preview.warnings }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isRefusal(err)) {
      appendAudit(getContentDir(), 'skill.hub.refused', ref, { ref, reason: message }, 'rest')
      return { status: 'refused', error: message }
    }
    log.error('skill install failed', err instanceof Error ? err : new Error(message), { ref })
    return { status: 'error', error: message }
  } finally {
    // No-op after a successful install (installer moved staging into place);
    // cleans up on drift, refusal, or a failed install.
    teardown(staged?.fetched ?? null)
  }
}
