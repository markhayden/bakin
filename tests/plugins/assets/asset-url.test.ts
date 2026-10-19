/**
 * Asset file URLs are absolute and canonical (antfly 0.2.5 repin review): the
 * search engine reads `file://` media only from an allowlisted store and
 * checks the URL's path lexically first, so a URL must never carry a relative
 * home (read as a hostname) or a symlink spelling that differs by process.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-asset-url-${Date.now()}-${randomUUID()}`)
let assetsRoot = join(testDir, 'home', 'assets')
const paths = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: join(testDir, 'home'), assets: assetsRoot }) })
mock.module('../../../src/core/content-dir', paths)
mock.module('../../../packages/core/src/content-dir', paths)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { buildAssetFileUrl } from '../../../plugins/assets/lib/asset-url'

const realHome = join(testDir, 'home')
mkdirSync(join(realHome, 'assets', 'store'), { recursive: true })
symlinkSync(realHome, join(testDir, 'linked-home'))
const canonicalAssets = realpathSync(join(realHome, 'assets'))

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => { assetsRoot = join(testDir, 'home', 'assets') })

describe('buildAssetFileUrl', () => {
  it('a symlinked home yields the same canonical URL as the real one', () => {
    const direct = buildAssetFileUrl('store/2026-10/x/thumb.jpg')
    assetsRoot = join(testDir, 'linked-home', 'assets')
    expect(buildAssetFileUrl('store/2026-10/x/thumb.jpg')).toBe(direct)
    expect(direct).toBe(`file://${canonicalAssets}/store/2026-10/x/thumb.jpg`)
  })

  it('a relative home yields an absolute file URL, never a hostname', () => {
    assetsRoot = relative(process.cwd(), join(testDir, 'home', 'assets'))
    const url = buildAssetFileUrl('store/a.png')
    expect(url.startsWith('file:///')).toBe(true)
    expect(url).toBe(`file://${canonicalAssets}/store/a.png`)
  })

  it('still percent-encodes each segment', () => {
    expect(buildAssetFileUrl('store/my file%.png')).toBe(`file://${canonicalAssets}/store/my%20file%25.png`)
  })

  it('a symlinked home over a symlinked store yields the store\'s real path — no intermediate spelling', () => {
    const disk = join(testDir, 'disk-store')
    mkdirSync(disk, { recursive: true })
    const home2 = join(testDir, 'home2')
    mkdirSync(join(home2, 'assets'), { recursive: true })
    symlinkSync(disk, join(home2, 'assets', 'store'))
    symlinkSync(home2, join(testDir, 'alias2'))
    assetsRoot = join(testDir, 'alias2', 'assets')
    expect(buildAssetFileUrl('store/2026-10/x/thumb.jpg')).toBe(`file://${realpathSync(disk)}/2026-10/x/thumb.jpg`)
  })

  it('a backslash in a filename is kept exactly — never resolved into a separator', () => {
    mkdirSync(join(realHome, 'assets', 'store', 'dir'), { recursive: true })
    writeFileSync(join(realHome, 'assets', 'store', 'dir\\b.png'), 'x')
    writeFileSync(join(realHome, 'assets', 'store', 'dir', 'b.png'), 'y')
    expect(buildAssetFileUrl('store/dir\\b.png')).toBe(`file://${join(realHome, 'assets')}/store/dir%5Cb.png`)
  })

  it('an assets root that does not exist yet still yields an absolute URL', () => {
    assetsRoot = join(testDir, 'not-yet', 'assets')
    expect(buildAssetFileUrl('store/a.png')).toBe(`file://${join(realpathSync(testDir), 'not-yet', 'assets')}/store/a.png`)
  })
})
