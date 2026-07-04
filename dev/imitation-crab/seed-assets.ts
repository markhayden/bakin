/**
 * Seed versioned assets (#457 store layout) from the raw files in
 * fixtures/asset-files/.
 *
 * Each seeded asset gets `assets/store/<YYYY-MM>/<assetId>/manifest.json`
 * plus its `vN` version files — the post-rebuild layout (no `.meta.json`
 * sidecars). Dates are RELATIVE TO NOW so the gallery reads fresh, and the
 * assetId date prefix always matches its shard. Every manifest is validated
 * against the real AssetManifestSchema before writing, so schema drift fails
 * the seed loudly instead of silently breaking the UI.
 *
 * Demo coverage: enrichment states done / pending / failed / user-edited,
 * OCR text, a multi-version asset with a non-latest currentVersion pointer,
 * an export rendition, and raw inbox drops for the explicit-import (D7) tab.
 */
import { cpSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { AssetManifestSchema, type AssetManifest, type AssetEnrichment } from '../../plugins/assets/lib/manifest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILES_DIR = join(__dirname, 'fixtures', 'asset-files')

const DAY = 86_400_000

interface AssetSpec {
  /** Source file in fixtures/asset-files/ (old dated name; re-dated on seed). */
  file: string
  slug: string
  hex: string
  type: 'images' | 'text'
  agent: string
  daysAgo: number
  description: string
  tags: string[]
  enrichment?: AssetEnrichment
  /** Extra versions: each copies the same source file with a new description. */
  extraVersions?: Array<{ description: string }>
  /** currentVersion override (demo: pointer parked on a non-latest version). */
  currentVersion?: number
  /** Add one export rendition derived from currentVersion. */
  withExport?: boolean
}

const enrichedDone = (caption: string, tags: string[], extra: Partial<AssetEnrichment> = {}): AssetEnrichment => ({
  status: 'done',
  model: 'anthropic/claude-haiku-4-5',
  forVersion: 1,
  caption,
  suggestedTags: tags,
  ...extra,
})

const ASSETS: AssetSpec[] = [
  {
    file: '20260401-gourmet-popcorn-f1a2b3c4.jpg', slug: 'gourmet-popcorn', hex: 'f1a2b3c4',
    type: 'images', agent: 'pixel', daysAgo: 1.2,
    description: 'Gourmet seasoned popcorn with rosemary and parmesan',
    tags: ['food', 'popcorn', 'snack'],
    enrichment: enrichedDone('A rustic bowl of herb-flecked popcorn dusted with grated parmesan.', ['rosemary', 'parmesan', 'appetizer']),
    extraVersions: [
      { description: 'Warmer color grade per feedback' },
      { description: 'Cropped square for the carousel' },
    ],
    currentVersion: 2,
    withExport: true,
  },
  {
    file: '20260402-fresh-bread-d2e3f4a5.jpg', slug: 'fresh-bread', hex: 'd2e3f4a5',
    type: 'images', agent: 'pixel', daysAgo: 2.5,
    description: 'Artisan sourdough loaf on a cutting board',
    tags: ['food', 'bread', 'baking'],
    enrichment: enrichedDone('A crusty sourdough boule scored with a wheat-stalk pattern.', ['sourdough', 'bakery'], {
      ocrText: 'HARVEST LOAF — baked daily 7am',
    }),
  },
  {
    file: '20260403-chocolate-cookies-b3c4d5e6.jpg', slug: 'chocolate-cookies', hex: 'b3c4d5e6',
    type: 'images', agent: 'pixel', daysAgo: 4,
    description: 'Stacked chocolate chip cookies with melted chips',
    tags: ['food', 'cookies', 'dessert'],
    enrichment: { status: 'pending' },
  },
  {
    file: '20260404-morning-coffee-a4b5c6d7.jpg', slug: 'morning-coffee', hex: 'a4b5c6d7',
    type: 'images', agent: 'jessica', daysAgo: 5.5,
    description: 'Latte art in a ceramic mug, morning light',
    tags: ['coffee', 'morning'],
    enrichment: {
      status: 'failed',
      error: 'vision provider timeout after 2 attempts (billed call held — no re-bill)',
    },
  },
  {
    file: '20260404-sunrise-smoothie-c5d6e7f8.jpg', slug: 'sunrise-smoothie', hex: 'c5d6e7f8',
    type: 'images', agent: 'pixel', daysAgo: 6,
    description: 'Layered mango-berry smoothie in a tall glass',
    tags: ['smoothie', 'breakfast'],
    enrichment: enrichedDone('A layered sunrise smoothie: mango base, strawberry swirl, mint garnish.', ['mango', 'healthy'], {
      caption: 'Our signature sunrise smoothie — mango, strawberry, and a hint of lime.',
      userEdited: true,
    }),
  },
  {
    file: '20260405-easter-dessert-e6f7a8b9.jpg', slug: 'easter-dessert', hex: 'e6f7a8b9',
    type: 'images', agent: 'pixel', daysAgo: 9,
    description: 'Pastel-decorated spring cupcakes',
    tags: ['dessert', 'seasonal'],
    enrichment: enrichedDone('Half a dozen cupcakes with pastel buttercream and candy eggs.', ['cupcakes', 'spring']),
  },
  {
    file: '20260406-loaded-hot-dog-a7b8c9d0.jpg', slug: 'loaded-hot-dog', hex: 'a7b8c9d0',
    type: 'images', agent: 'pixel', daysAgo: 12,
    description: 'Loaded hot dog with crispy onions and aioli',
    tags: ['food', 'menu'],
    enrichment: enrichedDone('A brioche-bun hot dog piled with crispy onions and drizzled aioli.', ['street-food']),
  },
  {
    file: '20260407-million-dollar-bacon-f8a9b0c1.jpg', slug: 'million-dollar-bacon', hex: 'f8a9b0c1',
    type: 'images', agent: 'pixel', daysAgo: 15,
    description: 'Candied bacon strips on parchment',
    tags: ['food', 'bacon'],
    enrichment: enrichedDone('Thick-cut candied bacon with a brown-sugar chili glaze.', ['brunch']),
  },
  {
    file: '20260406-trail-status-concept-a1b2c3d4.svg', slug: 'trail-status-concept', hex: 'a1b2c3d4',
    type: 'images', agent: 'jessica', daysAgo: 3,
    description: 'Trail status widget concept sketch',
    tags: ['design', 'concept'],
    enrichment: { status: 'skipped', error: 'unsupported asset kind for enrichment: svg' },
  },
  // Text/docs — enrichment carries summaries.
  {
    file: '20260401-gourmet-popcorn-recipe-d1e2f3a4.md', slug: 'gourmet-popcorn-recipe', hex: 'd1e2f3a4',
    type: 'text', agent: 'jessica', daysAgo: 1.5,
    description: 'Recipe card: rosemary-parmesan popcorn',
    tags: ['recipe'],
    enrichment: { status: 'done', model: 'anthropic/claude-haiku-4-5', forVersion: 1, summary: 'A 15-minute stovetop popcorn recipe with rosemary butter and parmesan; includes make-ahead and storage notes.' },
  },
  {
    file: '20260402-artisan-bread-recipe-b2c3d4e5.md', slug: 'artisan-bread-recipe', hex: 'b2c3d4e5',
    type: 'text', agent: 'jessica', daysAgo: 2.8,
    description: 'Overnight no-knead sourdough method',
    tags: ['recipe', 'baking'],
    enrichment: { status: 'done', model: 'anthropic/claude-haiku-4-5', forVersion: 1, summary: 'An overnight no-knead sourdough with a dutch-oven bake; hydration table and troubleshooting section included.' },
  },
  {
    file: '20260403-chocolate-cookie-recipe-a3b4c5d6.md', slug: 'chocolate-cookie-recipe', hex: 'a3b4c5d6',
    type: 'text', agent: 'jessica', daysAgo: 4.2,
    description: 'Brown-butter chocolate chip cookie recipe',
    tags: ['recipe', 'dessert'],
  },
  {
    file: '20260404-coffee-brewing-guide-c4d5e6f7.md', slug: 'coffee-brewing-guide', hex: 'c4d5e6f7',
    type: 'text', agent: 'rolo', daysAgo: 7,
    description: 'Pour-over brewing guide for the blog',
    tags: ['coffee', 'guide'],
    enrichment: { status: 'done', model: 'anthropic/claude-haiku-4-5', forVersion: 1, summary: 'Step-by-step pour-over guide covering grind size, water temperature, and a 3-pour timing chart.' },
  },
  {
    file: '20260404-sunrise-smoothie-recipe-e5f6a7b8.md', slug: 'sunrise-smoothie-recipe', hex: 'e5f6a7b8',
    type: 'text', agent: 'jessica', daysAgo: 6.2,
    description: 'Sunrise smoothie recipe with layering technique',
    tags: ['recipe', 'breakfast'],
  },
  {
    file: '20260405-easter-dessert-roundup-f6a7b8c9.md', slug: 'easter-dessert-roundup', hex: 'f6a7b8c9',
    type: 'text', agent: 'rolo', daysAgo: 9.3,
    description: 'Spring dessert roundup blog draft',
    tags: ['blog', 'seasonal'],
  },
  {
    file: '20260406-hot-dog-stand-menu-d7e8f9a0.md', slug: 'hot-dog-stand-menu', hex: 'd7e8f9a0',
    type: 'text', agent: 'rolo', daysAgo: 12.4,
    description: 'Pop-up stand menu copy',
    tags: ['menu', 'copy'],
  },
  {
    file: '20260407-million-dollar-bacon-recipe-b8c9d0e1.md', slug: 'million-dollar-bacon-recipe', hex: 'b8c9d0e1',
    type: 'text', agent: 'jessica', daysAgo: 15.2,
    description: 'Candied bacon recipe with glaze variations',
    tags: ['recipe', 'brunch'],
  },
  {
    file: '20260407-food-blog-content-calendar-c0d1e2f3.md', slug: 'food-blog-content-calendar', hex: 'c0d1e2f3',
    type: 'text', agent: 'main', daysAgo: 18,
    description: 'Q3 content calendar for the food blog',
    tags: ['planning'],
  },
  {
    file: '20260407-weekly-meal-plan-a9b0c1d2.md', slug: 'weekly-meal-plan', hex: 'a9b0c1d2',
    type: 'text', agent: 'main', daysAgo: 20,
    description: 'Weekly meal plan email draft',
    tags: ['email', 'planning'],
  },
]

// Files dropped raw into assets/inbox/ — must NOT auto-become assets (D7);
// they demo the Import tab / `bakin assets import` adoption flow.
const INBOX_DROPS = [
  { src: '20260403-chocolate-cookies-b3c4d5e6.jpg', as: 'IMG_4821.jpg' },
  { src: '20260407-weekly-meal-plan-a9b0c1d2.md', as: 'notes-from-phone.md' },
]

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown',
}

