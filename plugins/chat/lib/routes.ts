/**
 * Chat plugin REST routes (declarative).
 *
 * Chat CRUD + send/abort/seen/rename/pin against the store, image
 * attachment upload/serving (chat-owned files — never auto-assets, D7),
 * and the per-agent capability probe the composer gates on.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, extname, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { z } from 'zod'

import { defineRoute } from '@bakin/core/routing'

import {
  attachmentsDir,
  createChat,
  deleteChat,
  getChatSummary,
  listChats,
  markSeen,
  readTranscript,
  setPinned,
  setTitle,
} from './store'
import {
  abortChatTurn,
  clearChatQueue,
  inflightTurnPreview,
  isTurnInFlight,
  listQueuedMessages,
  removeQueuedMessage,
  startChatTurn,
} from './stream-bridge'

/** Upload cap — generous for screenshots; the send path downscales to the 2 MB inline limit. */
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

const errorResponse = z.object({ error: z.string() }).passthrough()
const passthrough = z.object({}).passthrough()

const chatIdParams = z.object({ chatId: z.string().min(1) })

const createChatBody = z.object({
  agentId: z.string().min(1, 'agentId required'),
  title: z.string().max(200).optional(),
})

const attachmentRef = z.object({
  name: z.string().min(1),
  mimeType: z.string().startsWith('image/'),
  path: z.string().min(1),
})

const sendMessageBody = z
  .object({
    content: z.string().max(64_000),
    attachments: z.array(attachmentRef).max(8).optional(),
  })
  .refine((b) => b.content.trim().length > 0 || (b.attachments?.length ?? 0) > 0, {
    message: 'content or attachments required',
  })

