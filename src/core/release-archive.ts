import { gunzipSync, gzipSync } from 'node:zlib'

const TAR_BLOCK_SIZE = 512
const TAR_END_SIZE = TAR_BLOCK_SIZE * 2
const ARCHIVE_EXTENSION = '.tar.gz'
const ARCHIVE_ENTRY_NAME = 'bakin'

export function releaseBinaryNameForTriple(triple: string): string {
  return `bakin-${triple}`
}

export function releaseArchiveNameForBinary(binaryName: string): string {
  return `${binaryName}${ARCHIVE_EXTENSION}`
}

export function releaseArchiveNameForTriple(triple: string): string {
  return releaseArchiveNameForBinary(releaseBinaryNameForTriple(triple))
}

function writeString(buffer: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, 'utf-8')
  if (bytes.length > length) {
    throw new Error(`tar field is too long: ${value}`)
  }
  bytes.copy(buffer, offset)
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid tar octal value: ${value}`)
  }
  const text = value.toString(8).padStart(length - 1, '0')
  if (text.length > length - 1) {
    throw new Error(`tar octal value does not fit: ${value}`)
  }
  buffer.write(text, offset, length - 1, 'ascii')
  buffer[offset + length - 1] = 0
}

function readOctal(buffer: Buffer, offset: number, length: number): number {
  const raw = buffer.toString('ascii', offset, offset + length).replace(/\0.*$/, '').trim()
  if (!raw) return 0
  if (!/^[0-7]+$/.test(raw)) {
    throw new Error(`malformed tar octal field: ${raw}`)
  }
  return Number.parseInt(raw, 8)
}

function isZeroBlock(buffer: Buffer, offset: number): boolean {
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    if (buffer[offset + i] !== 0) return false
  }
  return true
}

function paddedContentLength(length: number): number {
  return Math.ceil(length / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE
}

export function createBakinTarGz(binary: Buffer): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE)
  writeString(header, 0, 100, ARCHIVE_ENTRY_NAME)
  writeOctal(header, 100, 8, 0o755)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, binary.length)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  writeString(header, 257, 6, 'ustar')
  writeString(header, 263, 2, '00')
  writeString(header, 265, 32, 'root')
  writeString(header, 297, 32, 'root')

  let checksum = 0
  for (const byte of header) checksum += byte
  const checksumText = checksum.toString(8).padStart(6, '0')
  header.write(checksumText, 148, 6, 'ascii')
  header[154] = 0
  header[155] = 0x20

  const padding = Buffer.alloc(paddedContentLength(binary.length) - binary.length)
  const tar = Buffer.concat([header, binary, padding, Buffer.alloc(TAR_END_SIZE)])
  return gzipSync(tar, { level: 9 })
}

export function extractBakinFromTarGz(archive: Buffer): Buffer {
  const tar = gunzipSync(archive)
  let offset = 0

  while (offset + TAR_BLOCK_SIZE <= tar.length) {
    if (isZeroBlock(tar, offset)) break

    const name = tar.toString('utf-8', offset, offset + 100).replace(/\0.*$/, '')
    const type = tar[offset + 156]
    const size = readOctal(tar, offset + 124, 12)
    const dataStart = offset + TAR_BLOCK_SIZE
    const dataEnd = dataStart + size
    if (dataEnd > tar.length) {
      throw new Error(`tar entry ${name || '<unnamed>'} extends past archive end`)
    }

    if (name === ARCHIVE_ENTRY_NAME && (type === 0 || type === '0'.charCodeAt(0))) {
      return Buffer.from(tar.subarray(dataStart, dataEnd))
    }

    offset = dataStart + paddedContentLength(size)
  }

  throw new Error(`archive is missing ${ARCHIVE_ENTRY_NAME}`)
}
