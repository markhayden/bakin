/**
 * Scanned-PDF enrichment (#747): a PDF with no text layer renders its first
 * pages through the ONE core PDF engine and runs each page through the
 * EXISTING single-image vision pipeline — page-labeled ocrText merge, a
 * visible marker for pages past the budget, caption/tags/summary from the
 * page-1 call. Every page is prepared before the first send (#855). Any
 * page failure fails the WHOLE job (the queue's bounded
 * retry/error path owns recovery) — partial results are never applied.
 *
 * Deliberately NOT the ocr capability pack: enrichment must work without
 * optional packs, and the vision call yields caption+tags in the same
 * request (#742 D9 stands — the server never spawns pack binaries).
 */
import { rmSync } from 'fs'
import type { VisionEnrichmentResult } from '@bakin/core/media'
import { cleanupPreparedAttachment, prepareImageAttachment, type PreparedAttachment } from '@bakin/core/media/downscale'
import { readPdf, renderPdfPages } from '../../../../src/core/pdf/engine'
import type { EnrichmentEngine } from './engine'

/** Vision-OCR page budget per scanned PDF (interview decision #2 — 3 pages,
 * sequential single-image calls; the char/render caps live in the engine). */
export const SCANNED_OCR_MAX_PAGES = 3

export function isPdfPath(absPath: string): boolean {
  return absPath.toLowerCase().endsWith('.pdf')
}

/**
 * A scanned PDF's first pages, rendered AND made sendable before any billed
 * call (#855): a page that cannot be prepared fails the job before page 1
 * is ever sent, and retries reuse these files. The caller owns `release()`.
 */
export interface PreparedScannedPdf {
  pages: Array<{ page: number; prepared: PreparedAttachment }>
  totalPages: number
  release(): void
}

export async function prepareScannedPdf(absPath: string): Promise<PreparedScannedPdf> {
  const totalPages = (await readPdf(absPath, [1])).info.pageCount
  const pageNums = Array.from({ length: Math.min(totalPages, SCANNED_OCR_MAX_PAGES) }, (_, i) => i + 1)
  const rendered = await renderPdfPages(absPath, pageNums)
  const pages: PreparedScannedPdf['pages'] = []
  const release = () => {
    for (const { prepared } of pages) cleanupPreparedAttachment(prepared)
    rmSync(rendered.outDir, { recursive: true, force: true })
  }
  try {
    for (const file of rendered.files) {
      pages.push({ page: file.page, prepared: await prepareImageAttachment(file.path, 'image/png') })
    }
  } catch (err) {
    release()
    throw err
  }
  return { pages, totalPages, release }
}

export async function runScannedPdfEnrichment(
  engine: EnrichmentEngine,
  scan: PreparedScannedPdf,
  jobKey: string,
  existingDescription?: string,
): Promise<VisionEnrichmentResult> {
  const { totalPages } = scan
  const perPage: Array<{ page: number; result: VisionEnrichmentResult }> = []
  for (const { page, prepared } of scan.pages) {
    const result = await engine.run({
      kind: 'image',
      mediaPath: prepared.path,
      mediaMime: prepared.mimeType,
      jobKey: `${jobKey}:p${page}`,
      ...(existingDescription ? { existingDescription } : {}),
    })
    perPage.push({ page, result })
  }
  const first = perPage[0]!.result
  const remainder = totalPages - SCANNED_OCR_MAX_PAGES
  const marker = remainder > 0
    ? `\n\n[page${remainder > 1 ? 's' : ''} ${SCANNED_OCR_MAX_PAGES + 1}${remainder > 1 ? `–${totalPages}` : ''} of ${totalPages} not OCR'd]`
    : ''
  return {
    ...(first.caption ? { caption: first.caption } : {}),
    ...(first.suggestedTags ? { suggestedTags: first.suggestedTags } : {}),
    ...(first.summary ? { summary: first.summary } : {}),
    ocrText: perPage.map((p) => `[page ${p.page}]\n${(p.result.ocrText ?? '').trim()}`).join('\n\n') + marker,
  }
}
