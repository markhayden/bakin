/**
 * What a file's BYTES say it is, for the image lane (#855). A name or a
 * declared mime is a claim — an SVG renamed `.png` passes every
 * extension-based check and then gets rejected by the provider on every
 * billed attempt. The image lane trusts only the magic bytes.
 */
import { closeSync, openSync, readSync } from 'fs'

/** The vision-raster mime the file's header proves, or null (not one of the four, or unreadable). */
export function sniffVisionRasterMime(path: string): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const head = Buffer.alloc(12)
    const read = readSync(fd, head, 0, 12, 0)
    return sniffVisionRasterBytes(head.subarray(0, read))
  } catch {
    // Unreadable here means "not proven raster"; the caller's own read
    // surfaces the real filesystem error.
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

export function sniffVisionRasterBytes(head: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end))
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 4) === 'GIF8') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}