export const chatRoutes = [
  defineRoute({
    path: '/chats',
    method: 'GET',
    activityClass: 'routine',
    summary: 'List chats',
    description: 'All chats, newest first. Filter with ?agent=<agentId>.',
    query: z.object({ agent: z.string().optional() }),
    responses: { 200: passthrough },
    handler: async (_req, _ctx, { query }) => {
      // streaming is included so a freshly-loaded client can seed its
      // in-flight indicators without waiting for the next chat.chunk.
      return Response.json({
        chats: listChats(query.agent).map((chat) => ({ ...chat, streaming: isTurnInFlight(chat.id) })),
      })
    },
  }),

  defineRoute({
    path: '/chats',
    method: 'POST',
    summary: 'Create a chat',
    description: 'Creates a chat with an agent. The agent must exist in the runtime roster.',
    body: createChatBody,
    responses: { 201: passthrough, 404: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      const agent = await ctx.runtime.agents.get(body.agentId)
      if (!agent) {
        return Response.json({ error: `unknown agent: ${body.agentId}` }, { status: 404 })
      }
      const chat = await createChat({ agentId: body.agentId, title: body.title })
      return Response.json({ chat }, { status: 201 })
    },
  }),

  defineRoute({
    path: '/chats/:chatId',
    method: 'GET',
    summary: 'Get a chat with its transcript',
    params: chatIdParams,
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      const chat = getChatSummary(params.chatId)
      if (!chat) return Response.json({ error: 'chat not found' }, { status: 404 })
      // Flag first: if the turn settles between the two reads we return
      // streaming:false with no text (honest), never text without the flag.
      const streaming = isTurnInFlight(params.chatId)
      const preview = streaming ? inflightTurnPreview(params.chatId) : null
      return Response.json({
        chat: { ...chat, streaming },
        messages: readTranscript(params.chatId),
        // Pending follow-ups (#729) — clients hydrate their queue strip.
        queued: listQueuedMessages(params.chatId).map(({ id, ts, content, attachments }) => ({
          id, ts, content, ...(attachments?.length ? { attachments } : {}),
        })),
        // Mid-turn rehydration: what the running turn streamed so far, so a
        // remount doesn't show the reply missing its beginning (#706).
        ...(preview !== null ? { streamingText: preview } : {}),
      })
    },
  }),

  defineRoute({
    path: '/chats/:chatId/messages',
    method: 'POST',
    summary: 'Send a message to the chat agent',
    description: 'Returns 202 immediately; the reply streams as chat.chunk SSE events, closed by chat.done or chat.error. One turn runs at a time — a send while a turn streams is QUEUED (202 { queued: true }) and drains as one combined turn when the reply settles (#729).',
    params: chatIdParams,
    body: sendMessageBody,
    responses: { 202: passthrough, 404: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      // NEVER trust a caller-supplied path (a raw startsWith check passed
      // `..` traversal, review finding 2026-07-12): the server re-derives
      // every attachment path from its NAME inside this chat's attachment
      // dir and requires the provided path to match exactly and exist.
      let attachments = body.attachments
      if (attachments?.length) {
        const dir = attachmentsDir(params.chatId)
        const derived = attachments.map((a) => ({
          ...a,
          path: join(dir, basename(a.name)),
        }))
        const invalid = derived.find(
          (a, i) => resolve(attachments![i].path) !== a.path || !existsSync(a.path),
        )
        if (invalid) {
          return Response.json({ error: 'attachment path outside this chat (or not uploaded)' }, { status: 400 })
        }
        attachments = derived
      }
      const result = await startChatTurn(ctx, params.chatId, body.content, attachments, { queueIfBusy: true })
      if (result === 'not_found') return Response.json({ error: 'chat not found' }, { status: 404 })
      if (typeof result === 'object') {
        // The engine captured id/length at push time — never re-read the
        // queue tail here (a concurrent enqueue during the persist await
        // would hand this caller the OTHER send's id; review finding).
        return Response.json(
          { accepted: true, queued: true, queueId: result.queueId, queueLength: result.queueLength },
          { status: 202 },
        )
      }
      return Response.json({ accepted: true, streaming: isTurnInFlight(params.chatId) }, { status: 202 })
    },
  }),

  defineRoute({
    path: '/chats/:chatId/attachments',
    method: 'POST',
    summary: 'Upload an image attachment for this chat',
    description: 'Multipart (field "file", image/* only, ≤25 MB). Stored under the chat — never auto-imported as an asset. Reference the returned attachment in POST /messages.',
    params: chatIdParams,
    responses: { 201: passthrough, 400: errorResponse, 404: errorResponse },
    handler: async (req, _ctx, { params }) => {
      if (!getChatSummary(params.chatId)) return Response.json({ error: 'chat not found' }, { status: 404 })
      let formData: FormData
      try {
        formData = await req.formData()
      } catch {
        return Response.json({ error: 'Invalid multipart form data' }, { status: 400 })
      }
      const value = formData.get('file')
      if (!value || typeof value === 'string') {
        return Response.json({ error: 'No file provided — use the "file" form field' }, { status: 400 })
      }
      const file = value as File
      if (!file.type.startsWith('image/')) {
        return Response.json({ error: `Only image attachments are supported (got ${file.type || 'unknown'})` }, { status: 400 })
      }
      if (file.size === 0) return Response.json({ error: 'File is empty' }, { status: 400 })
      if (file.size > ATTACHMENT_MAX_BYTES) {
        return Response.json({ error: `File too large (${file.size} bytes; limit ${ATTACHMENT_MAX_BYTES})` }, { status: 400 })
      }

      const dir = attachmentsDir(params.chatId)
      mkdirSync(dir, { recursive: true })
      // basename() the client filename (traversal guard), uniquify on collision.
      const clean = basename(file.name || 'image').replace(/[^\w.\- ]+/g, '_') || 'image'
      const name = existsSync(join(dir, clean))
        ? `${randomUUID().slice(0, 8)}-${clean}`
        : clean
      const path = join(dir, name)
      writeFileSync(path, Buffer.from(await file.arrayBuffer()))
      return Response.json({ attachment: { name, mimeType: file.type, path } }, { status: 201 })
    },
  }),

  defineRoute({
    path: '/chats/:chatId/attachments/:name',
    method: 'GET',
    summary: 'Serve a chat attachment',
    params: z.object({ chatId: z.string().min(1), name: z.string().min(1) }),
    responses: { 200: { contentType: 'application/octet-stream' }, 404: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      const name = decodeURIComponent(params.name)
      // Serve only immediate children of the chat's attachment dir.
      if (name !== basename(name)) return Response.json({ error: 'invalid attachment name' }, { status: 400 })
      const path = join(attachmentsDir(params.chatId), name)
      if (!existsSync(path)) return Response.json({ error: 'attachment not found' }, { status: 404 })
      const ext = extname(name).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`
      return new Response(readFileSync(path), { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' } })
    },
  }),

  defineRoute({
    path: '/capabilities',
    method: 'GET',
    summary: 'Capability probe for the composer',
    description: 'Whether the given agent\'s effective model accepts image input (gates the attach affordance).',
    query: z.object({ agent: z.string().min(1) }),
    responses: { 200: passthrough },
    handler: async (_req, ctx, { query }) => {
      try {
        const caps = await ctx.runtime.capabilities({ agentId: query.agent })
        return Response.json({ imageInput: caps.input.imageInput === true })
      } catch {
        // Conservative-false: the affordance hides rather than lying.
        return Response.json({ imageInput: false })
      }
    },
  }),

  defineRoute({
    path: '/chats/:chatId',
    method: 'PATCH',
    summary: 'Rename or pin a chat',
    description: 'title sets a user rename (never overwritten by auto-titling); pinned toggles the pinned group.',
    params: chatIdParams,
    body: z.object({
      title: z.string().min(1).max(200).optional(),
      pinned: z.boolean().optional(),
    }),
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, _ctx, { params, body }) => {
      let chat = getChatSummary(params.chatId)
      if (!chat) return Response.json({ error: 'chat not found' }, { status: 404 })
      if (body.title !== undefined) chat = (await setTitle(params.chatId, body.title, 'user')) ?? chat
      if (body.pinned !== undefined) chat = (await setPinned(params.chatId, body.pinned)) ?? chat
      return Response.json({ chat })
    },
  }),

  defineRoute({
    path: '/chats/:chatId/seen',
    method: 'POST',
    summary: 'Mark a chat as seen',
    description: 'Stamps lastSeenAt and clears the unread count (the client calls this when the chat is visible).',
    params: chatIdParams,
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      const chat = await markSeen(params.chatId)
      if (!chat) return Response.json({ error: 'chat not found' }, { status: 404 })
      return Response.json({ chat })
    },
  }),

  defineRoute({
    path: '/chats/:chatId/abort',
    method: 'POST',
    summary: 'Stop the in-flight reply',
    description: 'Aborts the streaming turn; partial text is kept and the turn settles with an aborted marker. 409 when the chat is idle.',
    params: chatIdParams,
    responses: { 200: passthrough, 404: errorResponse, 409: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      if (!getChatSummary(params.chatId)) return Response.json({ error: 'chat not found' }, { status: 404 })
      const aborted = abortChatTurn(params.chatId)
      if (!aborted) return Response.json({ error: 'no turn in flight' }, { status: 409 })
      return Response.json({ aborted: true })
    },
  }),

  defineRoute({
    path: '/chats/:chatId/queued/:queueId',
    method: 'DELETE',
    summary: 'Remove a queued follow-up message',
    description: 'Removes one pending queued message before it drains. The client may restore its text into an empty composer.',
    params: z.object({ chatId: z.string().min(1), queueId: z.string().min(1) }),
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      if (!getChatSummary(params.chatId)) return Response.json({ error: 'chat not found' }, { status: 404 })
      if (!removeQueuedMessage(params.chatId, params.queueId)) {
        return Response.json({ error: 'queued message not found' }, { status: 404 })
      }
      return Response.json({ removed: true, queueLength: listQueuedMessages(params.chatId).length })
    },
  }),

  defineRoute({
    path: '/chats/:chatId',
    method: 'DELETE',
    summary: 'Delete a chat and its transcript',
    params: chatIdParams,
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      // Abort any in-flight turn FIRST — a deleted chat must never keep
      // billing runtime/image work (the deleted-task incident class) — and
      // clear the queue in the same sync block so the abort settle can
      // never drain it.
      abortChatTurn(params.chatId)
      clearChatQueue(params.chatId)
      const removed = await deleteChat(params.chatId)
      if (!removed) return Response.json({ error: 'chat not found' }, { status: 404 })
      return Response.json({ ok: true })
    },
  }),
]
