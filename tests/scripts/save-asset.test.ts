import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

// Mock content-dir — uses flat dot-notation keys like 'assets.images'
vi.mock('../../src/core/content-dir', () => ({
  getContentDir: vi.fn(() => testDir || '/tmp/bakin-test'),
  getBakinPaths: vi.fn(() => {
    const home = testDir || '/tmp/bakin-test'
    const assets = join(home, 'assets')
    return {
      home,
      assets,
      'assets.text': join(assets, 'text'),
      'assets.images': join(assets, 'images'),
      'assets.video': join(assets, 'video'),
      'assets.audio': join(assets, 'audio'),
      'assets.plans': join(assets, 'plans'),
      'assets.data': join(assets, 'data'),
      'assets.other': join(assets, 'other'),
    }
  }),
}))

// Mock the registry to prevent circular init from self-registering modules
vi.mock('../../scripts/lib/registry', () => ({
  addExecTool: vi.fn(),
  getAllExecTools: vi.fn(() => []),
  getExecTool: vi.fn(),
  recordExecToolCall: vi.fn(),
  getExecToolStats: vi.fn(() => []),
}))

// Mock transitive dependencies that pull in content-dir
vi.mock('../../src/lib/content', () => ({}))
vi.mock('../../plugins/tasks/taskboard', () => ({}))

import { saveAsset } from '../../scripts/lib/save-asset'

describe('saveAsset', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-test-'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('copies file and creates sidecar', async () => {
    const srcFile = join(testDir, 'photo.png')
    writeFileSync(srcFile, 'fake-image-data')

    const result = await saveAsset({
      filePath: srcFile,
      taskId: 'task-123',
      type: 'images',
      description: 'A test image',
      agent: 'pixel',
    })

    expect(result.ok).toBe(true)
    expect(result.path).toBeDefined()
    expect(result.metadataPath).toBeDefined()

    // Result paths are relative — resolve against testDir to check files
    const absPath = join(testDir, result.path as string)
    const absMetaPath = join(testDir, result.metadataPath as string)

    // Verify file was copied
    expect(existsSync(absPath)).toBe(true)
    expect(readFileSync(absPath, 'utf-8')).toBe('fake-image-data')

    // Verify sidecar
    expect(existsSync(absMetaPath)).toBe(true)
    const meta = JSON.parse(readFileSync(absMetaPath, 'utf-8'))
    expect(meta.agent).toBe('pixel')
    expect(meta.taskId).toBe('task-123')
    expect(meta.description).toBe('A test image')
    expect(meta.created).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('uses YYYYMMDD-slug.ext naming', async () => {
    const srcFile = join(testDir, 'my cool photo.png')
    writeFileSync(srcFile, 'data')

    const result = await saveAsset({
      filePath: srcFile,
      taskId: 'task-456',
      type: 'images',
      agent: 'pixel',
    })

    expect(result.ok).toBe(true)
    const filename = result.filename as string
    expect(filename).toMatch(/^\d{8}-my-cool-photo\.png$/)
  })

  it('uses custom slug when provided', async () => {
    const srcFile = join(testDir, 'original.png')
    writeFileSync(srcFile, 'data')

    const result = await saveAsset({
      filePath: srcFile,
      taskId: 'task-789',
      type: 'images',
      slug: 'golden-hour',
      agent: 'pixel',
    })

    expect(result.ok).toBe(true)
    expect(result.filename).toMatch(/^\d{8}-golden-hour\.png$/)
  })

  it('fails for nonexistent source file', async () => {
    const result = await saveAsset({
      filePath: '/nonexistent/file.png',
      taskId: 'task-000',
      type: 'images',
      agent: 'pixel',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('creates task directory if it does not exist', async () => {
    const srcFile = join(testDir, 'test.txt')
    writeFileSync(srcFile, 'content')

    const result = await saveAsset({
      filePath: srcFile,
      taskId: 'brand-new-task',
      type: 'text',
      agent: 'chef',
    })

    expect(result.ok).toBe(true)
    const dirPath = join(testDir, 'assets', 'text', 'brand-new-task')
    expect(existsSync(dirPath)).toBe(true)
  })

  it('includes tags in sidecar metadata', async () => {
    const srcFile = join(testDir, 'photo.png')
    writeFileSync(srcFile, 'data')

    const result = await saveAsset({
      filePath: srcFile,
      taskId: 'task-tag',
      type: 'images',
      tags: ['hero', 'blog'],
      agent: 'pixel',
    })

    expect(result.ok).toBe(true)
    const absMetaPath = join(testDir, result.metadataPath as string)
    const meta = JSON.parse(readFileSync(absMetaPath, 'utf-8'))
    expect(meta.tags).toEqual(['hero', 'blog'])
  })
})
