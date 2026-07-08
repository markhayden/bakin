/**
 * Portable brand format (#419, spec §3.4): validation gate, import with
 * asset ingestion + path→assetId rewiring + provenance, export with
 * assetId→file copy-out, and the semantic round-trip
 * import(export(brand)) ≡ brand (assetIds are machine-local by design, so
 * equivalence is semantic — docs, palette, rules, group shapes, file bytes).
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-brand-portable-${Date.now()}-${randomUUID()}`)
const paths = () => ({
  home: testDir,
  brands: join(testDir, 'brands'),
  db: join(testDir, 'bakin.db'),
})

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: paths,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: paths,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
// Github clones are mocked: "materialize" = copy the seeded portable dir into
// the staging dir and report a fixed commit; the second call reports a newer
// commit so the drift check has something to detect.
const upstreamCommits = ['commit-aaa', 'commit-aaa', 'commit-bbb']
let materializeCalls = 0
mock.module('../../../src/core/github-source-cache', () => ({
  materializeCachedGithubSource: mock(async (args: { stagingDir: string }) => {
    const { cpSync } = await import('fs')
    cpSync(join(testDir, 'src'), args.stagingDir, { recursive: true })
    const commitSha = upstreamCommits[Math.min(materializeCalls, upstreamCommits.length - 1)]
    materializeCalls++
    return { checkoutDir: args.stagingDir, commitSha }
  }),
}))

import { validatePortableDir, importBrand, exportBrand } from '../../../plugins/brands/lib/portable'
import { getBrand, listDocs, readDoc } from '../../../plugins/brands/lib/store'
import type { PluginContext } from '@bakin/core/plugin-types'

// Minimal assets service: ingested files tracked in-memory, resolvable back out.
function makeAssetsCtx() {
  const byId = new Map<string, string>()
  let seq = 0
  const ctx = {
    assets: {
      createAsset: mock(async (input: { sourceFilePath: string }) => {
        const assetId = `20260708-imported-${(seq++).toString().padStart(4, '0')}`
        byId.set(assetId, input.sourceFilePath)
        return { assetId, version: 1 }
      }),
      resolveVersionFile: mock(async (assetId: string) => {
        const absPath = byId.get(assetId)
        return absPath ? { absPath, mimeType: 'image/png', version: 1 } : null
      }),
    },
  } as unknown as PluginContext
  return { ctx, byId }
}

function seedPortableDir(dir: string) {
  mkdirSync(join(dir, 'assets'), { recursive: true })
  mkdirSync(join(dir, 'guidelines'), { recursive: true })
  mkdirSync(join(dir, 'lessons'), { recursive: true })
  writeFileSync(join(dir, 'assets', 'logo-dark.png'), 'LOGO-BYTES')
  writeFileSync(join(dir, 'assets', 'shot1.png'), 'SHOT-BYTES')
  writeFileSync(join(dir, 'guidelines', 'voice.md'), '---\ndescription: how we talk\n---\n\nWarm and direct.')
  writeFileSync(join(dir, 'lessons', 'tweet-flops.md'), 'No Friday threads.')
  writeFileSync(
    join(dir, 'brand.json'),
    JSON.stringify({
      id: 'acme',
      name: 'Acme',
      description: 'Warm bakery software.',
      palette: [{ name: 'ink', hex: '#1A1A2E', usage: 'primary' }],
      rules: ['Never use emojis'],
      logos: [{ file: 'assets/logo-dark.png', variant: 'dark' }],
      assetGroups: [{ name: 'app-screenshots', description: 'real UI', files: ['assets/shot1.png'] }],
      defaultImageReferences: ['assets/logo-dark.png'],
    }),
  )
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('validatePortableDir', () => {
  it('accepts a valid dir and rejects missing manifests, bad schema, missing files, escapes', () => {
    const src = join(testDir, 'src')
    seedPortableDir(src)
    const ok = validatePortableDir(src)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.files.sort()).toEqual(['assets/logo-dark.png', 'assets/shot1.png'])

    expect(validatePortableDir(join(testDir, 'nope')).ok).toBe(false)

    rmSync(join(src, 'assets', 'shot1.png'))
    const missing = validatePortableDir(src)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('shot1.png')

    seedPortableDir(src)
    writeFileSync(join(src, 'brand.json'), JSON.stringify({ id: 'acme', name: 'Acme', palette: [], logos: [{ file: '../../etc/evil', variant: 'x' }] }))
    expect(validatePortableDir(src).ok).toBe(false)
  })
})

describe('importBrand', () => {
  it('ingests assets, rewires refs, stamps provenance; refuses existing ids without overwrite', async () => {
    const src = join(testDir, 'src')
    seedPortableDir(src)
    const { ctx } = makeAssetsCtx()

    const result = await importBrand({ sourceDir: src, ctx, source: 'github:me/acme-brand', commit: 'abc123' })
    expect(result.importedAssets).toBe(2) // logo dedupes with defaultImageReferences
    expect(result.docs).toBe(2)

    const read = getBrand('acme')
    if (read.status !== 'ok') throw new Error('expected brand')
    expect(read.manifest.logos[0].assetId).toMatch(/^20260708-imported-/)
    expect(read.manifest.assetGroups[0].assetIds).toHaveLength(1)
    expect(read.manifest.defaultImageReferences?.[0]).toBe(read.manifest.logos[0].assetId) // dedup within import
    expect(read.manifest.source).toMatchObject({ repo: 'github:me/acme-brand', commit: 'abc123' })
    expect(readDoc('acme', 'guidelines', 'voice.md')).toContain('Warm and direct.')

    await expect(importBrand({ sourceDir: src, ctx, source: 'x' })).rejects.toThrow(/already exists/)
    // Overwrite replaces
    const again = await importBrand({ sourceDir: src, ctx, source: 'x', overwrite: true })
    expect(again.brand.id).toBe('acme')
  })

  it('a failed overwrite import leaves the EXISTING brand intact (stage-then-swap)', async () => {
    const src = join(testDir, 'src')
    seedPortableDir(src)
    const { ctx } = makeAssetsCtx()
    await importBrand({ sourceDir: src, ctx, source: 'origin' })
    // Add a local lesson the operator would lose if import were destructive
    writeFileSync(join(testDir, 'brands', 'acme', 'lessons', 'local-only.md'), 'Hand-added.')

    // Break the source so the re-import fails partway (asset ingest throws)
    const brokenCtx = {
      assets: { createAsset: mock(async () => { throw new Error('disk full') }) },
    } as unknown as PluginContext
    await expect(importBrand({ sourceDir: src, ctx: brokenCtx, source: 'origin', overwrite: true })).rejects.toThrow(/disk full/)

    // The original brand — including the local lesson — survives
    const read = getBrand('acme')
    expect(read.status).toBe('ok')
    expect(readDoc('acme', 'lessons', 'local-only.md')).toContain('Hand-added.')
  })
})

describe('github import routes (#419 S6)', () => {
  it('preview writes nothing; import stamps commit provenance; check detects drift', async () => {
    const src = join(testDir, 'src')
    seedPortableDir(src)
    const brandsPlugin = (await import('../../../plugins/brands')).default
    const { activatePlugin, callRoute, findRoute } = await import('../test-helpers')
    const activated = await activatePlugin(brandsPlugin, testDir)
    const route = (method: string, path: string) => {
      const r = findRoute(activated.routes, method, path)
      if (!r) throw new Error(`route not found: ${method} ${path}`)
      return r
    }

    // Preview: summary, zero writes
    const preview = await callRoute(route('POST', '/import/preview'), activated.ctx, {
      body: { source: 'github:me/acme-brand' },
    })
    expect(preview.status).toBe(200)
    const p = preview.body.preview as { id: string; assets: number; commit?: string }
    expect(p.id).toBe('acme')
    expect(p.assets).toBe(2)
    expect(p.commit).toBe('commit-aaa')
    expect(existsSync(join(testDir, 'brands', 'acme'))).toBe(false) // nothing written

    // Import: provenance carries repo + commit
    const imported = await callRoute(route('POST', '/import'), activated.ctx, {
      body: { source: 'github:me/acme-brand' },
    })
    expect(imported.status).toBe(200)
    const installed = getBrand('acme')
    if (installed.status !== 'ok') throw new Error('expected brand')
    expect(installed.manifest.source).toMatchObject({ repo: 'github:me/acme-brand', commit: 'commit-aaa' })

    // Drift check: upstream moved to commit-bbb
    const check = await callRoute(route('GET', '/import/check'), activated.ctx, {
      searchParams: { id: 'acme' },
    })
    expect(check.status).toBe(200)
    expect(check.body.drift).toBe(true)
    expect(check.body.latestCommit).toBe('commit-bbb')
  })
})

describe('round-trip', () => {
  it('import(export(brand)) is semantically identical', async () => {
    const src = join(testDir, 'src')
    seedPortableDir(src)
    const { ctx } = makeAssetsCtx()
    await importBrand({ sourceDir: src, ctx, source: 'origin' })

    const exportDir = join(testDir, 'exported')
    const exported = await exportBrand('acme', exportDir, ctx)
    expect(exported.files).toContain('brand.json')
    expect(existsSync(join(exportDir, 'guidelines', 'voice.md'))).toBe(true)

    // Re-import the export as a fresh instance (overwrite the original)
    const back = await importBrand({ sourceDir: exportDir, ctx, source: 'round-trip', overwrite: true })
    expect(back.brand.name).toBe('Acme')
    expect(back.brand.rules).toEqual(['Never use emojis'])
    expect(back.brand.palette).toEqual([{ name: 'ink', hex: '#1A1A2E', usage: 'primary' }])
    expect(back.brand.assetGroups[0].name).toBe('app-screenshots')
    expect(readDoc('acme', 'lessons', 'tweet-flops.md')).toContain('No Friday threads.')
    expect(listDocs('acme', 'guidelines').map((d) => d.name)).toEqual(['voice.md'])
    // The logo bytes survived the export leg intact
    const exportedLogo = exported.files.find((f) => f.startsWith('assets/') && f.includes('imported'))
    expect(exportedLogo).toBeTruthy()
    expect(readFileSync(join(exportDir, exportedLogo!), 'utf-8')).toBe('LOGO-BYTES')
  })
})
