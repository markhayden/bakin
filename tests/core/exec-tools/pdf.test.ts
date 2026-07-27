import { describe, it, expect, mock } from 'bun:test'
import { existsSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

const testDir = join(tmpdir(), `bakin-test-exec-pdf-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

// MCP-style access so the guidance test proves per-runtime rendering.
mock.module('../../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      describeToolAccess: () => ({ style: 'mcp', mcpServerTemplate: 'bakin-<agent>', perTurnExecToolFiltering: false }),
    },
  }),
}))

import { pdfReadTool, pdfRenderTool } from '../../../src/core/exec-tools/tools/pdf'
import { getAllExecTools } from '../../../src/core/exec-tools/registry'
import { RENDER_MAX_PAGES } from '../../../src/core/pdf/limits'

const TEXT_PDF = join(import.meta.dir, '../../fixtures/pdf/text.pdf')
const SCANNED_PDF = join(import.meta.dir, '../../fixtures/pdf/scanned.pdf')

describe('registration', () => {
  it('registers both tools in the live registry on import', () => {
    const names = getAllExecTools().map((t) => t.name)
    expect(names).toContain('bakin_exec_pdf_read')
    expect(names).toContain('bakin_exec_pdf_render')
  })
})

describe('bakin_exec_pdf_read', () => {
  it('returns info + per-page text for a text PDF', async () => {
    const result = await pdfReadTool({ path: TEXT_PDF }, 'main')
    expect(result.ok).toBe(true)
    const r = result as unknown as { info: { pageCount: number }; pages: Array<{ page: number; text: string; likelyScanned: boolean }>; guidance?: string }
    expect(r.info.pageCount).toBe(2)
    expect(r.pages[0]!.text).toContain('alpha-7291')
    expect(r.guidance).toBeUndefined()
  })

  it('honors page selection', async () => {
    const result = await pdfReadTool({ path: TEXT_PDF, pages: [2] }, 'main')
    const r = result as { ok: boolean; pages: Array<{ page: number; text: string }> }
    expect(r.pages).toHaveLength(1)
    expect(r.pages[0]!.page).toBe(2)
  })

  it('adds runtime-rendered guidance for scanned pages', async () => {
    const result = await pdfReadTool({ path: SCANNED_PDF }, 'pixel')
    expect(result.ok).toBe(true)
    const r = result as { guidance?: string }
    expect(r.guidance).toBeDefined()
    expect(r.guidance).toContain('scanned')
    // MCP access + agent pixel → server-qualified tool name
    expect(r.guidance).toContain('bakin-pixel.bakin_exec_pdf_render')
  })

  it('fails cleanly on a missing file', async () => {
    const result = await pdfReadTool({ path: join(testDir, 'nope.pdf') }, 'main')
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('no file')
  })

  it('fails cleanly on a non-PDF', async () => {
    const result = await pdfReadTool({ path: join(import.meta.dir, 'pdf.test.ts') }, 'main')
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('not a PDF')
  })
})

describe('bakin_exec_pdf_render', () => {
  it('renders pages and returns viewable paths', async () => {
    const result = await pdfRenderTool({ path: SCANNED_PDF, pages: [1] }, 'main')
    expect(result.ok).toBe(true)
    const r = result as unknown as { files: Array<{ page: number; path: string }>; note: string }
    expect(r.files).toHaveLength(1)
    expect(existsSync(r.files[0]!.path)).toBe(true)
    expect(readFileSync(r.files[0]!.path).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(r.note).toContain('read')
    rmSync(dirname(r.files[0]!.path), { recursive: true, force: true })
  })

  it('refuses over-cap page requests with an honest message', async () => {
    const tooMany = Array.from({ length: RENDER_MAX_PAGES + 1 }, (_, i) => i + 1)
    const result = await pdfRenderTool({ path: TEXT_PDF, pages: tooMany }, 'main')
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain(`${RENDER_MAX_PAGES} pages`)
  })
})
