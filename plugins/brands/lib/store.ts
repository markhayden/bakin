/**
 * Brand store engine (#419, spec §3.1).
 *
 * Directory-per-brand under ~/.bakin/brands/<id>/:
 *   brand.json      — zod-validated manifest (atomic temp+rename writes)
 *   guidelines/*.md — freeform agent-readable docs
 *   lessons/*.md    — brand lessons
 *
 * Reads are honest: a corrupt manifest is reported as `invalid`, never
 * silently skipped. Read-modify-write mutations serialize behind a per-brand
 * async lock (mirrors the assets per-asset lock — single-process by design).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { parseFrontmatter } from '@bakin/core/format/frontmatter'
import { getBakinPaths } from '../../../src/core/content-dir'
import type { ConversationTurnRow } from '../../../src/core/conversation-turns'
import { brandIdSchema, brandManifestSchema, type BrandManifest } from './schemas'

export type BrandDocKind = 'guidelines' | 'lessons'

export interface BrandDocInfo {
  name: string
  /** One-line frontmatter `description:` — shown in the card's doc listing. */
  description?: string
  bytes: number
}

export type BrandReadResult =
  | { status: 'ok'; manifest: BrandManifest }
  | { status: 'missing' }
  | { status: 'invalid'; error: string }

export class BrandStoreError extends Error {
  constructor(
    readonly code: 'invalid_id' | 'exists' | 'missing' | 'invalid_manifest' | 'invalid_doc_name',
    message: string,
  ) {
    super(message)
    this.name = 'BrandStoreError'
  }
}

const brandsDir = () => getBakinPaths().brands
const brandDir = (id: string) => join(brandsDir(), id)
const manifestPath = (id: string) => join(brandDir(id), 'brand.json')

// ── Per-brand mutation lock (assets/lib/asset-lock.ts pattern) ─────────────
const tails = new Map<string, Promise<unknown>>()

function withBrandLock<T>(brandId: string, fn: () => Promise<T>): Promise<T> {
  const prior = tails.get(brandId) ?? Promise.resolve()
  const result = prior.then(() => fn(), () => fn())
  const tail = result.then(() => {}, () => {})
  tails.set(brandId, tail)
  void tail.finally(() => {
    if (tails.get(brandId) === tail) tails.delete(brandId)
  })
  return result
}

// ── Manifest CRUD ───────────────────────────────────────────────────────────

export interface CreateBrandInput {
  id: string
  name: string
  description?: string
  draft?: boolean
}

export function createBrand(input: CreateBrandInput): BrandManifest {
  const id = brandIdSchema.safeParse(input.id)
  if (!id.success) throw new BrandStoreError('invalid_id', `invalid brand id: ${input.id}`)
  if (existsSync(manifestPath(input.id))) {
    throw new BrandStoreError('exists', `brand already exists: ${input.id}`)
  }
  const now = new Date().toISOString()
  const manifest: BrandManifest = brandManifestSchema.parse({
    id: input.id,
    name: input.name,
    description: input.description,
    draft: input.draft,
    palette: [],
    logos: [],
    assetGroups: [],
    createdAt: now,
    updatedAt: now,
  })
  mkdirSync(join(brandDir(input.id), 'guidelines'), { recursive: true })
  mkdirSync(join(brandDir(input.id), 'lessons'), { recursive: true })
  atomicWriteJson(manifestPath(input.id), manifest)
  return manifest
}

export function getBrand(id: string): BrandReadResult {
  const path = manifestPath(id)
  if (!brandIdSchema.safeParse(id).success || !existsSync(path)) return { status: 'missing' }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    return { status: 'invalid', error: `brand.json is not valid JSON: ${String(err)}` }
  }
  const parsed = brandManifestSchema.safeParse(raw)
  if (!parsed.success) return { status: 'invalid', error: parsed.error.message }
  return { status: 'ok', manifest: parsed.data }
}

export function listBrands(): { brands: BrandManifest[]; invalid: Array<{ id: string; error: string }> } {
  const root = brandsDir()
  if (!existsSync(root)) return { brands: [], invalid: [] }
  const brands: BrandManifest[] = []
  const invalid: Array<{ id: string; error: string }> = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const read = getBrand(entry.name)
    if (read.status === 'ok') brands.push(read.manifest)
    else if (read.status === 'invalid') invalid.push({ id: entry.name, error: read.error })
    // 'missing' = a stray dir without brand.json; also surface as invalid
    else invalid.push({ id: entry.name, error: 'directory has no valid brand.json' })
  }
  brands.sort((a, b) => a.name.localeCompare(b.name))
  return { brands, invalid }
}

/**
 * Full validated manifest replace. The brand must already exist (id is
 * immutable — rename = create new + relink); createdAt is preserved from
 * disk, updatedAt is stamped here.
 */
export function saveManifest(manifest: BrandManifest): BrandManifest {
  const current = getBrand(manifest.id)
  if (current.status === 'missing') {
    throw new BrandStoreError('missing', `brand not found: ${manifest.id}`)
  }
  const next = brandManifestSchema.parse({
    ...manifest,
    createdAt: current.status === 'ok' ? current.manifest.createdAt : manifest.createdAt,
    updatedAt: new Date().toISOString(),
  })
  atomicWriteJson(manifestPath(manifest.id), next)
  return next
}

