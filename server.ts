import { createServer, IncomingMessage, ServerResponse, request as httpRequest } from 'http'
import next from 'next'
import { watch } from 'chokidar'
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs'
import { join, relative } from 'path'
import { execFile } from 'child_process'

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT || 3737)
const CONTENT_DIR = join(process.cwd(), 'content')
const OPENCLAW = '/opt/homebrew/bin/openclaw'
const HEARTBEAT_DISPATCH_INTERVAL = 5 * 60 * 1000 // 5 minutes

const app = next({ dev })
const handle = app.getRequestHandler()

// SSE clients
const clients = new Set<ServerResponse>()

function broadcast(data: Record<string, unknown>) {
  const msg = `data: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    try {
      client.write(msg)
    } catch {
      clients.delete(client)
    }
  }
}

// Chokidar file watcher
function startWatcher() {
  const watcher = watch(CONTENT_DIR, {
    ignored: /(^|[/\\])\./,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  })

  watcher.on('change', (fullPath: string) => handleFileEvent(fullPath, 'change'))
  watcher.on('add', (fullPath: string) => handleFileEvent(fullPath, 'add'))
}

function handleFileEvent(fullPath: string, event: string) {
  if (!/\.(md|json|jsonl)$/.test(fullPath)) return
  const rel = relative(CONTENT_DIR, fullPath)
  try {
    const content = readFileSync(fullPath, 'utf-8')
    broadcast({ file: rel, content, event, timestamp: new Date().toISOString() })
  } catch {
    // file may have been deleted
  }
}

// SSE handler
function handleSSE(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.write(':ok\n\n')
  clients.add(res)

  const keepAlive = setInterval(() => {
    try { res.write(':ping\n\n') } catch { /* */ }
  }, 30000)

  _req.on('close', () => {
    clients.delete(res)
    clearInterval(keepAlive)
  })
}

// Fire-and-forget POST to a local Next.js API route.
// Routes all TASKBOARD.md writes through the taskboard.ts parser/serializer,
// eliminating the dual-writer race between server.ts and the API layer.
function postToApi(path: string, body: Record<string, unknown>): void {
  try {
    const payload = JSON.stringify(body)
    const req = httpRequest({
      hostname: 'localhost',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      // Drain response to free socket
      res.resume()
    })
    req.on('error', (err) => {
      console.error(`postToApi ${path} failed:`, err.message)
    })
    req.write(payload)
    req.end()
  } catch (err) {
    console.error(`postToApi ${path} threw:`, err)
  }
}

// Heartbeat task dispatch
function startHeartbeatDispatch() {
  setInterval(() => {
    try {
      dispatchTasks()
    } catch {
      // don't crash the server
    }
  }, HEARTBEAT_DISPATCH_INTERVAL)
}

function dispatchTasks() {
  const taskboardPath = join(CONTENT_DIR, 'TASKBOARD.md')
  if (!existsSync(taskboardPath)) return

  let content = readFileSync(taskboardPath, 'utf-8')
  const agents = ['main', 'patch', 'pixel', 'rolo', 'basil']
  let changed = false

  // Parse tasks with descriptions
  const todoSection = extractSection(content, '📋 Todo')
  if (!todoSection) return

  const taskBlocks = parseTodoTasks(todoSection)

  // Map @roscoe → main (openclaw agent id)
  const AGENT_ID_MAP: Record<string, string> = { roscoe: 'main' }
  const resolveId = (name: string) => AGENT_ID_MAP[name] || name
  const knownNames = ['roscoe', 'patch', 'pixel', 'rolo', 'basil']

  for (const { line, title, assignedAgent, description } of taskBlocks) {
    if (assignedAgent && !knownNames.includes(assignedAgent)) continue

    let targetAgent: string
    let message: string
    const detailsBlock = description ? `\n\nDetails:\n${description}` : ''
    const contactsRef = `Reference info is in ${join(CONTENT_DIR, 'team/CONTACTS.md')}.`
    const taskboardRef = join(CONTENT_DIR, 'TASKBOARD.md')
    const logCmd = `curl -s -X POST http://localhost:${port}/api/tasks/log -H 'Content-Type: application/json' -d '{"title":"${title.replace(/'/g, "\\'")}","author":"AGENT_NAME","message":"YOUR_STATUS"}'`
    const failureInstructions = `If you cannot complete this task or hit an error, log it: ${logCmd.replace('AGENT_NAME', assignedAgent || 'roscoe').replace('YOUR_STATUS', 'BLOCKED: <reason>')} — then report via: openclaw agent --agent main --message "TASK BLOCKED: ${title} — <reason>" --deliver`

    if (!assignedAgent) {
      targetAgent = 'main'
      message = `Triage this task: "${title}".${detailsBlock}\n\nEither handle it yourself or assign it to the right agent (patch=execution, pixel=design/media, rolo=content/comms, basil=research/strategy) by updating ${taskboardRef}. ${contactsRef}\n\nLog your progress: ${logCmd.replace('AGENT_NAME', 'roscoe').replace('YOUR_STATUS', 'your update here')}`
    } else if (assignedAgent === 'roscoe') {
      targetAgent = 'main'
      message = `Work on this task: "${title}".${detailsBlock}\n\n${contactsRef} When done, move it to the Done column in ${taskboardRef} and log what you did.\n\nLog progress as you work: ${logCmd.replace('AGENT_NAME', 'roscoe').replace('YOUR_STATUS', 'your update here')}\n\n${failureInstructions}`
    } else {
      targetAgent = resolveId(assignedAgent)
      message = `Work on this task: "${title}".${detailsBlock}\n\nLog your progress as you work: ${logCmd.replace('AGENT_NAME', assignedAgent).replace('YOUR_STATUS', 'your update here')}\n\nWhen you are finished, log completion and report back to roscoe using: openclaw agent --agent main --message "TASK COMPLETE: ${title} — <summary of what you did>" --deliver\n\n${failureInstructions}`
    }

    execFile(OPENCLAW, ['agent', '--agent', targetAgent, '--message', message, '--deliver'], (err) => {
      if (err) {
        console.error(`Failed to dispatch to ${targetAgent}:`, err.message)
        // Log the failure on the task so it's visible in the UI
        try {
          const logBody = JSON.stringify({ title, author: 'system', message: `Dispatch failed: agent "${targetAgent}" not found or unavailable` })
          const logReq = require('http').request({ hostname: 'localhost', port, path: '/api/tasks/log', method: 'POST', headers: { 'Content-Type': 'application/json' } })
          logReq.write(logBody)
          logReq.end()
        } catch { /* best effort */ }
      }
    })

    // Move to In Progress with agent tag
    const date = new Date().toISOString().split('T')[0]
    const agentTag = assignedAgent ? `@${assignedAgent}` : '@roscoe'
    const newLine = `- [ ] ${title} ${agentTag} — ${date}`
    content = moveTaskInContent(content, line, newLine, '🔵 In Progress')
    changed = true

    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      event: assignedAgent ? 'task.dispatched' : 'task.triaged',
      agent: targetAgent,
      data: { title },
    })
    appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), entry + '\n')
  }

  if (changed) {
    const now = new Date().toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
      hour12: false,
    })
    content = content.replace(/_Last updated: .+_/, `_Last updated: ${now}_`)
    writeFileSync(taskboardPath, content, 'utf-8')
  }

  // Record dispatch time
  writeFileSync(join(CONTENT_DIR, '.dispatch-state.json'), JSON.stringify({ lastRun: Date.now() }), 'utf-8')
}

