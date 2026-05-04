import type { IncomingMessage } from 'http'

export const DEFAULT_MAX_REQUEST_BODY_BYTES = 1024 * 1024

export interface ReadRequestBodyOptions {
  maxBytes?: number
}

export class RequestBodyTooLargeError extends Error {
  readonly code = 'REQUEST_BODY_TOO_LARGE'
  readonly statusCode = 413

  constructor(readonly maxBytes: number) {
    super(`Request body too large; maximum is ${maxBytes} bytes`)
    this.name = 'RequestBodyTooLargeError'
  }
}

export class InvalidJsonBodyError extends Error {
  readonly code = 'INVALID_JSON_BODY'
  readonly statusCode = 400

  constructor() {
    super('Invalid JSON body')
    this.name = 'InvalidJsonBodyError'
  }
}

export function isRequestBodyTooLargeError(err: unknown): err is RequestBodyTooLargeError {
  return err instanceof RequestBodyTooLargeError
}

export function isInvalidJsonBodyError(err: unknown): err is InvalidJsonBodyError {
  return err instanceof InvalidJsonBodyError
}

export function readRequestBody(
  req: IncomingMessage,
  options: ReadRequestBodyOptions = {},
): Promise<Buffer | undefined> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  const declaredLength = parseContentLength(req.headers['content-length'])

  if (declaredLength !== undefined && declaredLength > maxBytes) {
    req.resume?.()
    return Promise.reject(new RequestBodyTooLargeError(maxBytes))
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      req.off?.('data', onData)
      req.off?.('end', onEnd)
      req.off?.('error', onError)
      fn()
    }

    const onData = (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buf.length
      if (total > maxBytes) {
        req.destroy?.()
        finish(() => reject(new RequestBodyTooLargeError(maxBytes)))
        return
      }
      chunks.push(buf)
    }

    const onEnd = () => {
      finish(() => resolve(chunks.length > 0 ? Buffer.concat(chunks, total) : undefined))
    }

    const onError = (err: Error) => {
      finish(() => reject(err))
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

export async function readJsonBody(
  req: IncomingMessage,
  options: ReadRequestBodyOptions = {},
): Promise<unknown> {
  const body = await readRequestBody(req, options)
  if (!body || body.length === 0) return undefined

  try {
    return JSON.parse(body.toString('utf-8'))
  } catch {
    throw new InvalidJsonBodyError()
  }
}

function parseContentLength(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return undefined

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}
