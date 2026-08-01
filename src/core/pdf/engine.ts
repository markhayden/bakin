/**
 * The ONE PDF engine — text extraction, metadata, and page rendering behind
 * a single module. Consumers: the assets content extractor (search indexing)
 * and the bakin_exec_pdf_* exec tools. Never grow a parallel PDF path.
 *
 * Built on pdf-parse v2 (pdfjs-dist — the engine Firefox uses), lazy-imported
 * so the ~2 MB dependency never loads at server startup. Provider-side PDF
 * extraction has failed silently on real-world PDFs with complex font
 * subsetting, CID fonts, and text matrices — the three features every
 * design-tool PDF uses; pdfjs handles all of them. See Bakin issue #72.
 *
 * Compiled-binary story (#746, spike-proven): `bun build --compile` cannot
 * deliver @napi-rs/canvas (its platform loader breaks under $bunfs), but
 * TEXT extraction needs no canvas at all — in a compiled binary this module
 * installs minimal DOMMatrix/ImageData/Path2D stubs before the pdf-parse
 * import and points pdfjs at the EMBEDDED data-URL worker
 * (`pdf-parse/worker` getData()), so readPdf works everywhere. RENDERING
 * genuinely requires the native canvas: renderPdfPages throws a typed
 * `pdf_unavailable` in compiled binaries — honest, never a cryptic crash.
 * Repo-tree runs (the production box) use the real canvas polyfills.
 */
import { existsSync, mkdtempSync, openSync, readSync, closeSync, readFileSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createLogger } from '../logger'
import {
  MAX_CHARS,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  RENDER_MAX_PAGES,
  RENDER_WIDTH,
  SCANNED_TEXT_THRESHOLD,
} from './limits'

const log = createLogger('pdf-engine')

export type PdfErrorKind = 'not_found' | 'not_a_pdf' | 'parse_failed' | 'over_limit' | 'pdf_unavailable'

export class PdfError extends Error {
  constructor(
    readonly kind: PdfErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'PdfError'
  }
}

export interface PdfInfo {
  pageCount: number
  title?: string
  author?: string
}

export interface PdfPageText {
  page: number
  text: string
  likelyScanned: boolean
}

export interface PdfTextResult {
  info: PdfInfo
  pages: PdfPageText[]
  /** true when the page cap or the char cap cut content — always visible, never silent */
  truncated: boolean
}

export interface PdfRenderedFile {
  page: number
  path: string
  width: number
  height: number
}

export interface PdfRenderResult {
  files: PdfRenderedFile[]
  outDir: string
  /** Total pages in the document — lets callers say "rendered N of M". */
  totalPages: number
  /** true when a default (unselected) render clamped to RENDER_MAX_PAGES —
   * always visible, never silent. */
  truncated: boolean
}

/** Which pages to hand pdf-parse: explicit selection passes through (capped
 * — parse work is bounded even when the char cap wouldn't bite); an
 * unselected read of an oversized doc is capped at the first MAX_PDF_PAGES. */
export function selectPages(
  totalPages: number,
  requested: number[] | undefined,
): { partial: number[] | undefined; pagesTruncated: boolean } {
  if (requested?.length) {
    if (requested.length > MAX_PDF_PAGES) {
      throw new PdfError(
        'over_limit',
        `read is capped at ${MAX_PDF_PAGES} pages per call (got ${requested.length}) — call again with the next batch`,
      )
    }
    return { partial: requested, pagesTruncated: false }
  }
  if (totalPages > MAX_PDF_PAGES) {
    return { partial: Array.from({ length: MAX_PDF_PAGES }, (_, i) => i + 1), pagesTruncated: true }
  }
  return { partial: undefined, pagesTruncated: false }
}

/** Enforce the total char budget across pages, truncating at the boundary
 * with a visible marker; pages past the budget are dropped entirely. */
export function capPageTexts(pages: Array<{ page: number; text: string }>): {
  pages: Array<{ page: number; text: string }>
  charsTruncated: boolean
} {
  let used = 0
  const kept: Array<{ page: number; text: string }> = []
  for (const p of pages) {
    if (used >= MAX_CHARS) {
      // Budget exhausted with pages left over — the cut must be visible.
      const last = kept[kept.length - 1]
      if (last) last.text += `\n[truncated at ${MAX_CHARS} chars]`
      return { pages: kept, charsTruncated: true }
    }
    if (used + p.text.length <= MAX_CHARS) {
      kept.push({ page: p.page, text: p.text }) // copy — the marker append must never mutate caller data
      used += p.text.length
      continue
    }
    const room = MAX_CHARS - used
    kept.push({ page: p.page, text: `${p.text.slice(0, room)}\n[truncated at ${MAX_CHARS} chars]` })
    return { pages: kept, charsTruncated: true }
  }
  return { pages: kept, charsTruncated: false }
}

function assertReadablePdf(path: string): void {
  if (!existsSync(path)) throw new PdfError('not_found', `no file at ${path}`)
  const size = statSync(path).size
  if (size > MAX_PDF_BYTES) {
    throw new PdfError('over_limit', `${path} is ${size} bytes — the engine caps at ${MAX_PDF_BYTES}`)
  }
  // Trust bytes, not the extension: %PDF magic within the first 1024 bytes
  // (the spec allows a small preamble before the header).
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(1024)
    const read = readSync(fd, head, 0, 1024, 0)
    if (!head.subarray(0, read).includes('%PDF')) {
      throw new PdfError('not_a_pdf', `${path} has no %PDF header — not a PDF file`)
    }
  } finally {
    closeSync(fd)
  }
}

type PdfParseModule = typeof import('pdf-parse')

