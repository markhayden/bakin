/**
 * Content Calendar plugin — server entry point.
 * Manages content pipeline: draft → scheduled → executing → waiting → review → published
 */
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import {
  loadCalendarItems,
  createItem,
  updateItem,
  deleteItem,
  getItem,
} from './storage'
import type { CalendarItem, ContentStatus } from './types'
import { getContentDir } from '../../src/core/content-dir'

async function normalizeAssetPath(absPath: string | undefined): Promise<string | undefined> {
  if (!absPath) return undefined
  if (!absPath.startsWith('/')) return absPath // already relative

  const { basename, join } = await import('path')
  const { existsSync, copyFileSync, mkdirSync } = await import('fs')

  const filename = basename(absPath)
  const CONTENT_DIR = getContentDir()
  const assetsDir = join(CONTENT_DIR, 'assets')
  const targetPath = join(assetsDir, filename)

  // If source exists but target doesn't, copy it
  if (existsSync(absPath) && !existsSync(targetPath)) {
    mkdirSync(assetsDir, { recursive: true })
    copyFileSync(absPath, targetPath)
  }

  return `assets/${filename}`
}

const calendarPlugin: BakinPlugin = {
  id: 'calendar',
  name: 'Content Calendar',
  version: '1.0.0',

  navItems: [
    { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', href: '/calendar', order: 25 },
  ],

  contentFiles: [],

  activate(ctx: PluginContext) {
    // GET /api/plugins/calendar/items — list all, filter by ?month=YYYY-MM
    ctx.registerRoute({
      path: '/items',
      method: 'GET',
      handler: async (req) => {
        const url = new URL(req.url)
        const month = url.searchParams.get('month')
        let items = loadCalendarItems()
        
        if (month) {
          items = items.filter(i => i.scheduledAt.startsWith(month))
        }
        
        // Sort by scheduledAt descending
        items.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
        
        return Response.json({ items })
      },
    })

    // POST /api/plugins/calendar/items — create item
    ctx.registerRoute({
      path: '/items',
      method: 'POST',
      handler: async (req) => {
        const body = await req.json()
        const { title, agent, channel, channelTarget, contentType, tone, scheduledAt, brief, status } = body
        
        if (!title || !agent || !scheduledAt) {
          return Response.json({ error: 'title, agent, and scheduledAt required' }, { status: 400 })
        }
        
        const item = createItem({
          title,
          agent,
          channel: channel || 'discord',
          channelTarget: channelTarget || '1483917792745885768',
          contentType: contentType || 'tip',
          tone: tone || 'conversational',
          scheduledAt,
          brief: brief || '',
          status: status || 'draft',
        })
        
        return Response.json({ ok: true, item })
      },
    })

    // POST /api/plugins/calendar/items/update — update item (id in body)
    ctx.registerRoute({
      path: '/items/update',
      method: 'POST',
      handler: async (req) => {
        const url = new URL(req.url)
        const body = await req.json()
        const id = body.id || url.searchParams.get('id')
        
        if (!id) {
          return Response.json({ error: 'id required' }, { status: 400 })
        }

        try {
          // Normalize absolute image/video paths to relative content/assets/ paths
          if (body.draft?.imagePath) {
            body.draft.imagePath = await normalizeAssetPath(body.draft.imagePath)
          }
          if (body.draft?.videoPath) {
            body.draft.videoPath = await normalizeAssetPath(body.draft.videoPath)
          }
          if (body.imagePath) {
            body.imagePath = await normalizeAssetPath(body.imagePath)
          }
          if (body.videoPath) {
            body.videoPath = await normalizeAssetPath(body.videoPath)
          }

          const item = updateItem(id, body)
          return Response.json({ ok: true, item })
        } catch (e) {
          return Response.json({ error: String(e) }, { status: 404 })
        }
      },
    })

    // POST /api/plugins/calendar/items/delete — delete item
    ctx.registerRoute({
      path: '/items/delete',
      method: 'POST',
      handler: async (req) => {
        const url = new URL(req.url)
        const body = await req.json().catch(() => ({}))
        const id = body.id || url.searchParams.get('id')
        
        if (!id) {
          return Response.json({ error: 'id required' }, { status: 400 })
        }
        
        deleteItem(id)
        return Response.json({ ok: true })
      },
    })

    // POST /api/plugins/calendar/items/approve — approve item
    ctx.registerRoute({
      path: '/items/approve',
      method: 'POST',
      handler: async (req) => {
        const body = await req.json()
        const { id } = body
        
        if (!id) {
          return Response.json({ error: 'id required' }, { status: 400 })
        }
        
        const item = getItem(id)
        if (!item) {
          return Response.json({ error: 'Item not found' }, { status: 404 })
        }
        
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

            // Attach image if present
            if (item.draft?.imagePath) {
              const mediaPath = item.draft.imagePath.startsWith('/')
                ? item.draft.imagePath
                : join(CONTENT_DIR, item.draft.imagePath)
              args.push('--media', mediaPath)
            }
            // Attach video if present
            if (item.draft?.videoPath) {
              const mediaPath = item.draft.videoPath.startsWith('/')
                ? item.draft.videoPath
                : join(CONTENT_DIR, item.draft.videoPath)
              args.push('--media', mediaPath)
            }

            await execFileAsync(OPENCLAW, args)
          } catch (err) {
            console.error('[calendar] Discord post failed:', err)
          }
        } else {
          return Response.json({ error: `Cannot approve item in status: ${item.status}` }, { status: 400 })
        }
        
        const updated = updateItem(id, { 
          status: newStatus,
          ...(newStatus === 'published' ? { publishedAt: new Date().toISOString() } : {})
        })
        
        return Response.json({ ok: true, item: updated })
      },
    })

    // POST /api/plugins/calendar/items/reject — reject item back to draft
    ctx.registerRoute({
      path: '/items/reject',
      method: 'POST',
      handler: async (req) => {
        const body = await req.json()
        const { id, note } = body
        
        if (!id) {
          return Response.json({ error: 'id required' }, { status: 400 })
        }
        
        const item = getItem(id)
        if (!item) {
          return Response.json({ error: 'Item not found' }, { status: 404 })
        }
        
        if (item.status !== 'review') {
          return Response.json({ error: 'Can only reject items in review status' }, { status: 400 })
        }
        
        const updated = updateItem(id, { 
          status: 'draft',
          rejectionNote: note || undefined,
        })
        
        return Response.json({ ok: true, item: updated })
      },
    })

    // POST /api/plugins/calendar/brainstorm — AI brainstorming with agent persona
    ctx.registerRoute({
      path: '/brainstorm',
      method: 'POST',
      handler: async (req) => {
        const body = await req.json()
        const { agentId, message, history } = body as {
          agentId: string
          message: string
          history: { role: string; content: string }[]
        }
        
        if (!agentId || !message) {
          return Response.json({ error: 'agentId and message required' }, { status: 400 })
        }
        
        try {
          // Load agent persona
          const { readFileSync, existsSync } = await import('fs')
          const { join } = await import('path')
          const { homedir } = await import('os')
          
          const CONTENT_DIR = getContentDir()
          const personaPath = join(CONTENT_DIR, 'team', 'personas', `${agentId}.md`)
          let persona = ''
          if (existsSync(personaPath)) {
            persona = readFileSync(personaPath, 'utf-8')
          }
          
          // Build system prompt
          const agentNames: Record<string, string> = {
            chef: 'Chef',
            explorer: 'Explorer (Connor)',
            trainer: 'Trainer (Yuki)',
            coach: 'Coach (Marcus)',
          }
          const agentName = agentNames[agentId] || agentId

          // Build conversation context
          const historyContext = (history || []).map((h: { role: string; content: string }) =>
            `${h.role === 'user' ? 'Mark' : agentName}: ${h.content}`
          ).join('\n\n')

          const fullPrompt = `You are ${agentName}, a SampleBrand content creator. Here is your persona:

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

${historyContext ? `Conversation so far:\n${historyContext}\n\n` : ''}Mark says: ${message}`

          // Call via OpenClaw gateway's OpenAI-compatible endpoint (handles auth correctly)
          const { readFileSync: readFS, existsSync: existsFS } = await import('fs')
          const { join: pathJoin } = await import('path')
          const { homedir: homeDir } = await import('os')

          const configPath = pathJoin(homeDir(), '.openclaw', 'openclaw.json')
          let gwToken = ''
          if (existsFS(configPath)) {
            try {
              const cfg = JSON.parse(readFS(configPath, 'utf-8'))
              gwToken = cfg?.gateway?.auth?.token || ''
            } catch { /* ignore */ }
          }

          if (!gwToken) throw new Error('Gateway token not found')

          const sessionKey = `brainstorm-${agentId}-${Date.now()}`
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
          
          // Parse suggestions from JSON block
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
            } catch {
              // Failed to parse, that's okay
            }
          }
          
          return Response.json({
            response: content.replace(/```json[\s\S]*?```/g, '').trim(),
            suggestions,
          })
        } catch (err) {
          console.error('Brainstorm error:', err)
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.watchFiles(['calendar.json'])
  },
}

export default calendarPlugin
