import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-trash-mcp-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

import '../../scripts/lib/trash-assets'
import { getExecTool } from '../../scripts/lib/registry'

function runTool(name: string, params: Record<string, unknown> = {}) {
  const tool = getExecTool(name)
  if (!tool) throw new Error(`Tool ${name} not registered`)
  return tool.handler(params, 'test-agent')
}

describe('trash MCP tools', () => {
  beforeEach(() => {
    mkdirSync(join(assetsRoot, '.trash'), { recursive: true })
    mkdirSync(join(assetsRoot, 'images', 'task-abc'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('bakin_exec_list_trash', () => {
    it('returns empty list when trash is empty', async () => {
      const result = await runTool('bakin_exec_list_trash')
      expect(result.ok).toBe(true)
      expect(result.count).toBe(0)
      expect(result.items).toEqual([])
    })

    it('returns structured result with trashed items', async () => {
      const ts = Date.now()
      writeFileSync(join(assetsRoot, '.trash', `hero.png__deleted-${ts}`), 'img-data')
      writeFileSync(join(assetsRoot, '.trash', `hero.png__deleted-${ts}.meta.json`), JSON.stringify({
        agent: 'pixel',
        taskId: 'task-abc',
        created: '2026-03-20T10:00:00Z',
      }))

      const result = await runTool('bakin_exec_list_trash') as { ok: boolean; count: number; items: Array<{ originalFilename: string; agent: string }> }

      expect(result.ok).toBe(true)
      expect(result.count).toBe(1)
      expect(result.items[0].originalFilename).toBe('hero.png')
      expect(result.items[0].agent).toBe('pixel')
    })
  })

  describe('bakin_exec_restore_trash', () => {
    it('restores and returns path', async () => {
      const ts = Date.now()
      const trashFilename = `photo.jpg__deleted-${ts}`
      writeFileSync(join(assetsRoot, '.trash', trashFilename), 'bytes')
      writeFileSync(join(assetsRoot, '.trash', `${trashFilename}.meta.json`), JSON.stringify({
        agent: 'pixel',
        taskId: 'task-abc',
        created: '2026-03-21T00:00:00Z',
      }))

      const result = await runTool('bakin_exec_restore_trash', { filename: trashFilename })

      expect(result.ok).toBe(true)
      expect(result.restoredPath).toBe('assets/images/task-abc/photo.jpg')
      expect(existsSync(join(assetsRoot, 'images', 'task-abc', 'photo.jpg'))).toBe(true)
    })

    it('fails for nonexistent file', async () => {
      const result = await runTool('bakin_exec_restore_trash', { filename: 'nope__deleted-999' })
      expect(result.ok).toBe(false)
    })

    it('fails when filename is missing', async () => {
      const result = await runTool('bakin_exec_restore_trash', {})
      expect(result.ok).toBe(false)
    })
  })

  describe('bakin_exec_empty_trash', () => {
    it('empties trash and returns count', async () => {
      const ts = Date.now()
      writeFileSync(join(assetsRoot, '.trash', `a.png__deleted-${ts}`), 'a')
      writeFileSync(join(assetsRoot, '.trash', `b.txt__deleted-${ts}`), 'b')

      const result = await runTool('bakin_exec_empty_trash')

      expect(result.ok).toBe(true)
      expect(result.deleted).toBe(2)
      expect(readdirSync(join(assetsRoot, '.trash')).length).toBe(0)
    })

    it('returns 0 for empty trash', async () => {
      const result = await runTool('bakin_exec_empty_trash')
      expect(result.ok).toBe(true)
      expect(result.deleted).toBe(0)
    })
  })
})
