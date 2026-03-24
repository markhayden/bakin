import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readSidecar, writeSidecar, createStub, getSidecarPath, validateSidecar } from '@mc/assets/lib/sidecar'

describe('assets/sidecar', () => {
  const testDir = join(tmpdir(), `beacon-test-sidecar-${Date.now()}`)
  const assetsDir = join(testDir, 'assets', 'images', 'task123')

  beforeEach(() => {
    mkdirSync(assetsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('getSidecarPath', () => {
    it('appends .meta.json to the asset path', () => {
      expect(getSidecarPath('/path/to/image.png')).toBe('/path/to/image.png.meta.json')
    })
  })

  describe('writeSidecar / readSidecar', () => {
    it('writes and reads sidecar metadata', () => {
      const assetPath = join(assetsDir, 'hero.png')
      writeFileSync(assetPath, 'fake-image-data')

      const meta = {
        agent: 'pixel',
        taskId: 'task123',
        created: '2026-03-23T14:00:00Z',
        tool: 'dall-e-3',
        description: 'Hero image for blog',
        tags: ['hero', 'blog'],
      }

      writeSidecar(assetPath, meta)

      expect(existsSync(getSidecarPath(assetPath))).toBe(true)

      const read = readSidecar(assetPath)
      expect(read).not.toBeNull()
      expect(read!.agent).toBe('pixel')
      expect(read!.taskId).toBe('task123')
      expect(read!.tool).toBe('dall-e-3')
      expect(read!.description).toBe('Hero image for blog')
      expect(read!.tags).toEqual(['hero', 'blog'])
    })

    it('returns null when sidecar does not exist', () => {
      const result = readSidecar(join(assetsDir, 'nonexistent.png'))
      expect(result).toBeNull()
    })

    it('normalizes malformed sidecar data', () => {
      const assetPath = join(assetsDir, 'bad.png')
      writeFileSync(assetPath, 'data')
      writeFileSync(getSidecarPath(assetPath), JSON.stringify({
        agent: 42, // wrong type
        taskId: null,
        // missing created
        tags: ['valid', 123, null], // mixed types
      }))

      const read = readSidecar(assetPath)
      expect(read).not.toBeNull()
      expect(read!.agent).toBe('unknown') // normalized from non-string
      expect(read!.taskId).toBeNull()
      expect(typeof read!.created).toBe('string') // filled in
      expect(read!.tags).toEqual(['valid']) // filtered non-strings
    })

    it('returns null for invalid JSON sidecar', () => {
      const assetPath = join(assetsDir, 'corrupt.png')
      writeFileSync(assetPath, 'data')
      writeFileSync(getSidecarPath(assetPath), 'not json at all')

      const result = readSidecar(assetPath)
      expect(result).toBeNull()
    })
  })

  describe('createStub', () => {
    it('creates a stub sidecar for an asset', () => {
      const assetPath = join(assetsDir, 'orphan.png')
      writeFileSync(assetPath, 'data')

      const stub = createStub(assetPath)

      expect(stub.agent).toBe('unknown')
      expect(stub.taskId).toBe('task123') // inferred from dir
      expect(typeof stub.created).toBe('string')
      expect(existsSync(getSidecarPath(assetPath))).toBe(true)
    })

    it('infers null taskId from _unlinked directory', () => {
      const unlinkedDir = join(testDir, 'assets', 'images', '_unlinked')
      mkdirSync(unlinkedDir, { recursive: true })
      const assetPath = join(unlinkedDir, 'loose.png')
      writeFileSync(assetPath, 'data')

      const stub = createStub(assetPath)
      expect(stub.taskId).toBeNull()
    })

    it('infers null taskId from library directory', () => {
      const libraryDir = join(testDir, 'assets', 'images', 'library')
      mkdirSync(libraryDir, { recursive: true })
      const assetPath = join(libraryDir, 'logo.png')
      writeFileSync(assetPath, 'data')

      const stub = createStub(assetPath)
      expect(stub.taskId).toBeNull()
    })
  })

  describe('validateSidecar', () => {
    it('returns no issues for valid sidecar', () => {
      const metaPath = join(assetsDir, 'valid.png.meta.json')
      writeFileSync(metaPath, JSON.stringify({
        agent: 'pixel',
        taskId: 'task123',
        created: '2026-03-23T14:00:00Z',
      }))

      const issues = validateSidecar(metaPath)
      expect(issues).toHaveLength(0)
    })

    it('reports missing required fields', () => {
      const metaPath = join(assetsDir, 'partial.png.meta.json')
      writeFileSync(metaPath, JSON.stringify({ agent: 'pixel' }))

      const issues = validateSidecar(metaPath)
      expect(issues.length).toBeGreaterThan(0)
      expect(issues.some(i => i.includes('taskId'))).toBe(true)
      expect(issues.some(i => i.includes('created'))).toBe(true)
    })

    it('reports invalid JSON', () => {
      const metaPath = join(assetsDir, 'broken.png.meta.json')
      writeFileSync(metaPath, 'not json')

      const issues = validateSidecar(metaPath)
      expect(issues).toContain('Invalid JSON')
    })

    it('reports missing file', () => {
      const issues = validateSidecar(join(assetsDir, 'nope.png.meta.json'))
      expect(issues).toContain('File does not exist')
    })

    it('detects wrong field names (author instead of agent)', () => {
      const metaPath = join(assetsDir, 'aliased.png.meta.json')
      writeFileSync(metaPath, JSON.stringify({
        author: 'pixel',
        taskId: 'task123',
        createdAt: '2026-03-23T14:00:00Z',
      }))

      const issues = validateSidecar(metaPath)
      expect(issues.some(i => i.includes('"author"') && i.includes('"agent"'))).toBe(true)
      expect(issues.some(i => i.includes('"createdAt"') && i.includes('"created"'))).toBe(true)
    })

    it('detects unknown/extra fields', () => {
      const metaPath = join(assetsDir, 'extras.png.meta.json')
      writeFileSync(metaPath, JSON.stringify({
        agent: 'pixel',
        taskId: 'task123',
        created: '2026-03-23T14:00:00Z',
        prompt: 'draw a pop tart',
        resolution: '1024x1024',
        aspectRatio: '1:1',
      }))

      const issues = validateSidecar(metaPath)
      expect(issues.some(i => i.includes('Unknown fields') && i.includes('prompt'))).toBe(true)
    })

    it('does not warn about known optional fields', () => {
      const metaPath = join(assetsDir, 'full.png.meta.json')
      writeFileSync(metaPath, JSON.stringify({
        agent: 'pixel',
        taskId: 'task123',
        created: '2026-03-23T14:00:00Z',
        tool: 'dall-e-3',
        description: 'A nice image',
        tags: ['art'],
        originalFilename: 'original.png',
      }))

      const issues = validateSidecar(metaPath)
      expect(issues).toHaveLength(0)
    })
  })

  describe('readSidecar auto-correction', () => {
    it('auto-corrects author to agent', () => {
      const assetPath = join(assetsDir, 'aliased.png')
      writeFileSync(assetPath, 'data')
      writeFileSync(getSidecarPath(assetPath), JSON.stringify({
        author: 'pixel',
        taskId: 'task123',
        created: '2026-03-23T14:00:00Z',
      }))

      const read = readSidecar(assetPath)
      expect(read).not.toBeNull()
      expect(read!.agent).toBe('pixel')
    })

    it('auto-corrects createdAt to created', () => {
      const assetPath = join(assetsDir, 'timey.png')
      writeFileSync(assetPath, 'data')
      writeFileSync(getSidecarPath(assetPath), JSON.stringify({
        agent: 'pixel',
        taskId: 'task123',
        createdAt: '2026-03-23T14:00:00Z',
      }))

      const read = readSidecar(assetPath)
      expect(read).not.toBeNull()
      expect(read!.created).toBe('2026-03-23T14:00:00Z')
    })

    it('does not overwrite correct field with alias', () => {
      const assetPath = join(assetsDir, 'both.png')
      writeFileSync(assetPath, 'data')
      writeFileSync(getSidecarPath(assetPath), JSON.stringify({
        agent: 'basil',
        author: 'pixel',
        taskId: 'task123',
        created: '2026-03-23T14:00:00Z',
      }))

      const read = readSidecar(assetPath)
      expect(read).not.toBeNull()
      expect(read!.agent).toBe('basil') // correct field takes precedence
    })
  })
})
