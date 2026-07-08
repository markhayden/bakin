/**
 * Portable brand format (#419, spec §3.4/§7.3) — the repo/export shape.
 *
 * A repo cannot contain machine-local assetIds, so the portable manifest
 * references files by relative path under assets/. This module is the ONLY
 * converter between the two shapes:
 *   export: installed manifest → portable dir (asset files copied out)
 *   import: portable dir → installed brand (files ingested as managed
 *           assets, path refs rewritten to assetIds, provenance stamped)
 *
 * Import never writes on validation failure; re-import of an existing brand
 * requires the caller's explicit overwrite consent (local edits win).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { basename, extname, join, normalize } from 'path'
import type { PluginContext } from '@bakin/core/plugin-types'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { getBakinPaths } from '../../../src/core/content-dir'
import {
  brandManifestSchema,
  portableBrandSchema,
  type BrandManifest,
  type PortableBrand,
} from './schemas'
import { getBrand, listDocs, readDoc, deleteBrand } from './store'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const PDF_EXTS = new Set(['.pdf'])

function assetTypeFor(file: string): 'images' | 'pdf' | 'other' {
  const ext = extname(file).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'images'
  if (PDF_EXTS.has(ext)) return 'pdf'
  return 'other'
}

/** Reject refs that escape the portable dir (zip-slip style). */
function safeRel(sourceDir: string, rel: string): string {
  const normalized = normalize(rel).replace(/\\/g, '/')
  if (normalized.startsWith('..') || normalized.startsWith('/')) {
    throw new Error(`unsafe file reference in portable manifest: ${rel}`)
  }
  const abs = join(sourceDir, normalized)
  if (!abs.startsWith(normalize(sourceDir))) {
    throw new Error(`unsafe file reference in portable manifest: ${rel}`)
  }
  return abs
}

export interface ImportResult {
  brand: BrandManifest
  importedAssets: number
  docs: number
}

export interface ImportOptions {
  sourceDir: string
  ctx: PluginContext
  /** Provenance source string, e.g. `github:user/repo` or the local path. */
  source: string
  ref?: string
  commit?: string
  /** Replace an existing brand of the same id (consent handled by the caller). */
  overwrite?: boolean
  agent?: string
}

