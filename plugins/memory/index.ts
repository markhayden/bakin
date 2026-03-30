/**
 * Memory plugin — server entry point.
 * Registers API routes for audit log, agent workspaces, and gateway logs.
 */
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { parseAuditLog, filterAuditEntries } from './audit-parser'
import { parseGatewayLog } from './gateway-parser'
import { AGENT_IDS } from '../../src/lib/agents-data'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const WORKSPACE_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'HEARTBEAT.md',
]

function getWorkspacePath(agentId: string): string {
  if (agentId === 'roscoe') {
    return path.join(os.homedir(), '.openclaw', 'workspace')
  }
  return path.join(os.homedir(), '.openclaw', 'workspaces', agentId)
}

const memoryPlugin: BakinPlugin = {
  id: 'memory',
  name: 'Memory',
  version: '1.0.0',

  navItems: [
    { id: 'memory', label: 'Memory', icon: 'Brain', href: '/memory', order: 40 },
  ],

  contentFiles: [
    { path: 'MEMORY-LOG.md' },
  ],

  activate(ctx: PluginContext) {
    // GET /api/plugins/memory/audit
    ctx.registerRoute({
      path: '/audit',
      method: 'GET',
      handler: async (req) => {
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
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    // GET /api/plugins/memory/workspace
    ctx.registerRoute({
      path: '/workspace',
      method: 'GET',
      handler: async (req) => {
        try {
          const url = new URL(req.url)
          const agentId = url.searchParams.get('agentId')

          if (!agentId || !AGENT_IDS.includes(agentId)) {
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
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    // GET /api/plugins/memory/gateway
    ctx.registerRoute({
      path: '/gateway',
      method: 'GET',
      handler: async (req) => {
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
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.watchFiles(['MEMORY-LOG.md', 'audit.jsonl'])
  },
}

export default memoryPlugin
