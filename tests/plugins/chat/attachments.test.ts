/**
 * Chat attachments (T6.1/T6.2) — multipart upload (image/* only, size cap,
 * sanitized names), serving with traversal guards, delete-chat sweep, and
 * send-through: attachments thread into messaging.stream (downscale-gated)
 * and persist on the user row.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-chat-attach-${Date.now()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    chat: join(testDir, 'chat'),
    logs: join(testDir, 'logs'),
    settings: join(testDir, 'settings.json'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
// Titling gate: never reached in these tests (no first-exchange completes
// with a fallback title), but keep the module mocked so no real gate runs.
mock.module('../../../src/core/dispatch-turns', () => ({
  dispatchPaused: () => false,
  budgetGate: async () => ({ action: 'proceed' }),
}))

import chatPlugin from '../../../plugins/chat'
import { createChat, deleteChat, readTranscript } from '../../../plugins/chat/lib/store'
import { waitForTurn } from '../../../plugins/chat/lib/stream-bridge'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'
import type { ChatChunk, MessageArgs } from '../../../packages/core/src/adapters/runtime/concepts'

let activated: ActivatedPlugin

function pngFile(name: string, bytes = 128): File {
  return new File([Buffer.alloc(bytes, 7)], name, { type: 'image/png' })
}

async function upload(chatId: string, file: File): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = findRoute(activated.routes, 'POST', '/chats/:chatId/attachments')!
  const form = new FormData()
  form.append('file', file)
  return callRoute(route, activated.ctx, { path: `/chats/${chatId}/attachments`, body: form })
}

beforeAll(async () => {
  activated = await activatePlugin(chatPlugin, testDir)
  await activated.ctx.runtime.agents.create({ id: 'main', name: 'Main' })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('attachment upload + serving', () => {
  test('uploads an image, stores it under the chat, serves it back', async () => {
    const chat = await createChat({ agentId: 'main' })
    const res = await upload(chat.id, pngFile('screen shot.png'))
    expect(res.status).toBe(201)
    const attachment = res.body.attachment as { name: string; mimeType: string; path: string }
    expect(attachment.mimeType).toBe('image/png')
    expect(attachment.path).toContain(join('chat', 'attachments', chat.id))
    expect(existsSync(attachment.path)).toBe(true)

    const serve = findRoute(activated.routes, 'GET', '/chats/:chatId/attachments/:name')!
    const served = await callRoute(serve, activated.ctx, {
      path: `/chats/${chat.id}/attachments/${encodeURIComponent(attachment.name)}`,
    })
    expect(served.status).toBe(200)
  })

  test('rejects unsupported mime types and oversized files honestly', async () => {
    const chat = await createChat({ agentId: 'main' })
    const bad = await upload(chat.id, new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    expect(bad.status).toBe(400)

    const big = await upload(chat.id, pngFile('huge.png', 26 * 1024 * 1024))
    expect(big.status).toBe(400)
    expect(String(big.body.error)).toContain('large')
  })

  test('SVG stays rejected — the #669 session-poisoning guard survives the PDF lane', async () => {
    const chat = await createChat({ agentId: 'main' })
    const svg = await upload(chat.id, new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' }))
    expect(svg.status).toBe(400)
  })

  test('accepts a PDF upload and serves it as an opaque download (#742)', async () => {
    const chat = await createChat({ agentId: 'main' })
    const res = await upload(chat.id, new File(['%PDF-1.4 tiny'], 'report.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(201)
    const attachment = res.body.attachment as { name: string; mimeType: string; path: string }
    expect(attachment.mimeType).toBe('application/pdf')
    expect(existsSync(attachment.path)).toBe(true)

    const serve = findRoute(activated.routes, 'GET', '/chats/:chatId/attachments/:name')!
    const served = await callRoute(serve, activated.ctx, {
      path: `/chats/${chat.id}/attachments/${encodeURIComponent(attachment.name)}`,
    })
    expect(served.status).toBe(200)
    expect(served.response.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(served.response.headers.get('Content-Disposition')).toContain('attachment')
  })

  test('serving guards against traversal names', async () => {
    const chat = await createChat({ agentId: 'main' })
    const serve = findRoute(activated.routes, 'GET', '/chats/:chatId/attachments/:name')!
    const sneaky = await callRoute(serve, activated.ctx, {
      path: `/chats/${chat.id}/attachments/${encodeURIComponent('../../index.json')}`,
    })
    expect([400, 404]).toContain(sneaky.status)
  })

  test('deleting the chat sweeps its attachments', async () => {
    const chat = await createChat({ agentId: 'main' })
    const res = await upload(chat.id, pngFile('gone.png'))
    const attachment = res.body.attachment as { path: string }
    expect(existsSync(attachment.path)).toBe(true)
    await deleteChat(chat.id)
    expect(existsSync(attachment.path)).toBe(false)
  })
})

describe('attachment send-through', () => {
  test('a crafted traversal path in the send body is rejected (server re-derives from name)', async () => {
    const chat = await createChat({ agentId: 'main' })
    const send = findRoute(activated.routes, 'POST', '/chats/:chatId/messages')!
    const dir = join(testDir, 'chat', 'attachments', chat.id)
    // Un-normalized startsWith passed this before the 2026-07-12 review.
    const sneaky = await callRoute(send, activated.ctx, {
      path: `/chats/${chat.id}/messages`,
      body: {
        content: 'read this',
        attachments: [{ name: 'x.png', mimeType: 'image/png', path: `${dir}/../../../../index.json` }],
      },
    })
    expect(sneaky.status).toBe(400)
    // A legit name whose path doesn't match the derived location also fails.
    const mismatched = await callRoute(send, activated.ctx, {
      path: `/chats/${chat.id}/messages`,
      body: {
        content: 'read this',
        attachments: [{ name: 'not-uploaded.png', mimeType: 'image/png', path: join(dir, 'not-uploaded.png') }],
      },
    })
    expect(mismatched.status).toBe(400) // exists check: never send phantom files
  })

  test('send with attachments threads them into messaging.stream and persists on the user row', async () => {
    const chat = await createChat({ agentId: 'main' })
    const uploaded = (await upload(chat.id, pngFile('ref.png'))).body.attachment as {
      name: string
      mimeType: string
      path: string
    }

    const seen: MessageArgs[] = []
    activated.ctx.runtime.messaging.stream = ((args: MessageArgs) => {
      seen.push(args)
      return (async function* () {
        yield { type: 'text', content: 'I see it.' } as ChatChunk
        yield { type: 'done' } as ChatChunk
      })()
    }) as typeof activated.ctx.runtime.messaging.stream

    const send = findRoute(activated.routes, 'POST', '/chats/:chatId/messages')!
    const res = await callRoute(send, activated.ctx, {
      path: `/chats/${chat.id}/messages`,
      body: { content: 'look at this', attachments: [uploaded] },
    })
    expect(res.status).toBe(202)
    await waitForTurn(chat.id)

    expect(seen[0]?.attachments).toEqual([{ path: uploaded.path, mimeType: 'image/png' }])
    const rows = readTranscript(chat.id)
    const user = rows.find((r) => r.kind === 'user')
    if (user?.kind !== 'user') throw new Error('expected user row')
    expect(user.attachments).toEqual([uploaded])
  })

  test('GET /capabilities reports imageInput per agent', async () => {
    const route = findRoute(activated.routes, 'GET', '/capabilities')!
    const res = await callRoute(route, activated.ctx, { searchParams: { agent: 'main' } })
    expect(res.status).toBe(200)
    expect(typeof res.body.imageInput).toBe('boolean')
  })
})
