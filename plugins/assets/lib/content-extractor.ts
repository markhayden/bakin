/**
 * Server-side text extraction for indexable asset file types. Populates
 * the `content` field on the search doc so Antfly's embedding template
 * can reference extracted text directly via `{{content}}` instead of
 * round-tripping through `{{remotePDF}}` / `{{remoteText}}` helpers.
 *
 * Motivation: Antfly's Go PDF library (ajroetker/pdf, a fork of
 * rsc.io/pdf) silently fails on real-world PDFs with complex font
 * subsetting, CID fonts, and text matrices — the three features every
 * design-tool PDF uses. pdf-parse (built on pdfjs-dist, the same engine
 * Firefox uses) handles all of them. See Bakin issue #72 for the full
 * upstream trace.
 *
 * Plain text formats (.md, .txt, .json, .csv, etc.) are read directly
 * with fs.readFileSync — no dependency needed, no round-trip to Antfly,
 * no private-IP block to work around.
 *
 * Images are not handled here. They go through the `assets_visual` CLIP
 * index via `{{remoteMedia url=image_url}}`, which works.
 */
import { readFileSync } from 'fs'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('assets:content-extractor')

/**
 * Hard cap on extracted content length. A 50K-char doc produces roughly
 * 100 embedding chunks at 200 tokens each — plenty of semantic coverage
 * for notes, recipes, contracts, and most documentation. Files bigger
 * than this get truncated at a safe character boundary.
 */
const MAX_CHARS = 50_000

/** PDF pages parsed per document. Enough for long-form notes and
 * reasonably long papers; avoids pathological parses on huge PDFs. */
const MAX_PDF_PAGES = 100

const PLAIN_TEXT_EXTS = new Set([
  '.md', '.txt', '.rtf',
  '.json', '.csv', '.tsv', '.xml',
  '.yaml', '.yml',
])

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
      return truncate(await extractPdfText(absPath))
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

/**
 * Extract text from a PDF via pdf-parse. Lazy-imported so the 2MB
 * pdfjs-dist dependency only loads when actually needed — Bakin's
 * startup cost stays zero for workspaces that never index a PDF.
 */
async function extractPdfText(absPath: string): Promise<string> {
  const mod = await import('pdf-parse')
  const pdfParse = (mod.default ?? mod) as (
    buffer: Buffer,
    options?: { max?: number },
  ) => Promise<{ text: string }>
  const buf = readFileSync(absPath)
  const parsed = await pdfParse(buf, { max: MAX_PDF_PAGES })
  return parsed.text
}
