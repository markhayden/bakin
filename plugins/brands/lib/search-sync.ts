/**
 * Brands search content types (#419, spec §6/§9).
 *
 * Two file-backed registrations (watcher sync/unlink → durable outbox, zero
 * boot reconcile — house search rules):
 *   - `brand-lessons`: brands/<id>/lessons/*.md, faceted by brand_id — the
 *     dispatch-retrieval source (mirror of agent-lessons).
 *   - `brands`: brands/<id>/guidelines/*.md + brand.json, faceted by
 *     brand_id — global/⌘K search over brand content.
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { PluginContext } from '@bakin/core/plugin-types'
import { parseFrontmatter } from '@bakin/core/format/frontmatter'
import { getContentDir } from '../../../src/core/content-dir'
import { brandManifestSchema } from './schemas'

const LESSON_RE = /^brands\/([^/]+)\/lessons\/([^/]+)\.md$/
const GUIDELINE_RE = /^brands\/([^/]+)\/guidelines\/([^/]+)\.md$/
const MANIFEST_RE = /^brands\/([^/]+)\/brand\.json$/

const norm = (rel: string) => rel.replace(/\\/g, '/')

export function brandLessonFileToId(rel: string): string {
  const m = norm(rel).match(LESSON_RE)
  if (!m) return norm(rel).replace(/[^a-zA-Z0-9_]+/g, '_')
  return `${m[1]}/${m[2]}`
}

export async function brandLessonFileToDoc(rel: string): Promise<Record<string, unknown> | null> {
  const m = norm(rel).match(LESSON_RE)
  if (!m) return null
  const abs = join(getContentDir(), norm(rel))
  if (!existsSync(abs)) return null
  let raw: string
  try {
    raw = readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
  const { frontmatter, body } = parseFrontmatter(raw)
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : m[2]
  return {
    title,
    body,
    brand_id: m[1],
    lesson_id: m[2],
    updated_at: new Date().toISOString(),
  }
}

export function brandContentFileToId(rel: string): string {
  const n = norm(rel)
  const g = n.match(GUIDELINE_RE)
  if (g) return `${g[1]}/guidelines/${g[2]}`
  const mf = n.match(MANIFEST_RE)
  if (mf) return `${mf[1]}/manifest`
  return n.replace(/[^a-zA-Z0-9_]+/g, '_')
}

export async function brandContentFileToDoc(rel: string): Promise<Record<string, unknown> | null> {
  const n = norm(rel)
  const abs = join(getContentDir(), n)
  if (!existsSync(abs)) return null

  const g = n.match(GUIDELINE_RE)
  if (g) {
    let raw: string
    try {
      raw = readFileSync(abs, 'utf-8')
    } catch {
      return null
    }
    const { frontmatter, body } = parseFrontmatter(raw)
    return {
      title: `${g[1]}: ${g[2]}.md`,
      body,
      description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
      brand_id: g[1],
      doc: `${g[2]}.md`,
      updated_at: new Date().toISOString(),
    }
  }

  const mf = n.match(MANIFEST_RE)
  if (mf) {
    try {
      const parsed = brandManifestSchema.safeParse(JSON.parse(readFileSync(abs, 'utf-8')))
      if (!parsed.success) return null
      const m = parsed.data
      const body = [
        m.description ?? '',
        ...(m.rules ?? []),
        ...(m.terminology ?? []).map((t) => `${t.term} — ${t.rule}`),
        ...m.palette.map((c) => `${c.name} ${c.hex}`),
      ].filter(Boolean).join('\n')
      return {
        title: `${m.name} (brand)`,
        body,
        description: m.description ?? '',
        brand_id: m.id,
        doc: 'brand.json',
        updated_at: m.updatedAt,
      }
    } catch {
      return null
    }
  }
  return null
}

function listBrandDirs(): string[] {
  const root = join(getContentDir(), 'brands')
  if (!existsSync(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

function listKindFiles(brandId: string, kind: 'lessons' | 'guidelines'): string[] {
  const dir = join(getContentDir(), 'brands', brandId, kind)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
}

export function registerBrandsSearch(ctx: PluginContext): void {
  ctx.search.registerFileBackedContentType({
    table: 'brand-lessons',
    schemaVersion: 1,
    schema: {
      title: { type: 'text' },
      body: { type: 'text' },
      brand_id: { type: 'keyword' },
      lesson_id: { type: 'keyword' },
      updated_at: { type: 'datetime' },
    },
    searchableFields: ['title', 'body'],
    rerankField: 'body',
    embeddingTemplate: '{{title}} {{body}}',
    facets: ['brand_id'],
    chunker: { enabled: true, targetTokens: 250, overlapTokens: 30 },
    filePatterns: [
      {
        pattern: 'brands/*/lessons/*.md',
        fileToId: brandLessonFileToId,
        fileToDoc: brandLessonFileToDoc,
      },
    ],
    reindex: async function* () {
      for (const brandId of listBrandDirs()) {
        for (const file of listKindFiles(brandId, 'lessons')) {
          const rel = `brands/${brandId}/lessons/${file}`
          const doc = await brandLessonFileToDoc(rel)
          if (doc) yield { key: brandLessonFileToId(rel), doc }
        }
      }
    },
    verifyExists: async (id) => {
      const [brandId, lesson] = id.split('/')
      return existsSync(join(getContentDir(), 'brands', brandId ?? '', 'lessons', `${lesson}.md`))
    },
  })

  ctx.search.registerFileBackedContentType({
    table: 'brands',
    schemaVersion: 1,
    schema: {
      title: { type: 'text' },
      body: { type: 'text' },
      description: { type: 'text' },
      brand_id: { type: 'keyword' },
      doc: { type: 'keyword' },
      updated_at: { type: 'datetime' },
    },
    searchableFields: ['title', 'body', 'description'],
    rerankField: 'body',
    embeddingTemplate: '{{title}} {{description}} {{body}}',
    facets: ['brand_id', 'doc'],
    chunker: { enabled: true, targetTokens: 250, overlapTokens: 30 },
    filePatterns: [
      {
        pattern: 'brands/*/guidelines/*.md',
        fileToId: brandContentFileToId,
        fileToDoc: brandContentFileToDoc,
      },
      {
        pattern: 'brands/*/brand.json',
        fileToId: brandContentFileToId,
        fileToDoc: brandContentFileToDoc,
      },
    ],
    reindex: async function* () {
      for (const brandId of listBrandDirs()) {
        const rels = [
          `brands/${brandId}/brand.json`,
          ...listKindFiles(brandId, 'guidelines').map((f) => `brands/${brandId}/guidelines/${f}`),
        ]
        for (const rel of rels) {
          const doc = await brandContentFileToDoc(rel)
          if (doc) yield { key: brandContentFileToId(rel), doc }
        }
      }
    },
    verifyExists: async (id) => {
      const [brandId] = id.split('/')
      return existsSync(join(getContentDir(), 'brands', brandId ?? '', 'brand.json'))
    },
  })
}
