/**
 * Chat plugin REST routes (declarative).
 *
 * C2: chat CRUD against the store. C3 adds POST /chats/:chatId/messages
 * (send + stream bridge).
 */
import { z } from 'zod'

import { defineRoute } from '@bakin/core/routing'

import { createChat, deleteChat, getChatSummary, listChats, readTranscript } from './store'

const errorResponse = z.object({ error: z.string() }).passthrough()
const passthrough = z.object({}).passthrough()

const chatIdParams = z.object({ chatId: z.string().min(1) })

const createChatBody = z.object({
  agentId: z.string().min(1, 'agentId required'),
  title: z.string().max(200).optional(),
})

export const chatRoutes = [
  defineRoute({
    path: '/chats',
    method: 'GET',
    summary: 'List chats',
    description: 'All chats, newest first. Filter with ?agent=<agentId>.',
    query: z.object({ agent: z.string().optional() }),
    responses: { 200: passthrough },
    handler: async (_req, _ctx, { query }) => {
      return Response.json({ chats: listChats(query.agent) })
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
      return Response.json({ chat, messages: readTranscript(params.chatId) })
    },
  }),

  defineRoute({
    path: '/chats/:chatId',
    method: 'DELETE',
    summary: 'Delete a chat and its transcript',
    params: chatIdParams,
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      const removed = await deleteChat(params.chatId)
      if (!removed) return Response.json({ error: 'chat not found' }, { status: 404 })
      return Response.json({ ok: true })
    },
  }),
]
