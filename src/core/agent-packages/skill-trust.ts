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
import { appendAudit } from '../audit'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { normalizeSkillRef, parseClawhubRef } from './ref-normalize'
import { fetchSourceAsync, isClawhubSource, type FetchedSource } from './source-fetcher'
import { createClawhubClient } from './clawhub-client'
import { installPackage, type InstallResult } from './installer'

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
  verdictState: 'clean' | 'unverified' | 'none'
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
  const skillDirRel = manifest.kind === 'skill-pack' ? manifest.contributions.skills[0] : undefined
  const skillDir = skillDirRel ? join(staging, skillDirRel) : staging
  const files = existsSync(skillDir) ? readSkillTree(skillDir) : {}

  // Untranslated frontmatter metadata, verbatim (preview honesty).
  let rawMetadata: unknown
  const skillMd = files['SKILL.md']
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

  const requirements: SkillPreviewRequirements = {
    secrets: (manifest.secrets ?? []).map((s) => ({
      name: s.name, required: s.required, secretSlot: s.secretSlot, help: s.help,
    })),
    prereqs: manifest.kind === 'skill-pack'
      ? (manifest.requires?.prereqs ?? []).map((p) => ({ name: p.name, probe: p.probe, optional: p.optional }))
      : [],
    ...(manifest.kind === 'skill-pack' && manifest.platforms ? { platforms: manifest.platforms } : {}),
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
    .map(([path]) => ({ path, bytes: statSync(join(skillDir, path)).size }))
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
      verdictState: fetched.kind === 'clawhub'
        ? ((fetched.fetchWarnings ?? []).some((w) => w.includes('unverified')) ? 'unverified' : 'clean')
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

function isRefusal(message: string): boolean {
  return /refus|no override|binary files|unsafe file path|sanity cap|not for the active runtime|not available on this platform/i.test(message)
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
    const refused = isRefusal(message)
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
  return [
    ...preview.requirements.secrets.map((s) => `secret:${s.name}`),
    ...preview.requirements.prereqs.map((p) => `prereq:${p.probe}`),
    ...preview.risk.map((r) => `risk:${r.pattern}`),
  ]
}

/**
 * Phase 2 — token-validated install. Re-fetches and re-hashes; content
 * drift bounces to a FRESH preview (the plugin-gate pattern), so stale
 * consent never installs changed content.
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isRefusal(message)) {
      appendAudit(getContentDir(), 'skill.hub.refused', ref, { ref, reason: message }, 'rest')
      return { status: 'refused', error: message }
    }
    return { status: 'error', error: message }
  } finally {
    teardown(staged?.fetched ?? null)
  }

  try {
    const result = await installPackage({ source: ref })
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
    return isRefusal(message) ? { status: 'refused', error: message } : { status: 'error', error: message }
  }
}
