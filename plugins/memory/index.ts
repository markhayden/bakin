/**
 * Memory plugin — server entry point.
 * Registers API routes for audit log, agent workspaces, and gateway logs.
 */
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { parseAuditLog, filterAuditEntries } from './lib/audit-parser'
import { parseGatewayLog } from './lib/gateway-parser'
import { getAgentIds } from '../team/lib/openclaw-adapter'
import { getMainAgentId } from '@bakin/core/main-agent'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { getContentDir } from '@bakin/core/content-dir'
import { getSettings } from '@bakin/core/settings'
import * as fs from 'fs'
import * as path from 'path'

const WORKSPACE_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'HEARTBEAT.md',
]

function getWorkspacePath(agentId: string): string {
  if (agentId === getMainAgentId()) {
    return getOpenClawPath('workspace')
  }
  return getOpenClawPath('workspaces', agentId)
}

const memoryPlugin: BakinPlugin = {
  id: 'memory',
  name: 'Memory',
  version: '1.0.0',

  settingsSchema: {
    fields: [
      { key: 'retentionDays', type: 'number', label: 'Audit retention (days)', description: 'Auto-archive audit entries older than this', default: 90 },
    ],
  },

  navItems: [
    { id: 'memory', label: 'Memory', icon: 'Brain', href: '/memory', order: 40 },
  ],

  contentFiles: [
    { path: 'MEMORY-LOG.md' },
  ],

  activate(ctx: PluginContext) {
    // ─── Search Content Type Registration ─────────────────────────────
    // Memory owns audit reading (/api/plugins/memory/audit) so it also
    // owns the audit search content type. Table name stays `bakin_audit`.
    ctx.search.registerContentType({
      table: 'audit',
      schema: {
        event: { type: 'keyword' },
        agent: { type: 'keyword' },
        channel: { type: 'keyword' },
        content: { type: 'text' },
        created_at: { type: 'datetime' },
      },
      searchableFields: ['content', 'event'],
      rerankField: 'content',
      embeddingTemplate: '{{event}} {{agent}} {{content}}',
      facets: ['event', 'agent', 'channel'],
      ttl: getSettings().antfly.auditTtl,
      ttlField: 'created_at',
      reindex: async function* () {
        // Read audit.jsonl and yield each entry
        const { createReadStream, existsSync } = await import('fs')
        const { createInterface } = await import('readline')
        const auditPath = path.join(getContentDir(), 'audit.jsonl')
        if (!existsSync(auditPath)) return
        const rl = createInterface({ input: createReadStream(auditPath) })
        for await (const line of rl) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line)
            const key = `audit-${entry.ts}-${entry.event}`
            yield {
              key,
              doc: {
                event: entry.event,
                agent: entry.agent,
                channel: entry.channel || '',
                content: `[${entry.ts}] ${entry.event} by ${entry.agent}: ${JSON.stringify(entry.data || {})}`,
                created_at: entry.ts,
              },
            }
          } catch { /* skip malformed lines */ }
        }
      },
      verifyExists: async () => true, // audit entries are append-only, never deleted
    })

    // GET /api/plugins/memory/audit
    ctx.registerRoute({
      path: '/audit',
      method: 'GET',
      handler: async (req: Request) => {
        try {
          const content = ctx.storage.read('audit.jsonl')
          if (!content) {
            return Response.json({ entries: [] })
          }

          const url = new URL(req.url)
          const agent = url.searchParams.get('agent') || undefined
          const event = url.searchParams.get('event') || undefined
          const limitStr = url.searchParams.get('limit')
          const limit = limitStr ? parseInt(limitStr, 10) : undefined

          const entries = parseAuditLog(content)
          const filtered = filterAuditEntries(entries, { agent, event, limit })

          return Response.json({ entries: filtered })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // GET /api/plugins/memory/workspace
    ctx.registerRoute({
      path: '/workspace',
      method: 'GET',
      handler: async (req: Request) => {
        try {
          const url = new URL(req.url)
          const agentId = url.searchParams.get('agentId')

          if (!agentId || !getAgentIds().includes(agentId)) {
            return Response.json({ error: 'Invalid agentId' }, { status: 400 })
          }

          const wsPath = getWorkspacePath(agentId)
          const files: Record<string, string> = {}
          const memoryFiles: Record<string, string> = {}

          for (const filename of WORKSPACE_FILES) {
            const filePath = path.join(wsPath, filename)
            try {
              if (fs.existsSync(filePath)) {
                files[filename] = fs.readFileSync(filePath, 'utf-8')
              }
            } catch {
              // skip unreadable files
            }
          }

          // Read memory/ directory for daily files
          const memoryDir = path.join(wsPath, 'memory')
          try {
            if (fs.existsSync(memoryDir)) {
              const memFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'))
              for (const mf of memFiles) {
                try {
                  memoryFiles[mf] = fs.readFileSync(path.join(memoryDir, mf), 'utf-8')
                } catch {
                  // skip
                }
              }
            }
          } catch {
            // no memory dir
          }

          return Response.json({ files, memoryFiles })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // GET /api/plugins/memory/gateway
    ctx.registerRoute({
      path: '/gateway',
      method: 'GET',
      handler: async (req: Request) => {
        try {
          const url = new URL(req.url)
          const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
          const offset = parseInt(url.searchParams.get('offset') || '0', 10)
          const limit = parseInt(url.searchParams.get('limit') || '50', 10)

          const logPath = path.join('/tmp', 'openclaw', `openclaw-${date}.log`)

          if (!fs.existsSync(logPath)) {
            return Response.json({ entries: [], total: 0, hasMore: false })
          }

          const content = fs.readFileSync(logPath, 'utf-8')
          const result = parseGatewayLog(content, { offset, limit })

          return Response.json(result)
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    ctx.watchFiles(['MEMORY-LOG.md', 'audit.jsonl'])
  },
}

export default memoryPlugin
