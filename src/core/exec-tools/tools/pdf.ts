/**
 * bakin_exec_pdf_read / bakin_exec_pdf_render — the blessed path for
 * inspecting PDF files (chat attachments, assets, any absolute path).
 * Thin wrappers over the ONE PDF engine (src/core/pdf/engine.ts); see #742.
 *
 * Scanned/image-only pages carry self-guiding advice: render the pages and
 * view the PNGs with the agent's own image-capable file tools — the tool
 * never dead-ends on a scanned document.
 */
import { z } from 'zod'
import { getAppServices } from '@/core/app-services'
import { createLogger } from '@/core/logger'
import { PdfError, readPdf, renderPdfPages } from '@/core/pdf/engine'
import { renderToolCall } from '@/core/tool-access'
import { addExecTool } from '../registry'
import { succeed, fail } from './common'
import type { ExecToolResult } from '@bakin/core/plugin-types'

const log = createLogger('exec-tools:pdf')

const failFromError = (err: unknown): ExecToolResult => {
  if (err instanceof PdfError) return fail(err.message, { kind: err.kind })
  log.error('pdf tool failed unexpectedly', err as Error)
  return fail(`pdf operation failed: ${(err as Error).message}`)
}

/** Render the pdf_render invocation in the ACTIVE runtime's calling style so
 * guidance is copy-pasteable on Pi (bare) and OpenClaw (server-qualified). */
function renderInvocation(agentId: string): string {
  try {
    const access = getAppServices().runtime.describeToolAccess()
    return renderToolCall(access, { agentId, tool: 'bakin_exec_pdf_render', args: 'path=<path> pages=[1,2]' })
  } catch {
    return 'bakin_exec_pdf_render path=<path> pages=[1,2]' // runtime unavailable — plain style
  }
}

/** When the ocr capability pack is installed and ready, scanned-page guidance
 * also offers the bash lane — ocrit reads PDFs directly (no render step).
 * Guidance-only by design (#742 D9): the engine never spawns the binary. */
async function ocrLaneHint(path: string): Promise<string> {
  try {
    const { listCapabilities } = await import('@/core/agent-packages/capability-readiness')
    const ocr = (await listCapabilities()).find((c) => c.capability === 'ocr')
    return ocr?.ready ? ` For machine-exact text, you can also run \`ocrit ${path}\` in bash (local OCR; reads PDFs directly).` : ''
  } catch {
    return '' // readiness unknown — offer nothing rather than a broken lane
  }
}

export async function pdfReadTool(
  params: { path: string; pages?: number[] },
  agent: string,
): Promise<ExecToolResult> {
  try {
    const result = await readPdf(params.path, params.pages)
    const scanned = result.pages.filter((p) => p.likelyScanned).map((p) => p.page)
    return succeed({
      info: result.info,
      pages: result.pages,
      ...(result.truncated ? { truncated: true } : {}),
      ...(scanned.length
        ? {
            guidance:
              `Page(s) ${scanned.join(', ')} look scanned or image-only (little/no text layer). ` +
              `Render them with \`${renderInvocation(agent)}\` and view the PNGs with your image-capable file tools.` +
              (await ocrLaneHint(params.path)),
          }
        : {}),
    })
  } catch (err) {
    return failFromError(err)
  }
}

export async function pdfRenderTool(
  params: { path: string; pages?: number[] },
  _agent: string,
): Promise<ExecToolResult> {
  try {
    const result = await renderPdfPages(params.path, params.pages)
    return succeed({
      files: result.files,
      ...(result.truncated ? { truncated: true } : {}),
      note:
        (result.truncated
          ? `Rendered ${result.files.length} of ${result.totalPages} pages — call again with pages=[${result.files.length + 1}, …] for the rest. `
          : '') + 'Temporary PNGs — read/view them with your image-capable file tools now; the OS owns cleanup.',
    })
  } catch (err) {
    return failFromError(err)
  }
}

const pagesParam = z
  .array(z.number().int().min(1))
  .optional()
  .describe('1-indexed page numbers to select; omit for the whole document (capped)')

addExecTool({
  name: 'bakin_exec_pdf_read',
  label: 'Read PDF',
  description:
    'Read a PDF file: metadata (page count, title) plus extracted per-page text. ' +
    'Flags scanned/image-only pages and tells you how to view them.',
  source: 'core',
  parameters: {
    path: z.string().describe('Absolute path to the PDF file'),
    pages: pagesParam,
  },
  handler: async (params, agent) => pdfReadTool(params as { path: string; pages?: number[] }, agent),
})

addExecTool({
  name: 'bakin_exec_pdf_render',
  label: 'Render PDF pages',
  description:
    'Render PDF pages to PNG images (max 10 per call) and return their paths — ' +
    'view the PNGs with your image-capable file tools. Use for scanned or visually rich PDFs.',
  source: 'core',
  parameters: {
    path: z.string().describe('Absolute path to the PDF file'),
    pages: pagesParam,
  },
  handler: async (params, agent) => pdfRenderTool(params as { path: string; pages?: number[] }, agent),
})