/** True inside a `bun build --compile` single-file binary. */
export function isCompiledBinary(): boolean {
  // Bun.main isn't in the app tsconfig's Bun typings — structural access.
  const main = typeof Bun !== 'undefined' ? (Bun as unknown as { main?: string }).main : undefined
  return typeof main === 'string' && main.startsWith('/$bunfs/')
}

/**
 * Minimal canvas-less globals for pdfjs module-init + text extraction —
 * ONLY installed in compiled binaries, where @napi-rs/canvas can't load
 * (repo-tree runs get the real polyfills). Text extraction never draws;
 * these exist to satisfy module-scope construction. Exported for tests.
 */
export function installCanvaslessStubs(g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  class StubDOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    scale() { return this }
    translate() { return this }
    multiply() { return this }
    transformPoint(p: { x: number; y: number }) { return p }
  }
  g.DOMMatrix ??= StubDOMMatrix
  g.ImageData ??= class { constructor(readonly width: number, readonly height: number) {} }
  g.Path2D ??= class { addPath() {} moveTo() {} lineTo() {} closePath() {} }
}

let modulePromise: Promise<PdfParseModule> | undefined

async function loadPdfParse(): Promise<PdfParseModule> {
  modulePromise ??= (async () => {
    const compiled = isCompiledBinary()
    if (compiled) installCanvaslessStubs()
    const mod = await import('pdf-parse')
    if (compiled) {
      // pdfjs's default fake-worker load is a computed dynamic import that
      // cannot survive bundling — point it at the EMBEDDED data-URL worker.
      const { getData } = await import('pdf-parse/worker')
      ;(mod.PDFParse as unknown as { setWorker: (src: string) => void }).setWorker(getData())
    }
    return mod
  })().catch((err: unknown) => {
    modulePromise = undefined
    log.error('pdf-parse failed to load — PDF features unavailable', err as Error)
    throw new PdfError('pdf_unavailable', `PDF support failed to load: ${(err as Error).message}`)
  })
  return modulePromise
}

async function withParser<T>(
  path: string,
  fn: (parser: InstanceType<PdfParseModule['PDFParse']>) => Promise<T>,
): Promise<T> {
  assertReadablePdf(path)
  const { PDFParse } = await loadPdfParse()
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(path)) })
  try {
    return await fn(parser)
  } catch (err) {
    if (err instanceof PdfError) throw err
    throw new PdfError('parse_failed', `failed to parse ${path}: ${(err as Error).message}`)
  } finally {
    await parser.destroy().catch(() => log.warn('pdf parser destroy failed', { path }))
  }
}

/** Metadata + per-page text in one pass. `pages` selects 1-indexed pages. */
export async function readPdf(path: string, pages?: number[]): Promise<PdfTextResult> {
  return withParser(path, async (parser) => {
    const infoResult = await parser.getInfo()
    const info: PdfInfo = {
      pageCount: infoResult.total,
      ...(typeof infoResult.info?.Title === 'string' && infoResult.info.Title ? { title: infoResult.info.Title } : {}),
      ...(typeof infoResult.info?.Author === 'string' && infoResult.info.Author ? { author: infoResult.info.Author } : {}),
    }
    const { partial, pagesTruncated } = selectPages(infoResult.total, pages)
    const text = await parser.getText(partial ? { partial } : undefined)
    const capped = capPageTexts(text.pages.map((p) => ({ page: p.num, text: p.text })))
    return {
      info,
      pages: capped.pages.map((p) => ({
        ...p,
        likelyScanned: p.text.trim().length < SCANNED_TEXT_THRESHOLD,
      })),
      truncated: pagesTruncated || capped.charsTruncated,
    }
  })
}

/** Render pages to PNGs in a fresh tmpdir. Output is ephemeral by design —
 * the OS owns cleanup (mirrors the image-downscale pipeline; no GC system). */
export async function renderPdfPages(path: string, pages?: number[]): Promise<PdfRenderResult> {
  if (isCompiledBinary()) {
    // Rendering draws through @napi-rs/canvas, whose native addon cannot be
    // delivered inside a single-file binary (#746 spike). Text extraction
    // (readPdf) works everywhere — say exactly that.
    throw new PdfError(
      'pdf_unavailable',
      'PDF page rendering is unavailable inside a compiled binary (native canvas cannot be embedded). ' +
        'Text extraction still works; for rendering, run from a source checkout.',
    )
  }
  if (pages && pages.length > RENDER_MAX_PAGES) {
    throw new PdfError(
      'over_limit',
      `render is capped at ${RENDER_MAX_PAGES} pages per call (got ${pages.length}) — call again with the next batch`,
    )
  }
  return withParser(path, async (parser) => {
    const total = (await parser.getInfo()).total
    let partial = pages
    let truncated = false
    if (!partial) {
      truncated = total > RENDER_MAX_PAGES
      partial = Array.from({ length: Math.min(total, RENDER_MAX_PAGES) }, (_, i) => i + 1)
    }
    const shot = await parser.getScreenshot({
      partial,
      desiredWidth: RENDER_WIDTH,
      imageDataUrl: false,
    })
    const outDir = mkdtempSync(join(tmpdir(), 'bakin-pdf-render-'))
    const files: PdfRenderedFile[] = shot.pages.map((p) => {
      const filePath = join(outDir, `page-${p.pageNumber}.png`)
      writeFileSync(filePath, Buffer.from(p.data))
      // pdfjs scale math yields floats (1567.9999…) — report integer pixels.
      return { page: p.pageNumber, path: filePath, width: Math.round(p.width), height: Math.round(p.height) }
    })
    return { files, outDir, totalPages: total, truncated }
  })
}
