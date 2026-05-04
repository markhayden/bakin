import { describe, expect, it } from 'bun:test'
import { PassThrough } from 'stream'
import type { IncomingMessage } from 'http'
import { readRequestBody } from '../../src/core/request-body'

function streamReq(): IncomingMessage {
  const stream = new PassThrough()
  const req = stream as unknown as IncomingMessage
  req.headers = {}
  return req
}

describe('request body reader', () => {
  it('rejects streamed bodies that exceed the limit without a content-length header', async () => {
    const req = streamReq()
    const body = readRequestBody(req, { maxBytes: 4 })

    req.emit('data', Buffer.from('abc'))
    req.emit('data', Buffer.from('de'))

    await expect(body).rejects.toThrow('Request body too large')
  })
})