export function seedVersionedAssets(mockHome: string): void {
  const now = Date.now()
  let count = 0

  for (const spec of ASSETS) {
    const created = new Date(now - spec.daysAgo * DAY)
    const datePrefix = created.toISOString().slice(0, 10).replace(/-/g, '')
    const shard = created.toISOString().slice(0, 7)
    const assetId = `${datePrefix}-${spec.slug}-${spec.hex}`
    const dir = join(mockHome, 'assets', 'store', shard, assetId)
    mkdirSync(dir, { recursive: true })

    const ext = extname(spec.file)
    const src = join(FILES_DIR, spec.file)
    const size = statSync(src).size
    const versionCount = 1 + (spec.extraVersions?.length ?? 0)

    const versions = []
    for (let v = 1; v <= versionCount; v++) {
      const file = `v${v}${ext}`
      cpSync(src, join(dir, file))
      // Real uploads get a sharp-generated vN.thumb.jpg; for the mock the
      // source image doubles as its own thumb (fixtures are already small).
      // SVGs keep thumb: null like production.
      let thumb: string | null = null
      if (ext === '.jpg') {
        thumb = `v${v}.thumb.jpg`
        cpSync(src, join(dir, thumb))
      }
      versions.push({
        version: v,
        file,
        thumb,
        mimeType: MIME[ext] ?? 'application/octet-stream',
        size,
        width: null,
        height: null,
        created: new Date(created.getTime() + (v - 1) * 3 * 3_600_000).toISOString(),
        description: v === 1 ? spec.description : spec.extraVersions![v - 2].description,
        op: (v === 1 ? (spec.type === 'images' ? 'generate' : 'upload') : 'edit') as 'generate' | 'upload' | 'edit',
        parentVersion: v === 1 ? null : v - 1,
        tool: v === 1 && spec.type === 'images' ? 'bakin_exec_images_generate' : null,
        prompt: v === 1 && spec.type === 'images' ? spec.description : null,
        promptHash: null,
        generation: null,
      })
    }

    const currentVersion = spec.currentVersion ?? versionCount
    const exports = []
    if (spec.withExport) {
      const exportFile = 'exports/instagram-square.jpg'
      mkdirSync(join(dir, 'exports'), { recursive: true })
      cpSync(src, join(dir, exportFile))
      exports.push({
        name: 'instagram-square',
        surface: 'instagram',
        format: 'jpg',
        file: exportFile,
        width: 1080,
        height: 1080,
        fromVersion: currentVersion,
        created: new Date(created.getTime() + 6 * 3_600_000).toISOString(),
      })
    }

    const enrichment = spec.enrichment
      ? { ...spec.enrichment, ...(spec.enrichment.status === 'done' && !spec.enrichment.at
          ? { at: new Date(created.getTime() + 60_000).toISOString(), forVersion: spec.enrichment.forVersion ?? 1 }
          : {}) }
      : undefined

    const manifest: AssetManifest = AssetManifestSchema.parse({
      assetId,
      type: spec.type,
      source: { kind: spec.type === 'images' ? 'generated' : 'upload', path: null },
      agent: spec.agent,
      taskId: null,
      created: created.toISOString(),
      updated: new Date(created.getTime() + (versionCount - 1) * 3 * 3_600_000).toISOString(),
      currentVersion,
      description: spec.description,
      tags: spec.tags,
      versions,
      exports,
      ...(enrichment ? { enrichment } : {}),
    })

    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
    count++
  }

  // Raw inbox drops for the explicit-import demo.
  const inbox = join(mockHome, 'assets', 'inbox')
  mkdirSync(inbox, { recursive: true })
  for (const drop of INBOX_DROPS) {
    cpSync(join(FILES_DIR, drop.src), join(inbox, drop.as))
  }

  console.log(`[seed] Versioned assets seeded (${count} assets, ${INBOX_DROPS.length} inbox drops)`)
}
