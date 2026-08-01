/**
 * Scanned-PDF enrichment (#747): a PDF with no text layer renders its first
 * pages through the ONE core PDF engine and runs each page through the
 * EXISTING single-image vision pipeline — page-labeled ocrText merge, a
 * visible marker for pages past the budget, caption/tags/summary from the
 * page-1 call. Any page failure fails the WHOLE job (the queue's bounded
 * retry/error path owns recovery) — partial results are never applied.
 *
 * Deliberately NOT the ocr capability pack: enrichment must work without
 * optional packs, and the vision call yields caption+tags in the same
 * request (#742 D9 stands — the server never spawns pack binaries).
 */
import { rmSync } from 'fs'
import type { VisionEnrichmentResult } from '@bakin/core/media'
import { readPdf, renderPdfPages } from '../../../../src/core/pdf/engine'
import type { EnrichmentEngine } from './engine'

/** Vision-OCR page budget per scanned PDF (interview decision #2 — 3 pages,
 * sequential single-image calls; the char/render caps live in the engine). */
export const SCANNED_OCR_MAX_PAGES = 3

export function isPdfPath(absPath: string): boolean {
  return absPath.toLowerCase().endsWith('.pdf')
}

export async function runScannedPdfEnrichment(
  engine: EnrichmentEngine,
  absPath: string,
  jobKey: string,
  existingDescription?: string,
): Promise<VisionEnrichmentResult> {
  const totalPages = (await readPdf(absPath, [1])).info.pageCount
  const pageNums = Array.from({ length: Math.min(totalPages, SCANNED_OCR_MAX_PAGES) }, (_, i) => i + 1)
  const rendered = await renderPdfPages(absPath, pageNums)
  try {
    const perPage: Array<{ page: number; result: VisionEnrichmentResult }> = []
    for (const file of rendered.files) {
      const result = await engine.run({
        kind: 'image',
        mediaPath: file.path,
        mediaMime: 'image/png',
        jobKey: `${jobKey}:p${file.page}`,
        ...(existingDescription ? { existingDescription } : {}),
      })
      perPage.push({ page: file.page, result })
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
  } finally {
    rmSync(rendered.outDir, { recursive: true, force: true })
  }
}
