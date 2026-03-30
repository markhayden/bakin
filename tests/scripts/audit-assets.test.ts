import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-audit-${Date.now()}`)
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

// Mock generateThumbnail to avoid requiring ffmpeg in tests
vi.mock('../../scripts/lib/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../scripts/lib/common')>()
  return {
    ...actual,
    generateThumbnail: vi.fn((inputPath: string, outputPath: string) => {
      writeFileSync(outputPath, 'fake-thumb')
      return outputPath
    }),
  }
})

// Import the module to trigger registration, then get the tool from registry
import '../../scripts/lib/audit-assets'
import { getExecTool } from '../../scripts/lib/registry'

function runAudit(params: Record<string, unknown> = {}) {
  const tool = getExecTool('bakin_exec_audit_assets')
  if (!tool) throw new Error('audit tool not registered')
  return tool.handler(params, 'test-agent')
}

describe('bakin_exec_audit_assets', () => {
  beforeEach(() => {
    mkdirSync(join(assetsRoot, 'images', 'task-abc'), { recursive: true })
    mkdirSync(join(assetsRoot, 'text', 'task-def'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('registers the tool in the registry', () => {
    const tool = getExecTool('bakin_exec_audit_assets')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('bakin_exec_audit_assets')
  })

  it('reports healthy assets with no issues', async () => {
    const imgDir = join(assetsRoot, 'images', 'task-abc')
    writeFileSync(join(imgDir, 'hero.png'), 'png-data')
    writeFileSync(join(imgDir, 'hero.png.meta.json'), JSON.stringify({
      agent: 'pixel',
      taskId: 'task-abc',
      created: '2026-03-23T10:00:00Z',
    }))
    writeFileSync(join(imgDir, 'hero.thumb.jpg'), 'thumb-data')

    const result = await runAudit()
    expect(result.ok).toBe(true)
    expect((result as any).summary.total).toBeGreaterThanOrEqual(1)
  })

  it('detects missing thumbnails for images', async () => {
    const imgDir = join(assetsRoot, 'images', 'task-abc')
    writeFileSync(join(imgDir, 'hero.png'), 'png-data')
    writeFileSync(join(imgDir, 'hero.png.meta.json'), JSON.stringify({
      agent: 'pixel',
      taskId: 'task-abc',
      created: '2026-03-23T10:00:00Z',
    }))

    const result = await runAudit({ type: 'images' })
    expect(result.ok).toBe(true)
    const issues = (result as any).issues as { path: string; issue: string; fixed: boolean }[]
    expect(issues.some(i => i.issue === 'missing-thumbnail')).toBe(true)
  })

  it('fixes missing thumbnails when fix=true', async () => {
    const imgDir = join(assetsRoot, 'images', 'task-abc')
    writeFileSync(join(imgDir, 'hero.png'), 'png-data')
    writeFileSync(join(imgDir, 'hero.png.meta.json'), JSON.stringify({
      agent: 'pixel',
      taskId: 'task-abc',
      created: '2026-03-23T10:00:00Z',
    }))

    const result = await runAudit({ type: 'images', fix: true })
    expect(result.ok).toBe(true)

    const issues = (result as any).issues as { path: string; issue: string; fixed: boolean }[]
    const thumbIssue = issues.find(i => i.issue === 'missing-thumbnail')
    expect(thumbIssue).toBeDefined()
    expect(thumbIssue!.fixed).toBe(true)
    expect(existsSync(join(imgDir, 'hero.thumb.jpg'))).toBe(true)
  })

  it('detects missing sidecars', async () => {
    const imgDir = join(assetsRoot, 'images', 'task-abc')
    writeFileSync(join(imgDir, 'orphan.png'), 'png-data')
    // No .meta.json

    const result = await runAudit({ type: 'images' })
    expect(result.ok).toBe(true)
    const issues = (result as any).issues as { path: string; issue: string }[]
    expect(issues.some(i => i.issue === 'missing-sidecar')).toBe(true)
  })

  it('fixes missing sidecars when fix=true', async () => {
    const imgDir = join(assetsRoot, 'images', 'task-abc')
    writeFileSync(join(imgDir, 'orphan.png'), 'png-data')

    const result = await runAudit({ type: 'images', fix: true })
    expect(result.ok).toBe(true)
    expect(existsSync(join(imgDir, 'orphan.png.meta.json'))).toBe(true)

    const issues = (result as any).issues as { path: string; issue: string; fixed: boolean }[]
    const sidecarIssue = issues.find(i => i.issue === 'missing-sidecar')
    expect(sidecarIssue!.fixed).toBe(true)
  })

  it('detects stub sidecars (agent: unknown)', async () => {
    const imgDir = join(assetsRoot, 'images', 'task-abc')
    writeFileSync(join(imgDir, 'img.png'), 'data')
    writeFileSync(join(imgDir, 'img.png.meta.json'), JSON.stringify({
      agent: 'unknown',
      taskId: 'task-abc',
      created: '2026-03-23T10:00:00Z',
    }))
    writeFileSync(join(imgDir, 'img.thumb.jpg'), 'thumb')

    const result = await runAudit({ type: 'images' })
    const issues = (result as any).issues as { path: string; issue: string }[]
    expect(issues.some(i => i.issue === 'stub-sidecar')).toBe(true)
  })

  it('detects orphaned variants', async () => {
    const imgDir = join(assetsRoot, 'images', 'task-abc')
    // Thumbnail without a primary
    writeFileSync(join(imgDir, 'deleted.thumb.jpg'), 'thumb-data')
    writeFileSync(join(imgDir, 'deleted.thumb.jpg.meta.json'), JSON.stringify({
      agent: 'unknown',
      taskId: 'task-abc',
      created: '2026-03-23T10:00:00Z',
    }))

    const result = await runAudit({ type: 'images' })
    const issues = (result as any).issues as { path: string; issue: string }[]
    expect(issues.some(i => i.issue === 'orphaned-variant')).toBe(true)
  })

  it('detects orphaned sidecars', async () => {
    const imgDir = join(assetsRoot, 'images', 'task-abc')
    // Sidecar without an asset
    writeFileSync(join(imgDir, 'gone.png.meta.json'), JSON.stringify({
      agent: 'pixel',
      taskId: 'task-abc',
      created: '2026-03-23T10:00:00Z',
    }))

    const result = await runAudit({ type: 'images' })
    const issues = (result as any).issues as { path: string; issue: string }[]
    expect(issues.some(i => i.issue === 'orphaned-sidecar')).toBe(true)
  })

  it('filters by asset type', async () => {
    const imgDir = join(assetsRoot, 'images', 'task-abc')
    writeFileSync(join(imgDir, 'img.png'), 'data')

    const textDir = join(assetsRoot, 'text', 'task-def')
    writeFileSync(join(textDir, 'doc.md'), 'text')

    const result = await runAudit({ type: 'text' })
    const issues = (result as any).issues as { path: string; issue: string }[]
    // Should not report missing thumbnails for text (thumbnail check is images-only)
    expect(issues.every(i => !i.issue.includes('missing-thumbnail'))).toBe(true)
  })

  it('returns error when assets directory missing', async () => {
    rmSync(assetsRoot, { recursive: true, force: true })
    const result = await runAudit()
    expect(result.ok).toBe(false)
  })
})