function parseTodoTasks(section: string): { line: string; title: string; assignedAgent: string | null; description: string }[] {
  const tasks: { line: string; title: string; assignedAgent: string | null; description: string }[] = []
  const lines = section.split('\n')
  let current: { line: string; title: string; assignedAgent: string | null; descLines: string[] } | null = null

  for (const l of lines) {
    if (l.startsWith('- [')) {
      if (current) tasks.push({ ...current, description: current.descLines.join('\n') })
      const title = l.replace(/^- \[[ x]\] /, '').replace(/ @\w+/, '').replace(/ — .*$/, '').trim()
      const agentMatch = l.match(/@(\w+)/)
      current = { line: l, title, assignedAgent: agentMatch ? agentMatch[1] : null, descLines: [] }
    } else if (current && /^\s{2,}/.test(l) && l.trim()) {
      current.descLines.push(l.trim())
    }
  }
  if (current) tasks.push({ ...current, description: current.descLines.join('\n') })
  return tasks
}

function extractSection(content: string, headerKeyword: string): string | null {
  const lines = content.split('\n')
  let capture = false
  const result: string[] = []
  for (const line of lines) {
    if (line.startsWith('## ') && line.includes(headerKeyword)) {
      capture = true
      continue
    }
    if (line.startsWith('## ') && capture) break
    if (capture) result.push(line)
  }
  return result.length > 0 ? result.join('\n') : null
}

