/**
 * Brand card builder (#419, spec §5.1/§5.2/§5.5).
 *
 * The compact always-inline tier makes minimum brand compliance unavoidable;
 * depth is pull-based through the brands exec tools. Byte-budgeted with
 * WHOLE-UNIT retention in tier priority order — never mid-document
 * truncation; every drop leaves a visible marker pointing at the tool that
 * retrieves it. Pure function of the brand's on-disk state + inputs: the
 * lessons tier is injected by the dispatch-side retrieval layer so this
 * module never touches the search stack.
 */
import { getBrand, listDocs, readDoc } from './store'
import { computeBrandFingerprint } from './fingerprint'
import { splitFrontmatter } from '@bakin/core/format/frontmatter'
import type { BrandManifest } from './schemas'

export interface BrandCardMeta {
  brandId: string
  brandFingerprint: string | null
  cardBytes: number
  /** Inline doc/lesson units that made the card (by filename). */
  sectionsIncluded: string[]
  lessonsIncluded: string[]
  omitted: Array<{ item: string; reason: string }>
}

export interface BrandCardResult {
  card: string
  meta: BrandCardMeta
  warnings: string[]
}

export interface BrandCardInput {
  maxBytes: number
  /** Retrieved brand lessons (T3.1 retrieval layer) — already relevance-ranked. */
  lessons?: Array<{ name: string; body: string }>
  /** Search engine down — render the honest marker instead of lessons. */
  lessonsUnavailable?: boolean
  /** Injected existence check (ctx.assets.getAsset) for dangling-ref warnings. */
  assetExists?: (assetId: string) => Promise<boolean>
}

const bytes = (s: string) => Buffer.byteLength(s, 'utf-8')

function docBody(brandId: string, name: string): string | null {
  const content = readDoc(brandId, 'guidelines', name)
  if (content === null) return null
  return splitFrontmatter(content).body
}

async function collectAssetWarnings(
  manifest: BrandManifest,
  assetExists?: (assetId: string) => Promise<boolean>,
): Promise<{ warnings: string[]; missing: Set<string> }> {
  const missing = new Set<string>()
  if (!assetExists) return { warnings: [], missing }
  const refs = new Map<string, string>()
  for (const logo of manifest.logos) refs.set(logo.assetId, `logo (${logo.variant})`)
  for (const group of manifest.assetGroups) {
    for (const id of group.assetIds) refs.set(id, `group ${group.name}`)
  }
  for (const id of manifest.defaultImageReferences ?? []) {
    if (!refs.has(id)) refs.set(id, 'defaultImageReferences')
  }
  const warnings: string[] = []
  for (const [assetId, where] of refs) {
    try {
      if (!(await assetExists(assetId))) {
        missing.add(assetId)
        warnings.push(`asset ${assetId} missing (${where})`)
      }
    } catch {
      // Existence check unavailable — never block the card over it.
    }
  }
  return { warnings, missing }
}

/**
 * Build the dispatch brand card. Draft and missing brands are sentinel
 * `notFound` — a draft can never brand real work (spec §9.1).
 */