/** Validate a portable dir WITHOUT writing anything — the preview + import gate. */
export function validatePortableDir(sourceDir: string):
  | { ok: true; portable: PortableBrand; files: string[]; guidelines: string[]; lessons: string[] }
  | { ok: false; error: string } {
  const manifestPath = join(sourceDir, 'brand.json')
  if (!existsSync(manifestPath)) return { ok: false, error: 'brand.json not found in source' }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    return { ok: false, error: `brand.json is not valid JSON: ${String(err)}` }
  }
  const parsed = portableBrandSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: `invalid portable manifest: ${parsed.error.message}` }

  const files = new Set<string>()
  for (const logo of parsed.data.logos) files.add(logo.file)
  for (const group of parsed.data.assetGroups ?? []) for (const f of group.files) files.add(f)
  for (const f of parsed.data.defaultImageReferences ?? []) files.add(f)
  for (const rel of files) {
    try {
      if (!existsSync(safeRel(sourceDir, rel))) return { ok: false, error: `referenced file missing: ${rel}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const listMd = (kind: string) => {
    const dir = join(sourceDir, kind)
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((f) => f.endsWith('.md'))
  }
  return {
    ok: true,
    portable: parsed.data,
    files: [...files],
    guidelines: listMd('guidelines'),
    lessons: listMd('lessons'),
  }
}

export async function importBrand(opts: ImportOptions): Promise<ImportResult> {
  const validated = validatePortableDir(opts.sourceDir)
  if (!validated.ok) throw new Error(validated.error)
  const { portable } = validated

  const existing = getBrand(portable.id)
  if (existing.status !== 'missing' && !opts.overwrite) {
    throw new Error(`brand '${portable.id}' already exists — re-import with overwrite to replace it (local edits win otherwise)`)
  }

  // Ingest every referenced file as a managed asset (dedup within this import).
  const assetIdByFile = new Map<string, string>()
  const agent = opts.agent ?? 'system'
  const ingest = async (rel: string): Promise<string> => {
    const cached = assetIdByFile.get(rel)
    if (cached) return cached
    const abs = safeRel(opts.sourceDir, rel)
    const ref = await opts.ctx.assets.createAsset({
      sourceFilePath: abs,
      type: assetTypeFor(rel),
      agent,
      taskId: null,
      op: 'import',
      tool: 'brands_import',
      description: `${portable.name} brand asset: ${basename(rel)}`,
      source: { kind: 'import', path: abs },
    })
    assetIdByFile.set(rel, ref.assetId)
    return ref.assetId
  }

  const logos: BrandManifest['logos'] = []
  for (const logo of portable.logos) logos.push({ assetId: await ingest(logo.file), variant: logo.variant })
  const assetGroups: BrandManifest['assetGroups'] = []
  for (const group of portable.assetGroups ?? []) {
    const assetIds: string[] = []
    for (const f of group.files) assetIds.push(await ingest(f))
    assetGroups.push({ name: group.name, description: group.description, assetIds })
  }
  const defaultImageReferences: string[] = []
  for (const f of portable.defaultImageReferences ?? []) defaultImageReferences.push(await ingest(f))

  const now = new Date().toISOString()
  const manifest: BrandManifest = brandManifestSchema.parse({
    id: portable.id,
    name: portable.name,
    description: portable.description,
    palette: portable.palette,
    rules: portable.rules,
    terminology: portable.terminology,
    cardDocs: portable.cardDocs,
    logos,
    assetGroups,
    ...(defaultImageReferences.length ? { defaultImageReferences } : {}),
    source: { repo: opts.source, ref: opts.ref, commit: opts.commit, importedAt: now },
    createdAt: now,
    updatedAt: now,
  })

  const brandsRoot = getBakinPaths().brands
  const finalDir = join(brandsRoot, manifest.id)
  // Stage-then-swap: build the WHOLE brand in a sibling temp dir, then swap it
  // into place last. An overwrite import must NEVER delete the existing brand
  // before the replacement is proven writable — a mid-import failure (bad
  // source file, disk full) would otherwise leave no brand installed and every
  // linked task deferring, with local lessons unrecoverable.
  const stagingDir = `${finalDir}.importing-${manifest.id}-${assetIdByFile.size}${portable.palette.length}`
  rmSync(stagingDir, { recursive: true, force: true })
  let docs = 0
  try {
    mkdirSync(join(stagingDir, 'guidelines'), { recursive: true })
    mkdirSync(join(stagingDir, 'lessons'), { recursive: true })
    for (const kind of ['guidelines', 'lessons'] as const) {
      const srcDir = join(opts.sourceDir, kind)
      if (!existsSync(srcDir)) continue
      for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.md'))) {
        copyFileSync(join(srcDir, file), join(stagingDir, kind, file))
        docs++
      }
    }
    atomicWriteJson(join(stagingDir, 'brand.json'), manifest)

    // Swap: remove the old brand only now that staging is fully built. The
    // window between remove and rename is a same-directory rename (near-atomic).
    if (existing.status !== 'missing') deleteBrand(manifest.id)
    renameSync(stagingDir, finalDir)
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw err
  }

  return { brand: manifest, importedAssets: assetIdByFile.size, docs }
}

export interface ExportResult {
  dir: string
  files: string[]
}

/** Export an installed brand to a portable directory (assetIds → copied files). */
export async function exportBrand(brandId: string, destDir: string, ctx: PluginContext): Promise<ExportResult> {
  const read = getBrand(brandId)
  if (read.status !== 'ok') throw new Error(`brand not found: ${brandId}`)
  const manifest = read.manifest
  const files: string[] = []

  mkdirSync(join(destDir, 'assets'), { recursive: true })
  const fileByAssetId = new Map<string, string>()
  const copyOut = async (assetId: string): Promise<string> => {
    const cached = fileByAssetId.get(assetId)
    if (cached) return cached
    const resolved = await ctx.assets.resolveVersionFile(assetId)
    if (!resolved) throw new Error(`asset not found while exporting: ${assetId}`)
    const ext = extname(resolved.absPath) || ''
    const rel = `assets/${assetId}${ext}`
    copyFileSync(resolved.absPath, join(destDir, rel))
    fileByAssetId.set(assetId, rel)
    files.push(rel)
    return rel
  }

  const portable: PortableBrand = {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    palette: manifest.palette,
    rules: manifest.rules,
    terminology: manifest.terminology,
    cardDocs: manifest.cardDocs,
    logos: await Promise.all(manifest.logos.map(async (l) => ({ file: await copyOut(l.assetId), variant: l.variant }))),
    assetGroups: await Promise.all(
      manifest.assetGroups.map(async (g) => ({
        name: g.name,
        description: g.description,
        files: await Promise.all(g.assetIds.map(copyOut)),
      })),
    ),
    ...(manifest.defaultImageReferences?.length
      ? { defaultImageReferences: await Promise.all(manifest.defaultImageReferences.map(copyOut)) }
      : {}),
  }

  for (const kind of ['guidelines', 'lessons'] as const) {
    const docsList = listDocs(brandId, kind)
    if (!docsList.length) continue
    mkdirSync(join(destDir, kind), { recursive: true })
    for (const d of docsList) {
      const content = readDoc(brandId, kind, d.name)
      if (content === null) continue
      writeFileSync(join(destDir, kind, d.name), content, 'utf-8')
      files.push(`${kind}/${d.name}`)
    }
  }

  atomicWriteJson(join(destDir, 'brand.json'), portableBrandSchema.parse(portable))
  files.push('brand.json')
  return { dir: destDir, files }
}
