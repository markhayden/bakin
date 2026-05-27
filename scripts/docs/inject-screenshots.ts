#!/usr/bin/env bun
/**
 * Inject (or update) <img> tags in source markdown files where matching
 * screenshot PNGs exist for <figure class="screenshot-frame"> placeholders.
 *
 * Reads the manifest to map (doc, caption) → filename, then scans the
 * source markdown files and inserts/updates images. Works with both dev
 * server and production builds since it modifies the source.
 *
 * Idempotent: running twice produces the same result. Existing img tags
 * are replaced if the filename changed, or left alone if already correct.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { load as loadYaml } from 'js-yaml'

const PROJECT_ROOT = resolve(import.meta.dirname, '../..')
const MANIFEST_PATH = join(PROJECT_ROOT, 'scripts/docs/screenshot-manifest.yaml')
const DOCS_CONTENT = join(PROJECT_ROOT, 'docs/src/content/docs')
const SCREENSHOTS_DIR = join(PROJECT_ROOT, 'docs/public/media/screenshots')

interface ManifestEntry {
  id: string
  doc: string
  caption: string
  skip?: boolean
}

interface Manifest {
  settings: { outputDir: string }
  screenshots: ManifestEntry[]
}

interface CaptionMapping {
  filename: string
  caption: string
}

function buildCaptionIndex(): Map<string, CaptionMapping[]> {
  if (!existsSync(MANIFEST_PATH)) return new Map()
  const raw = readFileSync(MANIFEST_PATH, 'utf-8')
  const manifest = loadYaml(raw) as Manifest
  const index = new Map<string, CaptionMapping[]>()

  for (const entry of manifest.screenshots) {
    if (entry.skip) continue
    const docSlug = entry.doc.replace(/\//g, '-')
    const filename = `${docSlug}--${entry.id}.png`
    const existing = index.get(entry.doc) || []
    existing.push({ filename, caption: entry.caption })
    index.set(entry.doc, existing)
  }

  return index
}

function injectIntoMarkdown(content: string, mappings: CaptionMapping[]): { content: string; count: number } {
  let count = 0

  const captionToFile = new Map<string, string>()
  for (const m of mappings) {
    captionToFile.set(m.caption, m.filename)
  }

  // Match figure blocks: with or without an existing <img> tag
  const result = content.replace(
    /<figure class="screenshot-frame">\s*(?:<img[^>]*>\s*)?<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>/g,
    (match, captionContent: string) => {
      const captionText = captionContent.replace(/<[^>]*>/g, '').trim()
      const filename = captionToFile.get(captionText)
      if (!filename) return match

      const filePath = join(SCREENSHOTS_DIR, filename)
      if (!existsSync(filePath)) return match

      const safeAlt = captionText.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      const imgTag = `<img src="/docs/media/screenshots/${filename}" alt="${safeAlt}" loading="lazy">`
      const updated = `<figure class="screenshot-frame">\n  ${imgTag}\n</figure>`

      if (match.trim() !== updated.trim()) count++
      return updated
    },
  )

  return { content: result, count }
}

function main(): void {
  const docIndex = buildCaptionIndex()
  if (docIndex.size === 0) {
    console.log('No screenshot entries in manifest (or manifest not found).')
    return
  }

  let totalInjected = 0

  for (const [docPath, mappings] of docIndex) {
    const mdPath = join(DOCS_CONTENT, `${docPath}.md`)
    const mdxPath = join(DOCS_CONTENT, `${docPath}.mdx`)
    const filePath = existsSync(mdPath) ? mdPath : existsSync(mdxPath) ? mdxPath : null

    if (!filePath) {
      console.warn(`  skip  ${docPath} (file not found)`)
      continue
    }

    const original = readFileSync(filePath, 'utf-8')
    const { content, count } = injectIntoMarkdown(original, mappings)

    if (count > 0) {
      writeFileSync(filePath, content)
      console.log(`  ${docPath}: ${count} screenshot(s) injected`)
      totalInjected += count
    } else {
      console.log(`  ${docPath}: up to date`)
    }
  }

  console.log(`\nDone: ${totalInjected} screenshot(s) updated`)
}

main()
