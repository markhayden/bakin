/**
 * Content Calendar plugin — server entry point.
 * Manages content pipeline: draft → scheduled → executing → waiting → review → published
 */
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import {
  loadCalendarItems,
  createItem,
  updateItem,
  deleteItem,
  getItem,
} from './lib/storage'
import type { CalendarItem, ContentStatus } from './types'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'

const log = createLogger('calendar')

async function normalizeAssetPath(absPath: string | undefined): Promise<string | undefined> {
  if (!absPath) return undefined
  if (!absPath.startsWith('/')) return absPath // already relative

  const { basename, join } = await import('path')
  const { existsSync, copyFileSync, mkdirSync } = await import('fs')

  const filename = basename(absPath)
  const CONTENT_DIR = getContentDir()
  const assetsDir = join(CONTENT_DIR, 'assets')
  const targetPath = join(assetsDir, filename)

  if (existsSync(absPath) && !existsSync(targetPath)) {
    mkdirSync(assetsDir, { recursive: true })
    copyFileSync(absPath, targetPath)
  }

  return `assets/${filename}`
}

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

// ---------------------------------------------------------------------------
// Approve logic (shared by route + exec tool)
// ---------------------------------------------------------------------------

async function approveItem(item: CalendarItem, ctx: PluginContext): Promise<{ item: CalendarItem; newStatus: ContentStatus } | { error: string; status: number }> {
  let newStatus: ContentStatus
  if (item.status === 'draft') {
    newStatus = 'scheduled'
  } else if (item.status === 'review') {
    newStatus = 'published'

    // Post to Discord
    try {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const { join } = await import('path')
      const execFileAsync = promisify(execFile)
      const OPENCLAW = process.env.OPENCLAW_PATH || '/opt/homebrew/bin/openclaw'
      const CONTENT_DIR = getContentDir()

      const caption = item.draft?.caption || item.title
      const target = item.channelTarget || '1483917792745885768'
      const args = ['message', 'send', '--channel', 'discord', '--target', `channel:${target}`, '--message', caption]

      if (item.draft?.imagePath) {
        const mediaPath = item.draft.imagePath.startsWith('/')
          ? item.draft.imagePath
          : join(CONTENT_DIR, item.draft.imagePath)
        args.push('--media', mediaPath)
      }
      if (item.draft?.videoPath) {
        const mediaPath = item.draft.videoPath.startsWith('/')
          ? item.draft.videoPath
          : join(CONTENT_DIR, item.draft.videoPath)
        args.push('--media', mediaPath)
      }

      await execFileAsync(OPENCLAW, args)
    } catch (err) {
      log.error('Discord post failed', err)
    }
  } else {
    return { error: `Cannot approve item in status: ${item.status}`, status: 400 }
  }

  const updated = updateItem(item.id, {
    status: newStatus,
    ...(newStatus === 'published' ? { publishedAt: new Date().toISOString() } : {}),
  })

  ctx.activity.audit('item.approved', 'system', { itemId: item.id, from: item.status, to: newStatus })
  ctx.activity.log('system', `Calendar item "${item.title}" approved → ${newStatus}`)
  return { item: updated, newStatus }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const calendarPlugin: BakinPlugin = {
  id: 'calendar',
  name: 'Content Calendar',
  version: '2.0.0',

  settingsSchema: {
    fields: [
      { key: 'defaultView', type: 'select', label: 'Default view', description: 'Calendar view shown on page load', options: [{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'list', label: 'List' }], default: 'month' },
      { key: 'showScheduleJobs', type: 'boolean', label: 'Show schedule jobs', description: 'Display recurring schedule jobs on the calendar', default: false },
    ],
  },

  navItems: [
    { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', href: '/calendar', order: 25 },
  ],

  contentFiles: [],

  activate(ctx: PluginContext) {
    // ── API Routes ─────────────────────────────────────────────────────

    // GET / — list items (optional ?month=YYYY-MM filter)
    const listHandler = async (req: Request) => {
      const url = new URL(req.url)
      const month = url.searchParams.get('month')
      let items = loadCalendarItems()
      if (month) items = items.filter(i => i.scheduledAt.startsWith(month))
      items.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
      return json({ items })
    }
    ctx.registerRoute({ path: '/', method: 'GET', description: 'List calendar items', handler: listHandler })

    // GET /:itemId — get single item
    const getHandler = async (req: Request) => {
      const url = new URL(req.url)
      const id = url.searchParams.get('itemId')
      if (!id) return json({ error: 'itemId required' }, 400)
      const item = getItem(id)
      if (!item) return json({ error: 'Item not found' }, 404)
      return json({ item })
    }
    ctx.registerRoute({ path: '/:itemId', method: 'GET', description: 'Get single calendar item', handler: getHandler })

    // POST / — create item
    const createHandler = async (req: Request) => {
      const body = await readBody<Record<string, unknown>>(req)
      const { title, agent, channel, channelTarget, contentType, tone, scheduledAt, brief, status } = body as Record<string, string>

      if (!title || !agent || !scheduledAt) {
        return json({ error: 'title, agent, and scheduledAt required' }, 400)
      }

      const item = createItem({
        title,
        agent: agent as CalendarItem['agent'],
        channel: (channel || 'discord') as CalendarItem['channel'],
        channelTarget: channelTarget || '1483917792745885768',
        contentType: (contentType || 'tip') as CalendarItem['contentType'],
        tone: (tone || 'conversational') as CalendarItem['tone'],
        scheduledAt,
        brief: brief || '',
        status: (status as ContentStatus) || 'draft',
      })

      ctx.activity.audit('item.created', agent, { itemId: item.id, title })
      ctx.activity.log(agent, `Created calendar item "${title}"`)
      return json({ ok: true, item })
    }
    ctx.registerRoute({ path: '/', method: 'POST', description: 'Create calendar item', handler: createHandler })

    // PUT /:itemId — update item
    const updateHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<Record<string, unknown>>(req)
      const id = url.searchParams.get('itemId') || (body.id as string)

      if (!id) return json({ error: 'id required' }, 400)

      try {
        if (body.draft && typeof body.draft === 'object') {
          const draft = body.draft as Record<string, unknown>
          if (draft.imagePath) draft.imagePath = await normalizeAssetPath(draft.imagePath as string)
          if (draft.videoPath) draft.videoPath = await normalizeAssetPath(draft.videoPath as string)
        }
        if (body.imagePath) body.imagePath = await normalizeAssetPath(body.imagePath as string)
        if (body.videoPath) body.videoPath = await normalizeAssetPath(body.videoPath as string)

        const item = updateItem(id, body as Partial<CalendarItem>)
        ctx.activity.audit('item.updated', 'system')
        ctx.activity.log('system', `Updated calendar item "${item.title}"`)
        return json({ ok: true, item })
      } catch (e: unknown) {
        return json({ error: (e as Error).message || String(e) }, 404)
      }
    }
    ctx.registerRoute({ path: '/:itemId', method: 'PUT', description: 'Update calendar item', handler: updateHandler })

    // DELETE /:itemId — delete item
    const deleteHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<{ id?: string }>(req).catch(() => ({} as { id?: string }))
      const id = url.searchParams.get('itemId') || body.id

      if (!id) return json({ error: 'id required' }, 400)

      deleteItem(id)
      ctx.activity.audit('item.deleted', 'system', { itemId: id })
      ctx.activity.log('system', `Deleted calendar item ${id}`)
      return json({ ok: true })
    }
    ctx.registerRoute({ path: '/:itemId', method: 'DELETE', description: 'Delete calendar item', handler: deleteHandler })

    // POST /:itemId/approve — approve item
    const approveHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<{ id?: string }>(req).catch(() => ({} as { id?: string }))
      const id = url.searchParams.get('itemId') || body.id

      if (!id) return json({ error: 'id required' }, 400)

      const item = getItem(id)
      if (!item) return json({ error: 'Item not found' }, 404)

      const result = await approveItem(item, ctx)
      if ('error' in result) return json({ error: result.error }, result.status)
      return json({ ok: true, item: result.item })
    }
    ctx.registerRoute({ path: '/:itemId/approve', method: 'POST', description: 'Approve calendar item', handler: approveHandler })

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
      ctx.activity.log('system', `Calendar item "${item.title}" rejected → draft`)
      return json({ ok: true, item: updated })
    }
    ctx.registerRoute({ path: '/:itemId/reject', method: 'POST', description: 'Reject calendar item', handler: rejectHandler })

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

        try {
          const { readFileSync, existsSync } = await import('fs')
          const { join } = await import('path')
          const { homedir } = await import('os')

          const CONTENT_DIR = getContentDir()
          const personaPath = join(CONTENT_DIR, 'team', 'personas', `${body.agentId}.md`)
          let persona = ''
          if (existsSync(personaPath)) {
            persona = readFileSync(personaPath, 'utf-8')
          }

          const agentNames: Record<string, string> = {
            basil: 'Basil',
            scout: 'Scout (Connor)',
            nemo: 'Nemo (Yuki)',
            zen: 'Zen (Marcus)',
          }
          const agentName = agentNames[body.agentId] || body.agentId

          const historyContext = (body.history || []).map(h =>
            `${h.role === 'user' ? 'Mark' : agentName}: ${h.content}`
          ).join('\n\n')

          const fullPrompt = `You are ${agentName}, a BetterFit content creator. Here is your persona:

${persona}

---

You are brainstorming content calendar ideas with Mark. When he describes what he's looking for, suggest 3-5 concrete calendar items in your authentic voice.

For each suggestion provide:
- title: catchy post title in your voice
- scheduledAt: suggested date+time ISO string (timezone: America/Denver, MDT = UTC-6)
- contentType: one of recipe, tip, motivation, workout, outdoor, video, image-post
- tone: one of energetic, calm, educational, humorous, inspiring, conversational
- brief: 2-3 sentence description of what to create when this executes

Format: conversational response in your voice, then a JSON block:
\`\`\`json
[{ "title": "...", "scheduledAt": "...", "contentType": "...", "tone": "...", "brief": "..." }]
\`\`\`

${historyContext ? `Conversation so far:\n${historyContext}\n\n` : ''}Mark says: ${body.message}`

          const configPath = join(homedir(), '.openclaw', 'openclaw.json')
          let gwToken = ''
          if (existsSync(configPath)) {
            try {
              const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
              gwToken = cfg?.gateway?.auth?.token || ''
            } catch { /* ignore */ }
          }

          if (!gwToken) throw new Error('Gateway token not found')

          const sessionKey = `brainstorm-${body.agentId}-${Date.now()}`
          const gwResponse = await fetch('http://localhost:18789/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${gwToken}`,
              'x-openclaw-session-key': sessionKey,
            },
            body: JSON.stringify({
              model: 'openclaw:main',
              max_tokens: 2048,
              messages: [{ role: 'user', content: fullPrompt }],
            }),
          })

          if (!gwResponse.ok) {
            const err = await gwResponse.text()
            throw new Error(`Gateway error: ${err}`)
          }

          const gwData = await gwResponse.json()
          const content = gwData.choices?.[0]?.message?.content || ''

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

    // ── Exec Tools (agent-facing) ──────��───────────────────────────────

    ctx.registerExecTool({
      name: 'bakin_exec_calendar_list',
      description: 'List calendar items with optional filters',
      parameters: {
        month: z.string().optional().describe('Filter by month (YYYY-MM)'),
        status: z.string().optional().describe('Filter by status (draft, scheduled, review, published, etc.)'),
        agent: z.string().optional().describe('Filter by assigned agent'),
      },
      handler: async (params: Record<string, unknown>) => {
        let items = loadCalendarItems()
        if (params.month) items = items.filter(i => i.scheduledAt.startsWith(params.month as string))
        if (params.status) items = items.filter(i => i.status === params.status)
        if (params.agent) items = items.filter(i => i.agent === params.agent)
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
            channel: i.channel,
            contentType: i.contentType,
          })),
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_calendar_get',
      description: 'Get details for a single calendar item',
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
      name: 'bakin_exec_calendar_create',
      description: 'Create a new calendar item',
      parameters: {
        title: z.string().describe('Item title (required)'),
        agent: z.string().describe('Assigned agent (required)'),
        scheduledAt: z.string().describe('ISO datetime for scheduling (required)'),
        channel: z.string().optional().describe('Channel (default: discord)'),
        channelTarget: z.string().optional().describe('Channel target ID'),
        contentType: z.string().optional().describe('Content type (recipe, tip, motivation, etc.)'),
        tone: z.string().optional().describe('Content tone (energetic, calm, educational, etc.)'),
        brief: z.string().optional().describe('Content brief'),
        status: z.string().optional().describe('Initial status (default: draft)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.title || !params.agent || !params.scheduledAt) {
          return { ok: false, error: 'title, agent, and scheduledAt required' }
        }
        const item = createItem({
          title: params.title as string,
          agent: params.agent as CalendarItem['agent'],
          scheduledAt: params.scheduledAt as string,
          channel: ((params.channel as string) || 'discord') as CalendarItem['channel'],
          channelTarget: (params.channelTarget as string) || '1483917792745885768',
          contentType: ((params.contentType as string) || 'tip') as CalendarItem['contentType'],
          tone: ((params.tone as string) || 'conversational') as CalendarItem['tone'],
          brief: (params.brief as string) || '',
          status: (params.status as ContentStatus) || 'draft',
        })
        ctx.activity.audit('item.created', params.agent as string, { itemId: item.id, title: params.title })
        ctx.activity.log(params.agent as string, `Created calendar item "${params.title}"`)
        return { ok: true, item }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_calendar_update',
      description: 'Update a calendar item',
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
      name: 'bakin_exec_calendar_approve',
      description: 'Approve a calendar item (draft → scheduled, review → published)',
      parameters: {
        itemId: z.string().describe('Item ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.itemId) return { ok: false, error: 'itemId required' }
        const item = getItem(params.itemId as string)
        if (!item) return { ok: false, error: 'Item not found' }
        const result = await approveItem(item, ctx)
        if ('error' in result) return { ok: false, error: result.error }
        return { ok: true, item: result.item, newStatus: result.newStatus }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_calendar_reject',
      description: 'Reject a calendar item back to draft status',
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
        ctx.activity.log('system', `Calendar item "${item.title}" rejected → draft`)
        return { ok: true, item: updated }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_calendar_delete',
      description: 'Delete a calendar item',
      parameters: {
        itemId: z.string().describe('Item ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.itemId) return { ok: false, error: 'itemId required' }
        const item = getItem(params.itemId as string)
        if (!item) return { ok: false, error: 'Item not found' }
        deleteItem(params.itemId as string)
        ctx.activity.audit('item.deleted', 'system', { itemId: params.itemId })
        ctx.activity.log('system', `Deleted calendar item "${item.title}"`)
        return { ok: true }
      },
    })

    ctx.watchFiles(['calendar.json'])
    log.info('Calendar plugin activated')
  },

  onReady() {
    const items = loadCalendarItems()
    const byStatus: Record<string, number> = {}
    for (const item of items) {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1
    }
    log.info(`Ready — ${items.length} items`, byStatus)
  },

  onShutdown() {
    log.info('Calendar plugin shutting down')
  },
}

export default calendarPlugin
