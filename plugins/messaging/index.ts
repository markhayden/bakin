/**
 * Messaging plugin — server entry point.
 * Manages content pipeline: draft → scheduled → executing → waiting → review → published
 */
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/sdk/types'
import { createMessagingStorage } from './lib/storage'
import type { MessagingStorage } from './lib/storage'
import type { CalendarItem, ContentStatus, ProposalStatus, MessagingSettings } from './types'
import { DEFAULT_CHANNEL, DEFAULT_CONTENT_TYPES } from './types'
import { createMessagingSessionStore } from './lib/sessions'
import { buildMessages } from './lib/prompt-builder'
import {
  buildDoc as buildBrainstormDoc,
  sessionKey,
  SESSION_FILE_PATTERN,
} from './lib/brainstorm-search'
import type { PlanningSession } from './types'

const log = {
  info: (...args: unknown[]) => console.info('[messaging]', ...args),
  warn: (...args: unknown[]) => console.warn('[messaging]', ...args),
  error: (...args: unknown[]) => console.error('[messaging]', ...args),
}

let activeMessagingStorage: MessagingStorage | null = null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function readBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>
}

function normalizeChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return [DEFAULT_CHANNEL]
  const channels = value
    .filter((channel): channel is string => typeof channel === 'string')
    .map(channel => channel.trim())
    .filter(Boolean)
  return channels.length > 0 ? channels : [DEFAULT_CHANNEL]
}

interface AgentMetaLike { id: string; name?: string }

const AGENT_ID_SHAPE = /^[a-z0-9-]+$/

interface RuntimeChatOpts {
  agentId: string
  messages: Array<{ role: string; content: string }>
  sessionKey?: string
  signal?: AbortSignal
  model?: string
  maxTokens?: number
}

function flattenChatMessages(messages: Array<{ role: string; content: string }>): string {
  if (messages.length === 1) return messages[0].content
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n')
}

async function sendRuntimeChatCompletion(ctx: PluginContext, opts: RuntimeChatOpts): Promise<string> {
  void opts.signal
  const result = await ctx.runtime.messaging.send({
    agentId: opts.agentId,
    content: flattenChatMessages(opts.messages),
    threadId: opts.sessionKey,
    metadata: { model: opts.model, maxTokens: opts.maxTokens },
  })
  return result.content ?? ''
}

async function streamRuntimeChatCompletion(ctx: PluginContext, opts: RuntimeChatOpts): Promise<Response> {
  void opts.signal
  const chunks = ctx.runtime.messaging.stream({
    agentId: opts.agentId,
    content: flattenChatMessages(opts.messages),
    threadId: opts.sessionKey,
    metadata: { model: opts.model, maxTokens: opts.maxTokens },
  })
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const chunk of chunks) {
          if (chunk.type === 'text' && chunk.content) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk.content } }] })}\n\n`))
          } else if (chunk.type === 'error') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: chunk.content ?? 'Runtime stream error' })}\n\n`))
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/**
 * Validates an agentId against a strict shape allowlist + live team roster.
 *
 * - Shape guard (load-bearing): blocks path traversal. A regex-valid id
 *   cannot escape `~/.bakin/team/personas/`.
 * - Roster check (defense-in-depth): filters orphan references — shape-valid
 *   ids that aren't in the current runtime roster. Best-effort: when the
 *   team plugin is unavailable or the hook throws, the shape guard alone
 *   suffices and messaging stays functional.
 */