function moveTaskInContent(content: string, oldLine: string, newLine: string, targetHeader: string): string {
  const lines = content.split('\n')

  // Find the task line and collect its indented children (description + log lines)
  const taskIdx = lines.findIndex(l => l === oldLine)
  const childLines: string[] = []
  if (taskIdx !== -1) {
    // Remove task line
    lines.splice(taskIdx, 1)
    // Collect and remove indented lines that follow
    while (taskIdx < lines.length && /^\s{2,}/.test(lines[taskIdx]) && lines[taskIdx].trim()) {
      childLines.push(lines.splice(taskIdx, 1)[0])
    }
  }

  // Insert at target section
  const result: string[] = []
  let inserted = false
  for (const line of lines) {
    result.push(line)
    if (!inserted && line.startsWith('## ') && line.includes(targetHeader)) {
      result.push(newLine)
      for (const child of childLines) {
        result.push(child)
      }
      inserted = true
    }
  }
  return result.join('\n')
}

// Watch inbox for completion reports from subagents
function startCompletionWatch() {
  const inboxDir = join(CONTENT_DIR, 'inbox')
  if (!existsSync(inboxDir)) return

  const watcher = watch(inboxDir, {
    ignored: /(^|[/\\])\./,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  })

  watcher.on('add', (fullPath: string) => {
    if (!fullPath.endsWith('.json')) return
    try {
      const raw = readFileSync(fullPath, 'utf-8')
      const msg = JSON.parse(raw)
      if (msg.type === 'task-complete' && msg.title && msg.agent) {
        // Forward to Roscoe for review
        const reviewMsg = `Agent ${msg.agent} reports task complete: "${msg.title}". Summary: ${msg.summary || 'No summary provided.'}. Please review and if satisfied, move the task to Done in content/TASKBOARD.md. If rework is needed, add notes and leave it in In Progress.`
        execFile(OPENCLAW, ['agent', '--agent', 'main', '--message', reviewMsg, '--deliver'], (err) => {
          if (err) console.error('Failed to notify roscoe of completion:', err.message)
        })

        const entry = JSON.stringify({
          ts: new Date().toISOString(),
          event: 'task.completion_report',
          agent: msg.agent,
          data: { title: msg.title, summary: msg.summary },
        })
        appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), entry + '\n')
      }
    } catch {
      // not a valid completion report
    }
  })
}

// Start everything
app.prepare().then(() => {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)

    // Intercept SSE before Next.js
    if (url.pathname === '/api/events') {
      handleSSE(req, res)
      return
    }

    // Dispatch endpoint — GET for timer state, POST to trigger
    if (url.pathname === '/api/dispatch') {
      if (req.method === 'POST') {
        try {
          dispatchTasks()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: String(err) }))
        }
        return
      }
      // GET — return timer state
      const stateFile = join(CONTENT_DIR, '.dispatch-state.json')
      let lastRun: number | null = null
      let serverStartTs: number | null = null
      if (existsSync(stateFile)) {
        try {
          const data = JSON.parse(readFileSync(stateFile, 'utf-8'))
          lastRun = data.lastRun || null
          serverStartTs = data.serverStart || null
        } catch { /* */ }
      }
      const now = Date.now()
      const baseline = lastRun || serverStartTs || now
      const nextRun = baseline + HEARTBEAT_DISPATCH_INTERVAL
      const secondsUntilNext = Math.max(0, Math.round((nextRun - now) / 1000))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        intervalMs: HEARTBEAT_DISPATCH_INTERVAL,
        intervalMin: HEARTBEAT_DISPATCH_INTERVAL / 60000,
        lastRun: lastRun ? new Date(lastRun).toISOString() : null,
        nextRun: new Date(nextRun).toISOString(),
        secondsUntilNext,
      }))
      return
    }

    // Let Next.js handle everything else
    handle(req, res)
  })

  startWatcher()
  startHeartbeatDispatch()
  startCompletionWatch()

  // Write initial dispatch state so the timer knows when server started
  writeFileSync(join(CONTENT_DIR, '.dispatch-state.json'), JSON.stringify({ serverStart: Date.now() }), 'utf-8')

  server.listen(port, '0.0.0.0', () => {
    console.log(`> Mission Control ready on http://0.0.0.0:${port}`)
    console.log(`> Tailscale: http://100.91.112.69:${port}`)
  })

  // Audit system init
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      event: 'system.init',
      agent: 'roscoe',
      data: {},
    })
    appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), entry + '\n')
  } catch { /* */ }
})
