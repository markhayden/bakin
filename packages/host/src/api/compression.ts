import type { IncomingMessage, ServerResponse } from 'http'
import { promisify } from 'util'
import {
  constants as zlibConstants,
  brotliCompress,
  gzip,
} from 'zlib'

const brotliCompressAsync = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

const MIN_COMPRESS_BYTES = 1024

type HeaderMap = Record<string, string | number>

export interface EncodedBody {
  body: Buffer
  headers: HeaderMap
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return String(value)
  }
  return undefined
}

function removeHeader(headers: HeaderMap, name: string): void {
  const expected = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === expected) delete headers[key]
  }
}

function setHeader(headers: HeaderMap, name: string, value: string): void {
  removeHeader(headers, name)
  headers[name] = value
}

function appendVary(headers: HeaderMap, value: string): void {
  const existing = headerValue(headers, 'vary')
  if (!existing) {
    headers.Vary = value
    return
  }
  const parts = existing.split(',').map((part) => part.trim().toLowerCase())
  if (!parts.includes(value.toLowerCase())) {
    setHeader(headers, 'Vary', `${existing}, ${value}`)
  }
}

function qualityForEncoding(req: IncomingMessage, encoding: 'br' | 'gzip'): number {
  const raw = req.headers['accept-encoding']
  const value = Array.isArray(raw) ? raw.join(',') : raw ?? ''
  let exact: number | null = null
  let wildcard: number | null = null
  for (const item of value.split(',')) {
    const [tokenPart, ...paramParts] = item.split(';').map((part) => part.trim().toLowerCase())
    if (!tokenPart) continue
    const qPart = paramParts.find((part) => part.startsWith('q='))
    const parsedQ = qPart ? Number(qPart.slice(2)) : 1
    const q = Number.isFinite(parsedQ) ? Math.max(0, Math.min(1, parsedQ)) : 0
    if (tokenPart === encoding) exact = Math.max(exact ?? 0, q)
    if (tokenPart === '*') wildcard = Math.max(wildcard ?? 0, q)
  }
  return exact ?? wildcard ?? 0
}

function preferredEncoding(req: IncomingMessage): 'br' | 'gzip' | null {
  const br = qualityForEncoding(req, 'br')
  const gzip = qualityForEncoding(req, 'gzip')
  if (br <= 0 && gzip <= 0) return null
  return br >= gzip ? 'br' : 'gzip'
}

export function isCompressibleContentType(contentType: string | undefined): boolean {
  if (!contentType) return false
  const type = contentType.toLowerCase().split(';')[0]?.trim()
  if (!type) return false
  if (type.startsWith('text/') && type !== 'text/event-stream') return true
  return [
    'application/javascript',
    'application/json',
    'application/manifest+json',
    'application/xml',
    'image/svg+xml',
  ].includes(type)
}

export function canCompressResponse(
  req: IncomingMessage,
  status: number,
  headers: HeaderMap,
  bodyLength?: number,
): boolean {
  if (req.method === 'HEAD') return false
  if (status < 200 || status >= 300) return false
  if (headerValue(headers, 'content-encoding')) return false
  if (headerValue(headers, 'cache-control')?.toLowerCase().includes('no-transform')) return false
  if (!isCompressibleContentType(headerValue(headers, 'content-type'))) return false
  if (bodyLength !== undefined && bodyLength < MIN_COMPRESS_BYTES) return false
  return preferredEncoding(req) !== null
}

export async function encodeResponseBody(
  req: IncomingMessage,
  status: number,
  headers: HeaderMap,
  body: Buffer | Uint8Array,
): Promise<EncodedBody> {
  const plain = Buffer.isBuffer(body) ? body : Buffer.from(body)
  if (!canCompressResponse(req, status, headers, plain.byteLength)) {
    return { body: plain, headers }
  }

  const encoding = preferredEncoding(req)
  if (!encoding) return { body: plain, headers }

  const compressed = encoding === 'br'
    ? await brotliCompressAsync(plain, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
        },
      })
    : await gzipAsync(plain, { level: 6 })

  if (compressed.byteLength >= plain.byteLength) {
    return { body: plain, headers }
  }

  const encodedHeaders: HeaderMap = { ...headers }
  removeHeader(encodedHeaders, 'content-length')
  encodedHeaders['Content-Encoding'] = encoding
  encodedHeaders['Content-Length'] = String(compressed.byteLength)
  appendVary(encodedHeaders, 'Accept-Encoding')
  return { body: compressed, headers: encodedHeaders }
}

export async function writeEncodedResponseBody(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  headers: HeaderMap,
  body: Buffer | Uint8Array,
): Promise<void> {
  const encoded = await encodeResponseBody(req, status, headers, body)
  res.writeHead(status, encoded.headers)
  res.end(encoded.body)
}