async function validateAgentId(ctx: PluginContext, agentId: string): Promise<boolean> {
  if (!agentId || !AGENT_ID_SHAPE.test(agentId)) return false
  try {
    const knownIds = await ctx.hooks.invoke<string[]>('team.getAgentIds', {})
    if (Array.isArray(knownIds) && knownIds.length > 0 && !knownIds.includes(agentId)) {
      return false
    }
  } catch (err) {
    log.warn('team.getAgentIds hook failed during validation; relying on shape guard', {
      agentId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
  return true
}

/**
 * Resolve the prompt-builder options for a given agent. Pulls the display
 * name from the team plugin, the content-type taxonomy from this plugin's
 * settings, and the persona markdown from disk — but only after the agentId
 * clears `validateAgentId`. Invalid ids return an empty persona; callers
 * that care about the distinction should gate with validateAgentId directly.
 */
async function resolvePromptOptions(ctx: PluginContext, agentId: string) {
  const valid = await validateAgentId(ctx, agentId)
  let persona = ''
  if (valid) {
    try {
      const profile = await ctx.hooks.invoke<{ soul?: string } | null>('team.resolveProfile', { id: agentId })
      persona = profile?.soul ?? ''
    } catch (err) {
      log.warn('team.resolveProfile hook failed during persona lookup', { agentId, err: err instanceof Error ? err.message : String(err) })
    }
  }

  let agentName: string | undefined
  try {
    const agent = await ctx.hooks.invoke<AgentMetaLike | null>('team.getAgent', { id: agentId })
    agentName = agent?.name
  } catch (err) {
    log.warn('team.getAgent hook failed; falling back to raw agentId', { agentId, err: err instanceof Error ? err.message : String(err) })
  }

  const settings = ctx.getSettings<MessagingSettings>()
  const contentTypes = settings.contentTypes ?? DEFAULT_CONTENT_TYPES
  return { agentName, contentTypes, persona }
}

// ---------------------------------------------------------------------------
// Approve logic (shared by route + exec tool)
// ---------------------------------------------------------------------------

async function approveItem(
  item: CalendarItem,
  ctx: PluginContext,
  messaging: MessagingStorage,
): Promise<{ item: CalendarItem; newStatus: ContentStatus } | { error: string; status: number }> {
  let newStatus: ContentStatus
  if (item.status === 'draft') {
    newStatus = 'scheduled'
  } else if (item.status === 'review') {
    newStatus = 'published'

    // Post through the active runtime channel adapter.
    try {
      const caption = item.draft?.caption || item.title
      const channels = normalizeChannels(item.channels)

      let media = null as Awaited<ReturnType<PluginContext['assets']['fileRef']>> | null
      const mediaFilename = item.draft?.imageFilename || item.draft?.videoFilename
      if (mediaFilename) {
        try {
          media = await ctx.assets.fileRef(mediaFilename)
        } catch (err) {
          log.warn('Asset reference unavailable on approve', { itemId: item.id, filename: mediaFilename, err: err instanceof Error ? err.message : String(err) })
        }
      }

      if (media) {
        await ctx.runtime.channels.deliverContent({
          channels,
          content: {
            title: item.title,
            body: caption,
            files: [media],
          },
        })
      } else {
        await ctx.runtime.channels.sendMessage({
          channels,
          message: {
            body: caption,
          },
        })
      }
    } catch (err) {
      log.error('Channel post failed', err)
    }
  } else {
    return { error: `Cannot approve item in status: ${item.status}`, status: 400 }
  }

  const updated = messaging.updateItem(item.id, {
    status: newStatus,
    ...(newStatus === 'published' ? { publishedAt: new Date().toISOString() } : {}),
  })

  ctx.activity.audit('item.approved', 'system', { itemId: item.id, from: item.status, to: newStatus })
  ctx.activity.log('system', `Messaging item "${item.title}" approved → ${newStatus}`)
  return { item: updated, newStatus }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const messagingPlugin: BakinPlugin = {
  id: 'messaging',
  name: 'Messaging',
  version: '2.0.0',

  settingsSchema: {
    fields: [
      { key: 'defaultView', type: 'select', label: 'Default view', description: 'Default messaging view on page load', options: [{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'list', label: 'List' }], default: 'month' },
      { key: 'showScheduleJobs', type: 'boolean', label: 'Show schedule jobs', description: 'Display recurring schedule jobs on the content calendar', default: false },
      { key: 'channels', type: 'string', label: 'Channels', description: 'Comma-separated runtime channel IDs available for distribution (e.g., general,announcements,email)', default: DEFAULT_CHANNEL },
      {
        key: 'contentTypes',
        type: 'list',
        label: 'Content types',
        description: 'Categories used across the content calendar and brainstorm proposals.',
        addLabel: 'Add content type',
        minItems: 1,
        uniqueField: 'id',
        itemShape: {
          id:    { key: 'id',    type: 'string', label: 'ID',    description: 'Machine id — lowercase, no spaces (e.g. "blog-post").', required: true },
          label: { key: 'label', type: 'string', label: 'Label', description: 'Display name shown in menus.',                           required: true },
        },
      },
    ],
  },

  navItems: [
    { id: 'messaging', label: 'Messaging', icon: 'MessageSquare', href: '/messaging', order: 25 },
  ],

  contentFiles: [],

  activate(ctx: PluginContext) {
    const messaging = createMessagingStorage(ctx.storage)
    activeMessagingStorage = messaging
    const sessions = createMessagingSessionStore(ctx.storage, messaging)
    const {
      loadMessagingItems,
      createItem,
      updateItem,
      deleteItem,
      getItem,
    } = messaging
    const {
      createSession,
      loadSession,
      saveSession,
      listSessions,
      updateSession: updateSessionFn,
      deleteSession: deleteSessionFn,
      appendMessage,
      upsertProposals,
      updateProposal,
      confirmSession,
    } = sessions

    // ── Seed default content types on first activate ──────────────────
    const currentSettings = ctx.getSettings<MessagingSettings>()
    if (!currentSettings.contentTypes || currentSettings.contentTypes.length === 0) {
      ctx.updateSettings({ contentTypes: DEFAULT_CONTENT_TYPES })
      log.info(`Seeded ${DEFAULT_CONTENT_TYPES.length} default content types`)
    }

    // ── Search Content Type Registration ─────────────────────────────
    // Per spec §5.1d, ONLY brainstorm sessions get indexed search; calendar
    // items get a local substring filter in a later commit. No TTL — spec
    // does not mandate one and this is a dev machine with tens of sessions.
    const sessionFilePattern = ctx.storage.searchPath?.(SESSION_FILE_PATTERN) ?? SESSION_FILE_PATTERN
    ctx.search.registerFileBackedContentType({
      table: 'messaging_brainstorm',
      schema: {
        session_id: { type: 'keyword' },
        title: { type: 'text' },
        status: { type: 'keyword' },
        agent_id: { type: 'keyword' },
        message_body: { type: 'text' },
        proposal_summaries: { type: 'text' },
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['title', 'message_body', 'proposal_summaries'],
      rerankField: 'message_body',
      embeddingTemplate: '{{title}} — {{message_body}} — {{proposal_summaries}}',
      facets: ['status', 'agent_id'],
      filePatterns: [
        {
          pattern: sessionFilePattern,
          fileToId: (rel) => {
            const id = rel.split('/').pop()?.replace(/\.json$/, '') ?? ''
            return id ? sessionKey(id) : null
          },
          fileToDoc: async (_rel, content) => {
            try {
              const parsed = JSON.parse(content) as PlanningSession
              if (!parsed || typeof parsed.id !== 'string') return null
              if (!Array.isArray(parsed.messages)) parsed.messages = []
              if (!Array.isArray(parsed.proposals)) parsed.proposals = []
              return buildBrainstormDoc(parsed)
            } catch {
              return null
            }
          },
        },
      ],
      reindex: async function* () {
        for (const file of (ctx.storage.list?.('messaging/sessions') ?? []).filter(f => f.endsWith('.json'))) {
          const id = file.replace(/\.json$/, '')
          const session = loadSession(id)
          if (session) {
            yield { key: sessionKey(session.id), doc: buildBrainstormDoc(session) }
          }
        }
      },
      verifyExists: async (key: string) => {
        if (!key.startsWith('brainstorm-')) return false
        const id = key.slice('brainstorm-'.length)
        return ctx.storage.exists(`messaging/sessions/${id}.json`)
      },
    })

    // ── API Routes ─────────────────────────────────────────────────────

    // GET / — list items (optional ?month=YYYY-MM&channel=general filter)
    const listHandler = async (req: Request) => {
      const url = new URL(req.url)
      const month = url.searchParams.get('month')
      const channel = url.searchParams.get('channel')
      let items = loadMessagingItems()
      if (month) items = items.filter(i => i.scheduledAt.startsWith(month))
      if (channel) items = items.filter(i => i.channels.includes(channel))
      items.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
      return json({ items })
    }
    ctx.registerRoute({ path: '/', method: 'GET', description: 'List messaging items', handler: listHandler })

    // GET /:itemId — get single item
    const getHandler = async (req: Request) => {
      const url = new URL(req.url)
      const id = url.searchParams.get('itemId')
      if (!id) return json({ error: 'itemId required' }, 400)
      const item = getItem(id)
      if (!item) return json({ error: 'Item not found' }, 404)
      return json({ item })
    }
    ctx.registerRoute({ path: '/:itemId', method: 'GET', description: 'Get single messaging item', handler: getHandler })

    // POST / — create item
    const createHandler = async (req: Request) => {
      const body = await readBody<Record<string, unknown>>(req)
      const { title, agent, contentType, tone, scheduledAt, brief, status, channels } = body as Record<string, unknown>

      if (!title || !agent || !scheduledAt) {
        return json({ error: 'title, agent, and scheduledAt required' }, 400)
      }

      const resolvedChannels = normalizeChannels(channels)
      const item = createItem({
        title: title as string,
        agent: (agent as string) as CalendarItem['agent'],
        contentType: ((contentType as string) || 'post') as CalendarItem['contentType'],
        tone: ((tone as string) || 'conversational') as CalendarItem['tone'],
        scheduledAt: scheduledAt as string,
        brief: (brief as string) || '',
        status: ((status as string) as ContentStatus) || 'draft',
        channels: resolvedChannels,
      })

      ctx.activity.audit('item.created', agent as string, { itemId: item.id, title })
      ctx.activity.log(agent as string, `Created messaging item "${title}"`)
      return json({ ok: true, item })
    }
    ctx.registerRoute({ path: '/', method: 'POST', description: 'Create messaging item', handler: createHandler })

    // PUT /:itemId — update item
    const updateHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<Record<string, unknown>>(req)
      const id = url.searchParams.get('itemId') || (body.id as string)

      if (!id) return json({ error: 'id required' }, 400)

      try {
        const item = updateItem(id, body as Partial<CalendarItem>)
        ctx.activity.audit('item.updated', 'system')
        ctx.activity.log('system', `Updated messaging item "${item.title}"`)
        return json({ ok: true, item })
      } catch (e: unknown) {
        return json({ error: (e as Error).message || String(e) }, 404)
      }
    }
    ctx.registerRoute({ path: '/:itemId', method: 'PUT', description: 'Update messaging item', handler: updateHandler })

    // DELETE /:itemId — delete item
    const deleteHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<{ id?: string }>(req).catch(() => ({} as { id?: string }))
      const id = url.searchParams.get('itemId') || body.id

      if (!id) return json({ error: 'id required' }, 400)

      deleteItem(id)
      ctx.activity.audit('item.deleted', 'system', { itemId: id })
      ctx.activity.log('system', `Deleted messaging item ${id}`)
      return json({ ok: true })
    }
    ctx.registerRoute({ path: '/:itemId', method: 'DELETE', description: 'Delete messaging item', handler: deleteHandler })

    // POST /:itemId/approve — approve item
    const approveHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<{ id?: string }>(req).catch(() => ({} as { id?: string }))
      const id = url.searchParams.get('itemId') || body.id

      if (!id) return json({ error: 'id required' }, 400)

      const item = getItem(id)
      if (!item) return json({ error: 'Item not found' }, 404)

      const result = await approveItem(item, ctx, messaging)
      if ('error' in result) return json({ error: result.error }, result.status)
      return json({ ok: true, item: result.item })
    }
    ctx.registerRoute({ path: '/:itemId/approve', method: 'POST', description: 'Approve messaging item', handler: approveHandler })

    // POST /:itemId/unapprove — revert scheduled item back to draft
    const unapproveHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<{ id?: string }>(req).catch(() => ({} as { id?: string }))
      const id = url.searchParams.get('itemId') || body.id

      if (!id) return json({ error: 'id required' }, 400)

      const item = getItem(id)
      if (!item) return json({ error: 'Item not found' }, 404)

      if (item.status !== 'scheduled') {
        return json({ error: `Can only unapprove items in scheduled status (got: ${item.status})` }, 400)
      }

      const updated = updateItem(id, { status: 'draft' })
      ctx.activity.audit('item.unapproved', 'system', { itemId: id, from: 'scheduled', to: 'draft' })
      ctx.activity.log('system', `Messaging item "${item.title}" unapproved → draft`)
      return json({ ok: true, item: updated })
    }
    ctx.registerRoute({ path: '/:itemId/unapprove', method: 'POST', description: 'Unapprove messaging item', handler: unapproveHandler })

    // POST /:itemId/reject — reject item back to draft
    const rejectHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<{ id?: string; note?: string }>(req)
      const id = url.searchParams.get('itemId') || body.id

      if (!id) return json({ error: 'id required' }, 400)

      const item = getItem(id)
      if (!item) return json({ error: 'Item not found' }, 404)

      if (item.status !== 'review') {
        return json({ error: 'Can only reject items in review status' }, 400)
      }

      const updated = updateItem(id, {
        status: 'draft',
        rejectionNote: body.note || undefined,
      })

      ctx.activity.audit('item.rejected', 'system', { itemId: id, note: body.note })
      ctx.activity.log('system', `Messaging item "${item.title}" rejected → draft`)
      return json({ ok: true, item: updated })
    }
    ctx.registerRoute({ path: '/:itemId/reject', method: 'POST', description: 'Reject messaging item', handler: rejectHandler })

    // POST /brainstorm — AI brainstorming (unchanged)
    ctx.registerRoute({
      path: '/brainstorm',
      method: 'POST',
      handler: async (req: Request) => {
        const body = await readBody<{
          agentId: string
          message: string
          history: { role: string; content: string }[]
        }>(req)

        if (!body.agentId || !body.message) {
          return json({ error: 'agentId and message required' }, 400)
        }
        if (!(await validateAgentId(ctx, body.agentId))) {
          return json({ error: 'invalid agentId' }, 400)
        }

        try {
          const { agentName: resolvedName, contentTypes: brainstormTypes, persona } = await resolvePromptOptions(ctx, body.agentId)
          const agentName = resolvedName || body.agentId
          const typeList = brainstormTypes.map(t => t.id).join(', ')

          const historyContext = (body.history || []).map(h =>
            `${h.role === 'user' ? 'Mark' : agentName}: ${h.content}`
          ).join('\n\n')

          const fullPrompt = `You are ${agentName}. Here is your persona:

${persona}

---

You are brainstorming content messaging ideas with Mark. When he describes what he's looking for, suggest 3-5 concrete messaging items in your authentic voice.

For each suggestion provide:
- title: catchy post title in your voice
- scheduledAt: suggested date+time ISO string (timezone: America/Denver, MDT = UTC-6)
- contentType: one of ${typeList}
- tone: one of energetic, calm, educational, humorous, inspiring, conversational
- brief: 2-3 sentence description of what to create when this executes

Format: conversational response in your voice, then a JSON block:
\`\`\`json
[{ "title": "...", "scheduledAt": "...", "contentType": "...", "tone": "...", "brief": "..." }]
\`\`\`

${historyContext ? `Conversation so far:\n${historyContext}\n\n` : ''}Mark says: ${body.message}`

          const sessionKey = `brainstorm-${body.agentId}-${Date.now()}`
          const content = await sendRuntimeChatCompletion(ctx, {
            agentId: body.agentId,
            sessionKey,
            messages: [{ role: 'user', content: fullPrompt }],
          })

          let suggestions: Array<{
            title: string
            scheduledAt: string
            contentType: string
            tone: string
            brief: string
          }> = []

          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)
          if (jsonMatch) {
            try {
              suggestions = JSON.parse(jsonMatch[1])
            } catch { /* ignore */ }
          }

          return json({
            response: content.replace(/```json[\s\S]*?```/g, '').trim(),
            suggestions,
          })
        } catch (err) {
          log.error('Brainstorm error', err)
          return json({ error: err instanceof Error ? err.message : String(err) }, 500)
        }
      },
    })

    // ── Session Routes ──────────────────────────────────────────────────

    // GET /sessions — list planning sessions
    ctx.registerRoute({
      path: '/sessions',
      method: 'GET',
      description: 'List planning sessions',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const status = url.searchParams.get('status') || undefined
        const agentId = url.searchParams.get('agentId') || undefined
        const sessions = listSessions({ status, agentId })
        return json({ sessions })
      },
    })

    // GET /sessions/:id — get full session
    ctx.registerRoute({
      path: '/sessions/:id',
      method: 'GET',
      description: 'Get a planning session',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const id = url.searchParams.get('id')
        if (!id) return json({ error: 'id required' }, 400)
        const session = loadSession(id)
        if (!session) return json({ error: 'Session not found' }, 404)
        return json({ session })
      },
    })

    // POST /sessions — create session
    ctx.registerRoute({
      path: '/sessions',
      method: 'POST',
      description: 'Create a planning session',
      handler: async (req: Request) => {
        const body = await readBody<{ agentId?: string; title?: string }>(req)
        if (!body.agentId) return json({ error: 'agentId required' }, 400)
        const session = createSession({ agentId: body.agentId, title: body.title })
        ctx.activity.audit('session.created', body.agentId, { sessionId: session.id })
        ctx.activity.log(body.agentId, `Created planning session "${session.title}"`)
        return json({ ok: true, session })
      },
    })

    // PUT /sessions/:id — update session metadata
    ctx.registerRoute({
      path: '/sessions/:id',
      method: 'PUT',
      description: 'Update a planning session',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await readBody<{ id?: string; title?: string; status?: 'active' | 'completed' }>(req)
        const id = url.searchParams.get('id') || body.id
        if (!id) return json({ error: 'id required' }, 400)
        try {
          const session = updateSessionFn(id, { title: body.title, status: body.status })
          return json({ ok: true, session })
        } catch (e: unknown) {
          return json({ error: (e as Error).message }, 404)
        }
      },
    })

    // DELETE /sessions/:id — delete session
    ctx.registerRoute({
      path: '/sessions/:id',
      method: 'DELETE',
      description: 'Delete a planning session',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await readBody<{ id?: string }>(req).catch(() => ({} as { id?: string }))
        const id = url.searchParams.get('id') || body.id
        if (!id) return json({ error: 'id required' }, 400)
        try {
          deleteSessionFn(id)
          ctx.activity.audit('session.deleted', 'system', { sessionId: id })
          ctx.activity.log('system', `Deleted planning session ${id}`)
          return json({ ok: true })
        } catch (e: unknown) {
          return json({ error: (e as Error).message }, 404)
        }
      },
    })

    // POST /sessions/:id/messages — send message with SSE streaming
    ctx.registerRoute({
      path: '/sessions/:id/messages',
      method: 'POST',
      description: 'Send a message in a planning session (SSE streaming)',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await readBody<{ id?: string; message?: string }>(req)
        const id = url.searchParams.get('id') || body.id
        if (!id) return json({ error: 'id required' }, 400)
        if (!body.message) return json({ error: 'message required' }, 400)

        const session = loadSession(id)
        if (!session) return json({ error: 'Session not found' }, 404)
        if (session.status === 'completed') return json({ error: 'Session is completed' }, 400)

        // Append user message
        appendMessage(id, { role: 'user', content: body.message })

        // Build messages array with full session history
        const promptOptions = await resolvePromptOptions(ctx, session.agentId)
        const messages = buildMessages(session, body.message, promptOptions)
        const sessionKey = `session-${id}-${Date.now()}`

        // Create a ReadableStream that pipes runtime SSE to the client
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder()

            function send(event: string, data: unknown): void {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            }

            try {
              let fullContent = ''
              // Track proposals emitted incrementally during streaming
              const streamedProposalIds: string[] = []
              const sessionId = id as string // narrowed by early return above

              /**
               * Check fullContent for newly completed ```json blocks.
               * Parse and upsert each one, emit SSE event immediately.
               * Uses a temp message ID during streaming; patched to real ID after.
               */
              function checkForCompletedBlocks(): void {
                // Find all complete ```json...``` blocks we haven't processed yet
                const processed = streamedProposalIds.length
                const blockRegex = /```json\s*\n([\s\S]*?)```/g
                let match: RegExpExecArray | null
                let blockIndex = 0
                while ((match = blockRegex.exec(fullContent)) !== null) {
                  if (blockIndex < processed) { blockIndex++; continue }
                  try {
                    const parsed = JSON.parse(match[1].trim())
                    const items = Array.isArray(parsed) ? parsed : [parsed]
                    const saved = upsertProposals(sessionId, `streaming-${Date.now()}`, items)
                    for (const p of saved) {
                      streamedProposalIds.push(p.id)
                      send('proposal', { proposal: p })
                    }
                  } catch {
                    // JSON not valid yet or malformed — skip
                  }
                  blockIndex++
                }
              }

              // Try streaming first, fall back to non-streaming
              let useStreaming = true
              let gwResponse: Response | null = null

              try {
                gwResponse = await streamRuntimeChatCompletion(ctx, {
                  messages,
                  agentId: session.agentId,
                  sessionKey,
                })

                const contentType = gwResponse.headers.get('content-type') || ''
                if (!contentType.includes('text/event-stream')) {
                  // Runtime returned non-streaming response
                  useStreaming = false
                }
              } catch {
                // Runtime doesn't support streaming — fall back
                useStreaming = false
                gwResponse = null
              }

              if (useStreaming && gwResponse?.body) {
                // Stream runtime SSE chunks to client
                const reader = gwResponse.body.getReader()
                const decoder = new TextDecoder()
                let buffer = ''

                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break

                  buffer += decoder.decode(value, { stream: true })
                  const lines = buffer.split('\n')
                  buffer = lines.pop() || ''

                  for (const line of lines) {
                    if (!line.startsWith('data: ')) continue
                    const data = line.slice(6).trim()
                    if (data === '[DONE]') continue

                    try {
                      const parsed = JSON.parse(data)
                      const token = parsed.choices?.[0]?.delta?.content
                      if (token) {
                        fullContent += token
                        send('token', { text: token })
                        // Check if a ```json block just completed
                        if (token.includes('`')) {
                          checkForCompletedBlocks()
                        }
                      }
                    } catch {
                      // Skip malformed chunks
                    }
                  }
                }
              } else {
                // Non-streaming fallback
                try {
                  fullContent = await sendRuntimeChatCompletion(ctx, {
                    messages,
                    agentId: session.agentId,
                    sessionKey,
                  })
                  // Send entire response as a single token event
                  send('token', { text: fullContent })
                } catch (err) {
                  send('error', { message: err instanceof Error ? err.message : String(err) })
                  controller.close()
                  return
                }
              }

              // Final pass: pick up any remaining ```json blocks not caught during streaming
              checkForCompletedBlocks()

              // Also handle legacy array format (single block with [...])
              if (streamedProposalIds.length === 0) {
                const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/)
                if (jsonMatch) {
                  try {
                    const parsed = JSON.parse(jsonMatch[1].trim())
                    const items = Array.isArray(parsed) ? parsed : [parsed]
                    const saved = upsertProposals(sessionId, `final-${Date.now()}`, items)
                    for (const p of saved) {
                      streamedProposalIds.push(p.id)
                      send('proposal', { proposal: p })
                    }
                  } catch { /* ignore malformed JSON */ }
                }
              }

              // Split content at JSON block boundaries into separate messages
              // e.g. "intro text ```json...``` day one text ```json...``` closing"
              // becomes 3 messages: "intro text", "day one text", "closing"
              const segments = fullContent
                .split(/```json[\s\S]*?```/)
                .map(s => s.trim())
                .filter(s => s.length > 0)

              const messageIds: string[] = []
              for (const segment of segments) {
                const msg = appendMessage(sessionId, {
                  role: 'assistant',
                  content: segment,
                })
                messageIds.push(msg.id)
              }

              // If no text segments (pure JSON response), save a placeholder
              if (messageIds.length === 0) {
                const msg = appendMessage(sessionId, {
                  role: 'assistant',
                  content: '',
                }, streamedProposalIds)
                messageIds.push(msg.id)
              }

              // Link proposals to the first message and patch messageIds on proposals
              if (streamedProposalIds.length > 0) {
                const reloadedSession = loadSession(sessionId)
                if (reloadedSession) {
                  // Attach proposalIds to the first assistant message
                  const firstMsg = reloadedSession.messages.find(m => m.id === messageIds[0])
                  if (firstMsg) firstMsg.proposalIds = streamedProposalIds

                  // Patch proposal messageIds to real assistant message
                  for (const p of reloadedSession.proposals) {
                    if (streamedProposalIds.includes(p.id)) {
                      p.messageId = messageIds[0]
                    }
                  }
                  saveSession(reloadedSession)
                }
              }

              send('done', {
                messageId: messageIds[0],
                content: segments.join('\n\n'),
                segments: segments.map((content, i) => ({
                  id: messageIds[i],
                  content,
                })),
              })
            } catch (err) {
              send('error', { message: err instanceof Error ? err.message : String(err) })
            } finally {
              controller.close()
            }
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      },
    })

    // PUT /sessions/:id/proposals/:proposalId — update proposal
    ctx.registerRoute({
      path: '/sessions/:id/proposals/:proposalId',
      method: 'PUT',
      description: 'Update a proposal in a planning session',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await readBody<Record<string, unknown>>(req)
        const sessionId = url.searchParams.get('id')
        const proposalId = url.searchParams.get('proposalId')
        if (!sessionId || !proposalId) return json({ error: 'sessionId and proposalId required' }, 400)
        try {
          const proposal = updateProposal(sessionId, proposalId, {
            status: body.status as ProposalStatus | undefined,
            title: body.title as string | undefined,
            brief: body.brief as string | undefined,
            tone: body.tone as string | undefined,
            scheduledAt: body.scheduledAt as string | undefined,
            channels: body.channels as string[] | undefined,
            rejectionNote: body.rejectionNote as string | undefined,
          })
          return json({ ok: true, proposal })
        } catch (e: unknown) {
          return json({ error: (e as Error).message }, 404)
        }
      },
    })

    // POST /sessions/:id/confirm — confirm plan
    ctx.registerRoute({
      path: '/sessions/:id/confirm',
      method: 'POST',
      description: 'Confirm plan and create messaging items',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await readBody<{ id?: string; autoApprove?: boolean }>(req).catch(() => ({} as { id?: string; autoApprove?: boolean }))
        const id = url.searchParams.get('id') || body.id
        if (!id) return json({ error: 'id required' }, 400)
        try {
          const result = confirmSession(id, { autoApprove: !!body.autoApprove })
          ctx.activity.audit('session.confirmed', 'system', { sessionId: id, itemsCreated: result.itemsCreated, autoApprove: !!body.autoApprove })
          ctx.activity.log('system', `Confirmed planning session — ${result.itemsCreated} items created (${body.autoApprove ? 'scheduled' : 'draft'})`)
          return json({ ok: true, ...result })
        } catch (e: unknown) {
          return json({ error: (e as Error).message }, 400)
        }
      },
    })

    // ── Exec Tools (agent-facing) ─────────────────────────────────────

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_list',
      label: 'Listed messages',
      description: 'List messaging items with optional filters',
      parameters: {
        month: z.string().optional().describe('Filter by month (YYYY-MM)'),
        status: z.string().optional().describe('Filter by status (draft, scheduled, review, published, etc.)'),
        agent: z.string().optional().describe('Filter by assigned agent'),
        channel: z.string().optional().describe('Filter by runtime channel ID (e.g. general, announcements)'),
      },
      handler: async (params: Record<string, unknown>) => {
        let items = loadMessagingItems()
        if (params.month) items = items.filter(i => i.scheduledAt.startsWith(params.month as string))
        if (params.status) items = items.filter(i => i.status === params.status)
        if (params.agent) items = items.filter(i => i.agent === params.agent)
        if (params.channel) {
          const ch = params.channel as string
          items = items.filter(i => i.channels.includes(ch))
        }
        items.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
        return {
          ok: true,
          count: items.length,
          items: items.map(i => ({
            id: i.id,
            title: i.title,
            agent: i.agent,
            status: i.status,
            scheduledAt: i.scheduledAt,
            channels: i.channels,
            contentType: i.contentType,
          })),
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_get',
      label: 'Read message details',
      description: 'Get details for a single messaging item',
      parameters: {
        itemId: z.string().describe('Item ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.itemId) return { ok: false, error: 'itemId required' }
        const item = getItem(params.itemId as string)
        if (!item) return { ok: false, error: 'Item not found' }
        return { ok: true, item }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_create',
      label: 'Created a message',
      activityDuplicate: true,
      description: 'Create a new messaging item',
      parameters: {
        title: z.string().describe('Item title (required)'),
        agent: z.string().describe('Assigned agent (required)'),
        scheduledAt: z.string().describe('ISO datetime for scheduling (required)'),
        channels: z.array(z.string()).optional().describe('Runtime channel IDs (default: ["general"])'),
        contentType: z.string().optional().describe('Content type id from the messaging contentTypes setting (e.g. post, article, video)'),
        tone: z.string().optional().describe('Content tone (energetic, calm, educational, etc.)'),
        brief: z.string().optional().describe('Content brief'),
        status: z.string().optional().describe('Initial status (default: draft)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.title || !params.agent || !params.scheduledAt) {
          return { ok: false, error: 'title, agent, and scheduledAt required' }
        }
        const channels = normalizeChannels(params.channels)
        const item = createItem({
          title: params.title as string,
          agent: params.agent as CalendarItem['agent'],
          scheduledAt: params.scheduledAt as string,
          channels,
          contentType: ((params.contentType as string) || 'post') as CalendarItem['contentType'],
          tone: ((params.tone as string) || 'conversational') as CalendarItem['tone'],
          brief: (params.brief as string) || '',
          status: (params.status as ContentStatus) || 'draft',
        })
        ctx.activity.audit('item.created', params.agent as string, { itemId: item.id, title: params.title })
        return { ok: true, item }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_update',
      label: 'Updated a message',
      activityDuplicate: true,
      description: 'Update a messaging item',
      parameters: {
        itemId: z.string().describe('Item ID (required)'),
        title: z.string().optional().describe('New title'),
        scheduledAt: z.string().optional().describe('New schedule datetime'),
        status: z.string().optional().describe('New status'),
        brief: z.string().optional().describe('Updated brief'),
        tone: z.string().optional().describe('Updated tone'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.itemId) return { ok: false, error: 'itemId required' }
        const { itemId, ...updates } = params
        try {
          const item = updateItem(itemId as string, updates as Partial<CalendarItem>)
          ctx.activity.audit('item.updated', 'system', { itemId })
          return { ok: true, item }
        } catch (e: unknown) {
          return { ok: false, error: String(e) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_approve',
      label: 'Approved a message',
      activityDuplicate: true,
      description: 'Approve a messaging item (draft → scheduled, review → published)',
      parameters: {
        itemId: z.string().describe('Item ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.itemId) return { ok: false, error: 'itemId required' }
        const item = getItem(params.itemId as string)
        if (!item) return { ok: false, error: 'Item not found' }
        const result = await approveItem(item, ctx, messaging)
        if ('error' in result) return { ok: false, error: result.error }
        return { ok: true, item: result.item, newStatus: result.newStatus }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_reject',
      label: 'Rejected a message',
      activityDuplicate: true,
      description: 'Reject a messaging item back to draft status',
      parameters: {
        itemId: z.string().describe('Item ID (required)'),
        note: z.string().optional().describe('Rejection note / feedback'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.itemId) return { ok: false, error: 'itemId required' }
        const item = getItem(params.itemId as string)
        if (!item) return { ok: false, error: 'Item not found' }
        if (item.status !== 'review') return { ok: false, error: 'Can only reject items in review status' }
        const updated = updateItem(params.itemId as string, {
          status: 'draft',
          rejectionNote: (params.note as string) || undefined,
        })
        ctx.activity.audit('item.rejected', 'system', { itemId: params.itemId, note: params.note })
        return { ok: true, item: updated }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_delete',
      label: 'Deleted a message',
      activityDuplicate: true,
      description: 'Delete a messaging item',
      parameters: {
        itemId: z.string().describe('Item ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.itemId) return { ok: false, error: 'itemId required' }
        const item = getItem(params.itemId as string)
        if (!item) return { ok: false, error: 'Item not found' }
        deleteItem(params.itemId as string)
        ctx.activity.audit('item.deleted', 'system', { itemId: params.itemId })
        return { ok: true }
      },
    })

    // ── Session Exec Tools (agent-facing) ─────────────────────────────

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_session_list',
      label: 'Listed brainstorm sessions',
      description: 'List planning sessions with optional filters',
      parameters: {
        status: z.string().optional().describe('Filter by status (active, completed)'),
        agentId: z.string().optional().describe('Filter by agent ID'),
      },
      handler: async (params: Record<string, unknown>) => {
        const sessions = listSessions({
          status: params.status as string | undefined,
          agentId: params.agentId as string | undefined,
        })
        return { ok: true, count: sessions.length, sessions }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_session_get',
      label: 'Read brainstorm session',
      description: 'Get a planning session with full message history and proposals',
      parameters: {
        sessionId: z.string().describe('Session ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.sessionId) return { ok: false, error: 'sessionId required' }
        const session = loadSession(params.sessionId as string)
        if (!session) return { ok: false, error: 'Session not found' }
        return { ok: true, session }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_session_create',
      label: 'Created brainstorm session',
      activityDuplicate: true,
      description: 'Create a new planning session for an agent',
      parameters: {
        agentId: z.string().describe('Agent ID (required)'),
        title: z.string().optional().describe('Session title'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.agentId) return { ok: false, error: 'agentId required' }
        const session = createSession({
          agentId: params.agentId as string,
          title: params.title as string | undefined,
        })
        ctx.activity.audit('session.created', params.agentId as string, { sessionId: session.id })
        return { ok: true, session }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_session_update',
      label: 'Updated brainstorm session',
      description: 'Update a planning session title or status',
      parameters: {
        sessionId: z.string().describe('Session ID (required)'),
        title: z.string().optional().describe('New title'),
        status: z.string().optional().describe('New status (active, completed)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.sessionId) return { ok: false, error: 'sessionId required' }
        try {
          const session = updateSessionFn(params.sessionId as string, {
            title: params.title as string | undefined,
            status: params.status as 'active' | 'completed' | undefined,
          })
          return { ok: true, session }
        } catch (e: unknown) {
          return { ok: false, error: (e as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_session_delete',
      label: 'Deleted brainstorm session',
      activityDuplicate: true,
      description: 'Delete a planning session',
      parameters: {
        sessionId: z.string().describe('Session ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.sessionId) return { ok: false, error: 'sessionId required' }
        try {
          deleteSessionFn(params.sessionId as string)
          ctx.activity.audit('session.deleted', 'system', { sessionId: params.sessionId })
          return { ok: true }
        } catch (e: unknown) {
          return { ok: false, error: (e as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_session_message',
      label: 'Sent brainstorm message',
      description: 'Send a message in a planning session (non-streaming, returns full response)',
      parameters: {
        sessionId: z.string().describe('Session ID (required)'),
        message: z.string().describe('User message content (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.sessionId || !params.message) return { ok: false, error: 'sessionId and message required' }
        const session = loadSession(params.sessionId as string)
        if (!session) return { ok: false, error: 'Session not found' }
        if (session.status === 'completed') return { ok: false, error: 'Session is completed' }

        const userMsg = appendMessage(params.sessionId as string, {
          role: 'user',
          content: params.message as string,
        })

        // Non-streaming: call runtime synchronously and collect full response
        const promptOptions = await resolvePromptOptions(ctx, session.agentId)
        const messages = buildMessages(session, params.message as string, promptOptions)
        const sessionKey = `session-${params.sessionId}-${Date.now()}`

        let fullContent: string
        try {
          fullContent = await sendRuntimeChatCompletion(ctx, {
            messages,
            agentId: session.agentId,
            sessionKey,
          })
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }

        // Parse proposals
        let proposals: Array<{
          id?: string; title: string; scheduledAt: string; contentType: string;
          tone: string; brief: string; channels?: string[]
        }> = []
        const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/)
        if (jsonMatch) {
          try { proposals = JSON.parse(jsonMatch[1]) } catch { /* ignore */ }
        }

        const cleanContent = fullContent.replace(/```json[\s\S]*?```/g, '').trim()
        const assistantMsg = appendMessage(params.sessionId as string, {
          role: 'assistant',
          content: cleanContent,
        })

        let savedProposals: unknown[] = []
        if (proposals.length > 0) {
          savedProposals = upsertProposals(params.sessionId as string, assistantMsg.id, proposals)
        }

        return {
          ok: true,
          response: cleanContent,
          messageId: assistantMsg.id,
          userMessageId: userMsg.id,
          proposals: savedProposals,
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_proposal_update',
      label: 'Updated brainstorm proposal',
      description: 'Update a proposal status or fields (approve, reject, edit)',
      parameters: {
        sessionId: z.string().describe('Session ID (required)'),
        proposalId: z.string().describe('Proposal ID (required)'),
        status: z.string().optional().describe('New status (proposed, approved, rejected, revised)'),
        title: z.string().optional().describe('Updated title'),
        brief: z.string().optional().describe('Updated brief'),
        tone: z.string().optional().describe('Updated tone'),
        scheduledAt: z.string().optional().describe('Updated schedule datetime'),
        channels: z.array(z.string()).optional().describe('Updated channels'),
        rejectionNote: z.string().optional().describe('Note explaining rejection'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.sessionId || !params.proposalId) return { ok: false, error: 'sessionId and proposalId required' }
        try {
          const proposal = updateProposal(params.sessionId as string, params.proposalId as string, {
            status: params.status as ProposalStatus | undefined,
            title: params.title as string | undefined,
            brief: params.brief as string | undefined,
            tone: params.tone as string | undefined,
            scheduledAt: params.scheduledAt as string | undefined,
            channels: params.channels as string[] | undefined,
            rejectionNote: params.rejectionNote as string | undefined,
          })
          return { ok: true, proposal }
        } catch (e: unknown) {
          return { ok: false, error: (e as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_messaging_session_confirm',
      label: 'Confirmed brainstorm proposal',
      activityDuplicate: true,
      description: 'Confirm a planning session — creates messaging items from approved proposals',
      parameters: {
        sessionId: z.string().describe('Session ID (required)'),
        autoApprove: z.boolean().optional().describe('Auto-approve: create items in scheduled status instead of draft'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.sessionId) return { ok: false, error: 'sessionId required' }
        try {
          const result = confirmSession(params.sessionId as string, { autoApprove: !!params.autoApprove })
          ctx.activity.audit('session.confirmed', 'system', {
            sessionId: params.sessionId,
            itemsCreated: result.itemsCreated,
            autoApprove: !!params.autoApprove,
          })
          return { ok: true, ...result }
        } catch (e: unknown) {
          return { ok: false, error: (e as Error).message }
        }
      },
    })

    ctx.watchFiles([
      ctx.storage.searchPath?.('messaging.json') ?? 'messaging.json',
      ctx.storage.searchPath?.(SESSION_FILE_PATTERN) ?? SESSION_FILE_PATTERN,
    ])
    log.info('Messaging plugin activated')
  },

  onReady() {
    const items = activeMessagingStorage?.loadMessagingItems() ?? []
    const byStatus: Record<string, number> = {}
    for (const item of items) {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1
    }
    log.info(`Ready — ${items.length} items`, byStatus)
  },

  onShutdown() {
    activeMessagingStorage = null
    log.info('Messaging plugin shutting down')
  },
}

export default messagingPlugin