export async function buildBrandCard(
  brandId: string,
  input: BrandCardInput,
): Promise<BrandCardResult | { notFound: true }> {
  const read = getBrand(brandId)
  if (read.status !== 'ok' || read.manifest.draft) return { notFound: true }
  const manifest = read.manifest

  const { warnings, missing } = await collectAssetWarnings(manifest, input.assetExists)
  const guidelines = listDocs(brandId, 'guidelines')
  const cardDocNames = manifest.cardDocs ?? (guidelines.some((d) => d.name === 'voice.md') ? ['voice.md'] : [])

  // ── Always-inline tiers (1-3): header, rules/palette/terminology, listings ──
  const always: string[] = []
  always.push(
    `## Brand: ${manifest.name} (${manifest.id})`,
    '',
    'All output for this task MUST follow this brand. Use ONLY this brand\'s materials — disregard knowledge of any other brand.',
    `Deeper guidelines and assets are listed below — fetch what this task needs via bakin_exec_brands_get / bakin_exec_brands_read_doc (brandId: "${manifest.id}").`,
  )
  if (manifest.description) always.push('', manifest.description)

  if (manifest.rules?.length) {
    always.push('', '### Rules (absolute)', ...manifest.rules.map((r) => `- ${r}`))
  }
  if (manifest.palette.length) {
    always.push('', '### Palette', ...manifest.palette.map((c) => `- ${c.name}: ${c.hex}${c.usage ? ` (${c.usage})` : ''}`))
  }
  if (manifest.terminology?.length) {
    always.push('', '### Terminology', ...manifest.terminology.map((t) => `- "${t.term}" — ${t.rule}`))
  }

  const inlineSet = new Set(cardDocNames)
  const listedDocs = guidelines.filter((d) => !inlineSet.has(d.name))
  if (listedDocs.length) {
    always.push('', '### Guideline docs (fetch as needed)')
    for (const d of listedDocs) {
      always.push(`- ${d.name}${d.description ? ` — ${d.description}` : ''} → bakin_exec_brands_read_doc`)
    }
  }

  const assetLines: string[] = []
  for (const logo of manifest.logos) {
    assetLines.push(`- logo ${logo.variant}: ${logo.assetId}${missing.has(logo.assetId) ? ' ⚠ missing' : ''}`)
  }
  for (const group of manifest.assetGroups) {
    const ids = group.assetIds.map((id) => `${id}${missing.has(id) ? ' ⚠ missing' : ''}`).join(', ')
    assetLines.push(`- group ${group.name}${group.description ? ` (${group.description})` : ''}: ${ids || '(empty)'}`)
  }
  if (assetLines.length) {
    always.push('', '### Brand assets', ...assetLines)
    always.push(`Pass brandId: "${manifest.id}" to image tools — palette and default reference images apply automatically.`)
  }

  // ── Budgeted tiers (4-5): inline card docs, then lessons — whole units ──
  const alwaysText = always.join('\n')
  let budgetLeft = Math.max(0, input.maxBytes - bytes(alwaysText))
  const sectionsIncluded: string[] = []
  const lessonsIncluded: string[] = []
  const omitted: Array<{ item: string; reason: string }> = []
  const budgeted: string[] = []
  const markers: string[] = []

  for (const name of cardDocNames) {
    const body = docBody(brandId, name)
    if (body === null) {
      omitted.push({ item: name, reason: 'doc not found' })
      continue
    }
    const section = `\n\n### ${name}\n${body}`
    if (bytes(section) <= budgetLeft) {
      budgeted.push(section)
      budgetLeft -= bytes(section)
      sectionsIncluded.push(name)
    } else {
      omitted.push({ item: name, reason: 'over brand context budget' })
      markers.push(`(${name} omitted for size — fetch via bakin_exec_brands_read_doc)`)
    }
  }

  if (input.lessonsUnavailable) {
    markers.push('⚠ brand lessons unavailable (search engine down) — proceed with the guidelines above')
  } else if (input.lessons?.length) {
    let lessonBlock = ''
    for (const lesson of input.lessons) {
      const section = `\n- [${lesson.name}] ${lesson.body}`
      if (bytes(section) <= budgetLeft) {
        lessonBlock += section
        budgetLeft -= bytes(section)
        lessonsIncluded.push(lesson.name)
      } else {
        omitted.push({ item: lesson.name, reason: 'over brand context budget' })
      }
    }
    if (lessonBlock) budgeted.push(`\n\n### Brand lessons (from past work)${lessonBlock}`)
    const droppedLessons = input.lessons.length - lessonsIncluded.length
    if (droppedLessons > 0) markers.push(`(${droppedLessons} brand lesson${droppedLessons === 1 ? '' : 's'} omitted for size)`)
  }

  const card = [alwaysText, ...budgeted, ...(markers.length ? [`\n\n${markers.join('\n')}`] : [])].join('')

  return {
    card,
    warnings,
    meta: {
      brandId: manifest.id,
      brandFingerprint: computeBrandFingerprint(manifest.id),
      cardBytes: bytes(card),
      sectionsIncluded,
      lessonsIncluded,
      omitted,
    },
  }
}
