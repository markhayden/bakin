/**
 * The image lane trusts magic bytes, never names (#855). Pure-ish: reads
 * temp files only, imports no app modules that touch ~/.bakin.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { sniffVisionRasterBytes, sniffVisionRasterMime } from '../../../packages/core/src/media/raster-sniff'

const testDir = join(tmpdir(), `bakin-test-raster-sniff-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('sniffVisionRasterBytes', () => {
  it('recognizes the four vision-raster formats', () => {
    expect(sniffVisionRasterBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png')
    expect(sniffVisionRasterBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffVisionRasterBytes(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(sniffVisionRasterBytes(Buffer.from('RIFF\0\0\0\0WEBP'))).toBe('image/webp')
  })

  it('rejects SVG, BMP, empty and short input', () => {
    expect(sniffVisionRasterBytes(Buffer.from('<svg xmlns='))).toBeNull()
    expect(sniffVisionRasterBytes(Buffer.from('BM:\0\0\0'))).toBeNull()
    expect(sniffVisionRasterBytes(Buffer.alloc(0))).toBeNull()
    expect(sniffVisionRasterBytes(Buffer.from('RIFF'))).toBeNull()
  })
})

describe('sniffVisionRasterMime', () => {
  it('reads the header from disk regardless of the file name', () => {
    const liar = join(testDir, 'logo.png')
    writeFileSync(liar, '<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(sniffVisionRasterMime(liar)).toBeNull()
    const real = join(testDir, 'photo.svg')
    writeFileSync(real, Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0]))
    expect(sniffVisionRasterMime(real)).toBe('image/jpeg')
  })

  it('a missing file is "not proven raster", not a throw', () => {
    expect(sniffVisionRasterMime(join(testDir, 'nope.png'))).toBeNull()
  })
})