/** Serialized read-modify-write mutation. Prefer this over get+saveManifest races. */
export function updateBrand(
  id: string,
  mutate: (manifest: BrandManifest) => Promise<BrandManifest> | BrandManifest,
): Promise<BrandManifest> {
  return withBrandLock(id, async () => {
    const current = getBrand(id)
    if (current.status === 'missing') throw new BrandStoreError('missing', `brand not found: ${id}`)
    if (current.status === 'invalid') {
      throw new BrandStoreError('invalid_manifest', `brand ${id} manifest is invalid: ${current.error}`)
    }
    return saveManifest(await mutate(current.manifest))
  })
}

export function deleteBrand(id: string): boolean {
  if (!brandIdSchema.safeParse(id).success) return false
  const dir = brandDir(id)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

// ── Guideline / lesson docs ─────────────────────────────────────────────────

const DOC_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9._-]*\.md$/

function docPath(brandId: string, kind: BrandDocKind, name: string): string {
  // Validate the brandId too — read_doc reaches here with an agent-supplied id,
  // and an unvalidated `../..` would escape the brands store (the slug regex
  // forbids `/` and `..`). Defense-in-depth for every doc path.
  if (!brandIdSchema.safeParse(brandId).success) {
    throw new BrandStoreError('invalid_id', `invalid brand id: ${brandId}`)
  }
  if (!DOC_NAME_RE.test(name) || name.includes('/') || name.includes('..')) {
    throw new BrandStoreError('invalid_doc_name', `invalid doc name: ${name}`)
  }
  return join(brandDir(brandId), kind, name)
}

export function listDocs(brandId: string, kind: BrandDocKind): BrandDocInfo[] {
  const dir = join(brandDir(brandId), kind)
  if (!existsSync(dir)) return []
  const docs: BrandDocInfo[] = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue
    const path = join(dir, name)
    const content = readFileSync(path, 'utf-8')
    const { frontmatter } = parseFrontmatter(content)
    const description = typeof frontmatter.description === 'string' ? frontmatter.description : undefined
    docs.push({ name, description, bytes: statSync(path).size })
  }
  return docs
}

export function readDoc(brandId: string, kind: BrandDocKind, name: string): string | null {
  const path = docPath(brandId, kind, name)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8')
}

export function writeDoc(brandId: string, kind: BrandDocKind, name: string, content: string): void {
  const path = docPath(brandId, kind, name)
  mkdirSync(join(brandDir(brandId), kind), { recursive: true })
  writeFileSync(path, content, 'utf-8')
}

export function deleteDoc(brandId: string, kind: BrandDocKind, name: string): boolean {
  const path = docPath(brandId, kind, name)
  if (!existsSync(path)) return false
  unlinkSync(path)
  const transcript = docBrainstormPath(brandId, kind, name)
  if (existsSync(transcript)) unlinkSync(transcript)
  return true
}

// ── Doc brainstorm transcripts (#703) ───────────────────────────────────────
// Durable per-doc conversation sidecars; rows are the conversation kit's
// storable shape (the engine's ConversationTurnRow). Deleting the doc (or
// the brand directory) removes its transcript.

function docBrainstormPath(brandId: string, kind: BrandDocKind, name: string): string {
  docPath(brandId, kind, name) // same id/name validation, throws on escape attempts
  return join(brandDir(brandId), 'brainstorms', kind, `${name}.json`)
}

export function readDocBrainstorm(brandId: string, kind: BrandDocKind, name: string): ConversationTurnRow[] {
  const path = docBrainstormPath(brandId, kind, name)
  if (!existsSync(path)) return []
  try {
    const rows = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return Array.isArray(rows) ? (rows as ConversationTurnRow[]) : []
  } catch {
    // A torn write loses the transcript, never the surface.
    return []
  }
}

export function appendDocBrainstormRow(
  brandId: string,
  kind: BrandDocKind,
  name: string,
  row: ConversationTurnRow,
): void {
  const path = docBrainstormPath(brandId, kind, name)
  mkdirSync(join(brandDir(brandId), 'brainstorms', kind), { recursive: true })
  atomicWriteJson(path, [...readDocBrainstorm(brandId, kind, name), row])
}

const lessonSlug = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'lesson'

/**
 * Append a lesson (#419) — collision-SAFE: never overwrites an existing lesson
 * with the same slug (suffixes a counter instead). The single append-only
 * write path shared by the exec tool and the quick-add route; banked brand
 * learning is never silently destroyed. Returns the filename written.
 */
export function addLesson(brandId: string, title: string, body: string): string {
  let name = `${lessonSlug(title)}.md`
  for (let n = 2; readDoc(brandId, 'lessons', name) !== null; n++) {
    name = `${lessonSlug(title)}-${n}.md`
  }
  writeDoc(brandId, 'lessons', name, `---\ntitle: ${title}\n---\n\n${body}\n`)
  return name
}
