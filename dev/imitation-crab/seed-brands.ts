/**
 * Deterministic Brands fixtures for list, creation, and detail UI review.
 *
 * The records deliberately cover published/draft, logo/monogram, imported,
 * complete/incomplete, long-copy, docs, lessons, and linked-asset states.
 * Asset references resolve from the versioned Assets seed so dates can remain
 * relative without hard-coding a stale asset id.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  brandManifestSchema,
  type BrandManifest,
} from '../../plugins/brands/lib/schemas'

const DAY = 86_400_000

type SeedDoc = {
  name: string
  content: string
}

type SeedBrand = {
  manifest: BrandManifest
  guidelines?: SeedDoc[]
  lessons?: SeedDoc[]
}

function seededAssetId(mockHome: string, slug: string): string {
  const root = join(mockHome, 'assets', 'store')
  if (!existsSync(root)) throw new Error(`Brands seed requires the Assets seed: ${root} is missing`)
  for (const shard of readdirSync(root).sort()) {
    const shardDir = join(root, shard)
    for (const assetId of readdirSync(shardDir).sort()) {
      if (assetId.includes(`-${slug}-`)) return assetId
    }
  }
  throw new Error(`Brands seed could not resolve asset slug: ${slug}`)
}

function relativeDate(now: number, daysAgo: number): string {
  return new Date(now - daysAgo * DAY).toISOString()
}

function guideline(description: string, title: string, body: string): string {
  return `---
description: ${description}
---

# ${title}

${body}
`
}

function lesson(title: string, body: string): string {
  return `---
title: ${title}
---

# ${title}

${body}
`
}

export function seedBrands(mockHome: string): void {
  const now = Date.now()
  const assets = {
    bread: seededAssetId(mockHome, 'fresh-bread'),
    calendar: seededAssetId(mockHome, 'food-blog-content-calendar'),
    coffee: seededAssetId(mockHome, 'morning-coffee'),
    cookies: seededAssetId(mockHome, 'chocolate-cookies'),
    popcorn: seededAssetId(mockHome, 'gourmet-popcorn'),
    trail: seededAssetId(mockHome, 'trail-status-concept'),
  }

  const brands: SeedBrand[] = [
    {
      manifest: brandManifestSchema.parse({
        id: 'harvest-and-hearth',
        name: 'Harvest & Hearth',
        description: 'A generous neighborhood food brand built around seasonal ingredients, warm hosting, and recipes people can actually make.',
        palette: [
          { name: 'Hearth', hex: '#A54B2A', usage: 'Primary brand moments and calls to action' },
          { name: 'Harvest', hex: '#D6A84B', usage: 'Warm highlights and editorial accents' },
          { name: 'Sage', hex: '#60745A', usage: 'Supporting information and natural contrast' },
          { name: 'Linen', hex: '#F2E9D8', usage: 'Quiet backgrounds and breathing room' },
        ],
        rules: [
          'Lead with the food, the season, or the person being welcomed.',
          'Prefer practical detail over lifestyle superlatives.',
          'Use warm color fields sparingly so photography remains the hero.',
        ],
        terminology: [
          { term: 'gathering', rule: 'Prefer to event when the moment is informal or hosted at home.' },
          { term: 'recipe', rule: 'Use for tested instructions; never call a loose idea a recipe.' },
        ],
        cardDocs: ['voice.md', 'style-guide.md'],
        logos: [{ assetId: assets.popcorn, variant: 'primary' }],
        assetGroups: [
          {
            name: 'seasonal-food',
            description: 'Approved food photography for editorial and social work.',
            assetIds: [assets.popcorn, assets.bread],
          },
        ],
        defaultImageReferences: [assets.popcorn, assets.bread],
        createdAt: relativeDate(now, 48),
        updatedAt: relativeDate(now, 1),
      }),
      guidelines: [
        {
          name: 'voice.md',
          content: guideline(
            'Voice, audience, sentence rhythm, and approved examples',
            'Voice & Tone',
            'Write like a capable host: warm, specific, and calm. Use short headlines, concrete ingredients, and instructions that respect the reader’s time.\n\n## We would write\n\n- Dinner for the table, without the all-day prep.\n- Rosemary, parmesan, and ten quiet minutes at the stove.\n\n## We would never write\n\n- Elevate your culinary journey.\n- The ultimate foodie experience.',
          ),
        },
        {
          name: 'style-guide.md',
          content: guideline(
            'Color, imagery, typography, and layout direction',
            'Style Guide',
            'Let natural food photography carry each composition. Use Hearth for decisive actions, Sage for supporting structure, and Linen for quiet editorial surfaces.\n\n## Imagery\n\nPrefer warm directional light, real texture, and ingredients in use. Avoid sterile overhead grids and generic restaurant stock photography.',
          ),
        },
      ],
      lessons: [
        {
          name: 'ingredient-first-headlines.md',
          content: lesson(
            'Ingredient-first headlines',
            'Headlines naming a recognizable ingredient outperform abstract seasonal language. Start with the ingredient, then add the occasion.',
          ),
        },
      ],
    },
    {
      manifest: brandManifestSchema.parse({
        id: 'northstar-trails',
        name: 'Northstar Trails',
        description: 'Trail conditions and trip-planning tools for hikers who value trustworthy local context over glossy adventure marketing.',
        palette: [
          { name: 'Pine', hex: '#24483A', usage: 'Primary controls and durable brand fields' },
          { name: 'Sky', hex: '#4F86A6', usage: 'Informational highlights and route context' },
          { name: 'Granite', hex: '#B9B8B0', usage: 'Borders, maps, and neutral structure' },
        ],
        rules: [
          'State trail conditions before inspirational copy.',
          'Never imply that every route is safe for every skill level.',
        ],
        terminology: [
          { term: 'trail conditions', rule: 'Use instead of trail status when describing observed ground conditions.' },
          { term: 'route', rule: 'Use for the mapped path; reserve hike for the activity.' },
        ],
        cardDocs: ['voice.md', 'style-guide.md'],
        logos: [],
        assetGroups: [
          {
            name: 'product-and-trails',
            description: 'Approved interface concepts and grounded outdoor imagery.',
            assetIds: [assets.trail, assets.bread],
          },
        ],
        defaultImageReferences: [assets.trail],
        createdAt: relativeDate(now, 31),
        updatedAt: relativeDate(now, 3),
      }),
      guidelines: [
        {
          name: 'voice.md',
          content: guideline(
            'Operational trail voice and safety language',
            'Voice & Tone',
            'Be clear, local, and useful. Conditions, closures, and preparation come first. Adventure language may support the facts but never replace them.',
          ),
        },
        {
          name: 'style-guide.md',
          content: guideline(
            'Map, condition, photography, and color guidance',
            'Style Guide',
            'Use Pine for dependable navigation, Sky for current information, and Granite for map structure. Pair every condition color with a visible label or icon.',
          ),
        },
      ],
      lessons: [
        {
          name: 'weather-first.md',
          content: lesson(
            'Weather first',
            'When conditions changed within the last day, lead with the observation time and weather impact before suggesting a route.',
          ),
        },
        {
          name: 'closure-language.md',
          content: lesson(
            'Closure language',
            'Use closed only for an authoritative closure. For uncertain reports, say access may be limited and name the source.',
          ),
        },
      ],
    },
    {
      manifest: brandManifestSchema.parse({
        id: 'copper-and-bloom',
        name: 'Copper & Bloom Hospitality Group',
        description: 'A refined but unpretentious hospitality portfolio spanning neighborhood cafés, intimate dining rooms, and seasonal event spaces.',
        palette: [
          { name: 'Copper', hex: '#B7653A', usage: 'Signature brand detail and premium actions' },
          { name: 'Bloom', hex: '#8B5061', usage: 'Editorial accents and event moments' },
          { name: 'Midnight', hex: '#20242A', usage: 'Typography and evening surfaces' },
        ],
        rules: [
          'Name the venue and the experience before describing the portfolio.',
          'Avoid exclusivity language that makes neighborhood guests feel unwelcome.',
        ],
        cardDocs: ['voice.md'],
        logos: [{ assetId: assets.coffee, variant: 'primary' }],
        assetGroups: [
          {
            name: 'hospitality-library',
            description: 'Approved café, food, and planning materials from the imported kit.',
            assetIds: [assets.coffee, assets.cookies, assets.calendar],
          },
        ],
        defaultImageReferences: [assets.coffee],
        source: {
          repo: 'github.com/example/copper-and-bloom-brand',
          ref: 'main',
          commit: 'f41c0de',
          importedAt: relativeDate(now, 18),
        },
        createdAt: relativeDate(now, 18),
        updatedAt: relativeDate(now, 7),
      }),
      guidelines: [
        {
          name: 'voice.md',
          content: guideline(
            'Imported portfolio voice and guest language',
            'Voice & Tone',
            'Write with polished clarity and an easy sense of welcome. Name real rooms, menus, seasons, and service details instead of leaning on luxury clichés.',
          ),
        },
      ],
      lessons: [
        {
          name: 'venue-first.md',
          content: lesson(
            'Venue-first copy',
            'Portfolio-level copy performs better when it quickly names the relevant venue and neighborhood.',
          ),
        },
      ],
    },
    {
      manifest: brandManifestSchema.parse({
        id: 'daybreak-studio',
        name: 'Daybreak Studio',
        description: 'An early draft for a bright, pragmatic creative studio serving small product teams.',
        draft: true,
        palette: [
          { name: 'Sunrise', hex: '#F2A93B', usage: 'Candidate accent pending review' },
        ],
        rules: [],
        terminology: [],
        logos: [],
        assetGroups: [],
        createdAt: relativeDate(now, 2),
        updatedAt: relativeDate(now, 0.25),
      }),
      guidelines: [
        {
          name: '_intake.md',
          content: guideline(
            'Raw builder intake awaiting agent drafting',
            'Brand Intake',
            'Audience: small product teams. Tone: bright, useful, and direct. Avoid agency jargon and inflated transformation claims.',
          ),
        },
      ],
    },
  ]

  const root = join(mockHome, 'brands')
  for (const brand of brands) {
    const dir = join(root, brand.manifest.id)
    mkdirSync(join(dir, 'guidelines'), { recursive: true })
    mkdirSync(join(dir, 'lessons'), { recursive: true })
    writeFileSync(join(dir, 'brand.json'), `${JSON.stringify(brand.manifest, null, 2)}\n`, 'utf-8')
    for (const doc of brand.guidelines ?? []) {
      writeFileSync(join(dir, 'guidelines', doc.name), doc.content, 'utf-8')
    }
    for (const doc of brand.lessons ?? []) {
      writeFileSync(join(dir, 'lessons', doc.name), doc.content, 'utf-8')
    }
  }

  console.log(`[seed] Brands seeded (${brands.length} records)`)
}
