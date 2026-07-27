/**
 * Server-side text extraction for indexable asset file types. Populates
 * the `content` field on the search doc so embedding templates can reference
 * extracted text directly via `{{content}}` instead of asking the search
 * provider to read local files during indexing.
 *
 * PDF extraction delegates to the core PDF engine (`src/core/pdf/engine.ts`)
 * — the ONE engine shared with the bakin_exec_pdf_* tools; the provider-side
 * extraction rationale (CID fonts, issue #72) lives on that module.
 *
 * Plain text formats (.md, .txt, .json, .csv, etc.) are read directly
 * with fs.readFileSync — no dependency needed and no provider file fetch.
 *
 * Images are not handled here. They go through the `assets_visual` CLIP
 * index via the search adapter's media URL field support.
 */
import { readFileSync } from 'fs'
import { createLogger } from '../../../src/core/logger'
import { readPdf } from '../../../src/core/pdf/engine'
import { MAX_CHARS } from '../../../src/core/pdf/limits'

const log = createLogger('assets:content-extractor')

const PLAIN_TEXT_EXTS = new Set([
  '.md', '.txt', '.rtf',
  '.json', '.csv', '.tsv', '.xml',
  '.yaml', '.yml',
])

export function canExtractAssetContent(filename: string): boolean {
  const ext = (filename.toLowerCase().match(/\.[^.]+$/) ?? [''])[0]
  return PLAIN_TEXT_EXTS.has(ext) || ext === '.pdf'
}

/**
 * Extract searchable text content from an asset file. Returns an empty
 * string for unsupported types and for any extraction that fails —
 * callers treat empty as "just index the metadata." Never throws.
 */
export async function extractAssetContent(absPath: string, filename: string): Promise<string> {
  const ext = (filename.toLowerCase().match(/\.[^.]+$/) ?? [''])[0]

  try {
    if (PLAIN_TEXT_EXTS.has(ext)) {
      return truncate(readFileSync(absPath, 'utf-8'))
    }
    if (ext === '.pdf') {
      // Engine enforces the page + char caps (with visible markers).
      const result = await readPdf(absPath)
      return result.pages.map((p) => p.text).join('\n')
    }
    return ''
  } catch (err) {
    log.warn('Content extraction failed — indexing metadata only', {
      path: absPath,
      error: err instanceof Error ? err.message : String(err),
    })
    return ''
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text
  // Cut at a character boundary that isn't mid-word when possible.
  const cut = text.slice(0, MAX_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return lastSpace > MAX_CHARS - 500 ? cut.slice(0, lastSpace) : cut
}
