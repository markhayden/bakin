import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── Mandatory isolation: temp content dir + OpenClaw home (CLAUDE.md rules) ──
const testDir = join(tmpdir(), `bakin-test-avatar-${Date.now()}`)
const agentsDir = join(testDir, 'agents')

const contentDirMock = {
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, agents: agentsDir }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}
mock.module('@/core/content-dir', () => contentDirMock)
mock.module('../../../src/core/content-dir', () => contentDirMock)
mock.module('@bakin/core/content-dir', () => contentDirMock)
mock.module('../../../packages/core/src/content-dir', () => contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...p: string[]) => join(testDir, 'openclaw', ...p),
  resetOpenClawHome: () => {},
}))

import { resolveAgentAvatar, detectImageExtension, serveAvatar } from '@bakin/core/agents/avatar'

// Minimal valid magic-byte headers.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
const JUNK = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])

function writeAvatar(id: string, ext: string, bytes: Uint8Array): string {
  const dir = join(agentsDir, id)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `avatar.${ext}`)
  writeFileSync(p, bytes)
  return p
}

beforeAll(() => mkdirSync(agentsDir, { recursive: true }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('detectImageExtension', () => {
  it('detects webp/png/jpg by magic bytes', () => {
    expect(detectImageExtension(WEBP)).toBe('webp')
    expect(detectImageExtension(PNG)).toBe('png')
    expect(detectImageExtension(JPG)).toBe('jpg')
  })
  it('returns null for unrecognized bytes', () => {
    expect(detectImageExtension(JUNK)).toBeNull()
    expect(detectImageExtension(new Uint8Array([]))).toBeNull()
  })
  it('does not mistake a too-short RIFF for webp', () => {
    expect(detectImageExtension(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull()
  })
})

describe('resolveAgentAvatar', () => {
  it('resolves jpg with image/jpeg', () => {
    writeAvatar('agent-jpg', 'jpg', JPG)
    const r = resolveAgentAvatar('agent-jpg')
    expect(r?.contentType).toBe('image/jpeg')
    expect(r?.size).toBe(JPG.length)
    expect(typeof r?.mtimeMs).toBe('number')
  })
  it('resolves png with image/png', () => {
    writeAvatar('agent-png', 'png', PNG)
    expect(resolveAgentAvatar('agent-png')?.contentType).toBe('image/png')
  })
  it('resolves webp with image/webp', () => {
    writeAvatar('agent-webp', 'webp', WEBP)
    expect(resolveAgentAvatar('agent-webp')?.contentType).toBe('image/webp')
  })
  it('prefers webp over png over jpg when several exist', () => {
    writeAvatar('agent-multi', 'jpg', JPG)
    writeAvatar('agent-multi', 'png', PNG)
    writeAvatar('agent-multi', 'webp', WEBP)
    expect(resolveAgentAvatar('agent-multi')?.contentType).toBe('image/webp')
  })
  it('returns null when no avatar exists', () => {
    expect(resolveAgentAvatar('agent-none')).toBeNull()
  })
  it('returns null for path-traversal / invalid ids', () => {
    expect(resolveAgentAvatar('../etc')).toBeNull()
    expect(resolveAgentAvatar('a/b')).toBeNull()
    expect(resolveAgentAvatar('')).toBeNull()
  })
})

describe('serveAvatar', () => {
  const bare = new Request('http://x/avatar')

  it('serves bytes with the right Content-Type + validators', () => {
    writeAvatar('serve-webp', 'webp', WEBP)
    const res = serveAvatar(bare, 'serve-webp')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(res.headers.get('ETag')).toBeTruthy()
    expect(res.headers.get('Last-Modified')).toBeTruthy()
    expect(res.headers.get('Cache-Control')).toContain('max-age')
  })

  it('returns 404 when the avatar is missing', () => {
    expect(serveAvatar(bare, 'serve-missing').status).toBe(404)
  })

  it('returns 304 on matching If-None-Match', () => {
    writeAvatar('serve-inm', 'png', PNG)
    const etag = serveAvatar(bare, 'serve-inm').headers.get('ETag')!
    const res = serveAvatar(new Request('http://x/avatar', { headers: { 'If-None-Match': etag } }), 'serve-inm')
    expect(res.status).toBe(304)
  })

  it('returns 304 on a satisfying If-Modified-Since', () => {
    writeAvatar('serve-ims', 'png', PNG)
    const lm = serveAvatar(bare, 'serve-ims').headers.get('Last-Modified')!
    const res = serveAvatar(new Request('http://x/avatar', { headers: { 'If-Modified-Since': lm } }), 'serve-ims')
    expect(res.status).toBe(304)
  })
})
