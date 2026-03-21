import { createServer, IncomingMessage, ServerResponse } from 'http'
import next from 'next'
import { watch } from 'chokidar'
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs'
import { join, relative } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { MarkdownStorageAdapter } from './src/lib/storage/markdown-adapter'
import { MCEventBus } from './src/lib/events/event-bus'
import { pluginRegistry } from './src/lib/plugin-registry'
import config from './mc.config'

const execFileAsync = promisify(execFile)

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT || 3737)
const CONTENT_DIR = join(process.cwd(), 'content')
const OPENCLAW = process.env.OPENCLAW_PATH || '/opt/homebrew/bin/openclaw'
const HEARTBEAT_DISPATCH_INTERVAL = 5 * 60 * 1000 // 5 minutes

const app = next({ dev })
const handle = app.getRequestHandler()

// ---------------------------------------------------------------------------
// Ensure required directories exist
// ---------------------------------------------------------------------------
for (const dir of [CONTENT_DIR, join(CONTENT_DIR, 'heartbeats'), join(CONTENT_DIR, 'inbox')]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// ---------------------------------------------------------------------------
// SSE clients
// ---------------------------------------------------------------------------
const clients = new Set<ServerResponse>()
const MAX_SSE_CLIENTS = 50

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

// Broadcast a single audit event (NOT the entire file)
function broadcastAuditEvent(entry: Record<string, unknown>) {
  broadcast({ type: 'audit', entry, timestamp: new Date().toISOString() })
}

// ---------------------------------------------------------------------------
// Plugin infrastructure
// ---------------------------------------------------------------------------
const storage = new MarkdownStorageAdapter(CONTENT_DIR)
const eventBus = new MCEventBus(broadcast)

// ---------------------------------------------------------------------------
// Chokidar file watcher — single watcher for all content (no duplicate)
// ---------------------------------------------------------------------------
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

  // Skip audit.jsonl — it's append-only and grows large.
  // Audit events are broadcast individually via broadcastAuditEvent().
  if (rel === 'audit.jsonl') return

  try {
    const content = readFileSync(fullPath, 'utf-8')
    broadcast({ file: rel, content, event, timestamp: new Date().toISOString() })
    eventBus.injectFileEvent(rel, event, content)
  } catch {
    // file may have been deleted
  }

  // Handle inbox completion reports inline (no separate watcher needed)
  if (rel.startsWith('inbox/') && rel.endsWith('.json')) {
    handleInboxFile(fullPath)
  }
}

// ---------------------------------------------------------------------------
// Inbox handler — processes completion reports from agents
// ---------------------------------------------------------------------------
function handleInboxFile(fullPath: string) {
  try {
    const raw = readFileSync(fullPath, 'utf-8')
    const msg = JSON.parse(raw)
    if (msg.type === 'task-complete' && msg.title && msg.agent) {
      const reviewMsg = `Agent ${msg.agent} reports task complete: "${msg.title}". Summary: ${msg.summary || 'No summary provided.'}. Please review and if satisfied, move the task to Done in content/TASKBOARD.md. If rework is needed, add notes and leave it in In Progress.`
      execFile(OPENCLAW, ['agent', '--agent', 'main', '--message', reviewMsg, '--deliver'], (err) => {
        if (err) console.error('Failed to notify main-operator of completion:', err.message)
      })

      const entry = {
        ts: new Date().toISOString(),
        event: 'task.completion_report',
        agent: msg.agent,
        data: { title: msg.title, summary: msg.summary },
      }
      appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n')
      broadcastAuditEvent(entry)
    }
  } catch {
    // not a valid completion report
  }
}

// ---------------------------------------------------------------------------
// SSE handler
// ---------------------------------------------------------------------------
function handleSSE(_req: IncomingMessage, res: ServerResponse) {
  if (clients.size >= MAX_SSE_CLIENTS) {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    res.end('Too many SSE clients')
    return
  }

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

// ---------------------------------------------------------------------------
// Task dependency continuation
// ---------------------------------------------------------------------------
async function checkAndContinueDependents(completedTaskId: string, completedTitle: string) {
  const { readAllColumns, clearDependency } = await import('./src/lib/taskboard')
  const columns = readAllColumns()

  const columnsToScan = [columns.inProgress, columns.todo, columns.blocked]
  for (const col of columnsToScan) {
    for (const task of col) {
      if (task.dependsOn === completedTaskId) {
        await clearDependency(task.id)

        const agentId = task.agent ? (AGENT_ID_MAP[task.agent] || task.agent) : 'main'
        const resumeMsg = `Your dependency task "${completedTitle}" is now Done. Resume your task: "${task.title}". Continue from where you left off. Log: POST http://localhost:${port}/api/tasks/log. When done, move to done and report to main-operator.`

        try {
          await execFileAsync(OPENCLAW, ['agent', '--agent', agentId, '--message', resumeMsg, '--deliver'])
        } catch (err) {
          console.error(`Failed to re-dispatch continuation for "${task.title}":`, String(err))
        }

        const entry = {
          ts: new Date().toISOString(),
          event: 'task.continuation',
          agent: agentId,
          data: { id: task.id, title: task.title, completedDep: completedTaskId },
        }
        appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n')
        broadcastAuditEvent(entry)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Task dispatch system
// ---------------------------------------------------------------------------
const KNOWN_AGENTS = ['main-operator', 'patch', 'pixel', 'rolo', 'chef', 'explorer', 'trainer', 'coach']
const AGENT_ID_MAP: Record<string, string> = { main-operator: 'main' }
const resolveId = (name: string) => AGENT_ID_MAP[name] || name

// Dispatch state — tracks which task IDs have been dispatched
interface DispatchState {
  lastRun: number | null
  serverStart: number
  dispatched: string[] // task IDs that have been dispatched
  failedDispatches: Record<string, number> // task ID → timestamp of last failure
}

function loadDispatchState(): DispatchState {
  const stateFile = join(CONTENT_DIR, '.dispatch-state.json')
  try {
    if (existsSync(stateFile)) {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf-8'))
      // Ensure dispatched array always exists (older state files may lack it)
      if (!Array.isArray(parsed.dispatched)) parsed.dispatched = []
      if (!parsed.failedDispatches || typeof parsed.failedDispatches !== 'object') parsed.failedDispatches = {}
      return parsed
    }
  } catch { /* */ }
  return { lastRun: null, serverStart: Date.now(), dispatched: [], failedDispatches: {} }
}

function saveDispatchState(state: DispatchState) {
  writeFileSync(join(CONTENT_DIR, '.dispatch-state.json'), JSON.stringify(state, null, 2), 'utf-8')
}

let dispatching = false

function startHeartbeatDispatch() {
  setInterval(() => {
    dispatchTasks().catch(err => {
      console.error('Dispatch cycle failed:', err)
      const entry = {
        ts: new Date().toISOString(),
        event: 'system.dispatch_error',
        agent: 'system',
        data: { error: String(err) },
      }
      try {
        appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n')
        broadcastAuditEvent(entry)
      } catch { /* */ }
    })
  }, HEARTBEAT_DISPATCH_INTERVAL)
}

async function dispatchTasks() {
  // Prevent concurrent dispatch runs
  if (dispatching) return
  dispatching = true

  try {
    // Import taskboard functions — all writes go through the mutex
    const { getTodoTasks, moveTaskToInProgress, addTaskLog } = await import('./src/lib/taskboard')

    const { todoTasks } = getTodoTasks()
    if (todoTasks.length === 0) return

    const state = loadDispatchState()
    const dispatchedSet = new Set(state.dispatched)
    const DISPATCH_FAILURE_COOLDOWN = 30 * 60 * 1000 // 30 minutes

    for (const task of todoTasks) {
      // Skip already-dispatched tasks (idempotency guard)
      if (dispatchedSet.has(task.id)) continue

      // Skip tasks that failed dispatch within the cooldown window
      const lastFailure = state.failedDispatches?.[task.id]
      if (lastFailure && Date.now() - lastFailure < DISPATCH_FAILURE_COOLDOWN) continue

      // Skip tasks assigned to unknown agents
      if (task.agent && !KNOWN_AGENTS.includes(task.agent)) continue

      const targetAgent = task.agent ? resolveId(task.agent) : 'main'
      const agentName = task.agent || 'main-operator'

      // Build dispatch message
      const detailsBlock = task.description ? `\n\nDetails:\n${task.description}` : ''
      const contactsRef = `Reference info is in ${join(CONTENT_DIR, 'team/CONTACTS.md')}.`
      const taskboardRef = join(CONTENT_DIR, 'TASKBOARD.md')
      const logEndpoint = `http://localhost:${port}/api/tasks/log`
      const failureInstructions = `If you cannot complete this task or hit an error, report via: openclaw agent --agent main --message "TASK BLOCKED: ${task.title} — <reason>" --deliver`

      let message: string
      if (!task.agent) {
        message = `Triage this task: "${task.title}".${detailsBlock}\n\nEither handle it yourself or assign it to the right agent (patch=execution, pixel=design/media, rolo=content/comms, chef=research/strategy) by updating ${taskboardRef}. ${contactsRef}\n\nLog progress by POSTing to ${logEndpoint} with {"title":"${task.title}","author":"main-operator","message":"your update"}`
      } else if (task.agent === 'main-operator') {
        message = `Work on this task: "${task.title}".${detailsBlock}\n\n${contactsRef} When done, move it to the Done column in ${taskboardRef} and log what you did.\n\nLog progress by POSTing to ${logEndpoint} with {"title":"${task.title}","author":"main-operator","message":"your update"}\n\n${failureInstructions}`
      } else {
        message = `Work on this task: "${task.title}".${detailsBlock}\n\nLog your progress at EVERY major step — not just start and done. Required log points:\n- Log at task start: what you are about to do\n- Log after each major step (reading files, planning, each significant code change, after build)\n- Log if blocked or anything unexpected happens\n- Log on completion with a full summary\n- If you have not logged in the last 5 minutes, log a status update — even if just "still working on X"\n\nFor Patch using Claude Code: log before spawning the agent, and after it completes.\n\nLog command: POST to ${logEndpoint} with {"title":"${task.id}","author":"${agentName}","message":"your update"}\n\nIf this task requires assets from another agent (e.g. images from Pixel, video from Rolo), create a subtask for them using: curl -s -X POST http://localhost:${port}/api/tasks/create -H 'Content-Type: application/json' -d '{"title":"<subtask title>","assignee":"<agent>","description":"<brief>"}'\n\nWhen finished, move this task to Done: curl -s -X POST http://localhost:${port}/api/tasks/move -H 'Content-Type: application/json' -d '{"id":"${task.id}","to":"done"}'\n\nThen report back to main-operator: openclaw agent --agent main --message "TASK COMPLETE: ${task.title} — <summary>" --deliver\n\n${failureInstructions}\n\nDependency pattern: If your task requires output from another agent, create their task first, note its ID, then register a dependency: curl -s -X POST http://localhost:${port}/api/tasks/depend -H 'Content-Type: application/json' -d '{"id":"${task.id}","dependsOn":"<their-task-id>"}'. Then exit — you will be automatically re-dispatched when their task completes.`
      }

      // Deliver to agent — wait for confirmation before moving task
      try {
        await execFileAsync(OPENCLAW, ['agent', '--agent', targetAgent, '--message', message, '--deliver'])

        // Agent received the message — now move to In Progress through the mutex
        await moveTaskToInProgress(task.id, agentName)

        // Track as dispatched
        dispatchedSet.add(task.id)

        const entry = {
          ts: new Date().toISOString(),
          event: 'task.dispatched',
          agent: targetAgent,
          data: { id: task.id, title: task.title },
        }
        appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n')
        broadcastAuditEvent(entry)

      } catch (err) {
        console.error(`Failed to dispatch "${task.title}" to ${targetAgent}:`, String(err))

        // Record failure timestamp to prevent re-dispatch spam within cooldown window
        if (!state.failedDispatches) state.failedDispatches = {}
        state.failedDispatches[task.id] = Date.now()

        // Log failure on the task (once per cooldown window — already rate-limited above)
        try {
          await addTaskLog(task.id, 'system', `Dispatch failed: agent "${targetAgent}" not found or unavailable`)
        } catch { /* best effort */ }

        const entry = {
          ts: new Date().toISOString(),
          event: 'task.dispatch_failed',
          agent: targetAgent,
          data: { id: task.id, title: task.title, error: String(err) },
        }
        appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n')
        broadcastAuditEvent(entry)
      }
    }

    // Save dispatch state
    state.lastRun = Date.now()
    state.dispatched = [...dispatchedSet]
    // Prune dispatched IDs older than 24 hours (in case tasks are re-created)
    // For now just cap at 500 entries
    if (state.dispatched.length > 500) {
      state.dispatched = state.dispatched.slice(-200)
    }
    saveDispatchState(state)

  } finally {
    dispatching = false
  }
}

// ---------------------------------------------------------------------------
// Watchdog — detect stuck in-progress tasks
// ---------------------------------------------------------------------------
function extractSection(content: string, heading: string): string | null {
  const lines = content.split('\n')
  let capture = false
  const result: string[] = []
  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('### ')) {
      if (capture) break
      if (line.includes(heading)) {
        capture = true
        continue
      }
    } else if (capture) {
      result.push(line)
    }
  }
  return result.length > 0 ? result.join('\n') : null
}

function parseInProgressTasks(content: string): { title: string; agent: string | null; lastLogTs: Date | null }[] {
  const section = extractSection(content, '🔵 In Progress')
  if (!section) return []

  const tasks: { title: string; agent: string | null; lastLogTs: Date | null }[] = []
  const lines = section.split('\n')
  let current: { title: string; agent: string | null; lastLogTs: Date | null } | null = null

  for (const line of lines) {
    if (line.startsWith('- [')) {
      if (current) tasks.push(current)
      const titleMatch = line.replace(/^- \[[ x]\] /, '').replace(/ @\w+/, '').replace(/ — .*$/, '').trim()
      const agentMatch = line.match(/@(\w+)/)
      current = { title: titleMatch, agent: agentMatch ? agentMatch[1] : null, lastLogTs: null }
    } else if (current && /^\s{2,}/.test(line) && line.trim()) {
      const logMatch = line.trim().match(/^\[(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+\w+\]/)
      if (logMatch) {
        const ts = new Date(logMatch[1])
        if (!current.lastLogTs || ts > current.lastLogTs) {
          current.lastLogTs = ts
        }
      }
    }
  }
  if (current) tasks.push(current)
  return tasks
}

// Calendar content execution cron
async function executeScheduledContent() {
  try {
    const calendarPath = join(CONTENT_DIR, 'calendar.json')
    if (!existsSync(calendarPath)) return

    const items = JSON.parse(readFileSync(calendarPath, 'utf-8'))
    const now = new Date()

    for (const item of items) {
      if (item.status !== 'scheduled') continue
      const scheduledTime = new Date(item.scheduledAt)
      if (scheduledTime > now) continue

      // Load agent persona
      const personaPath = join(CONTENT_DIR, 'team', 'personas', `${item.agent}.md`)
      const persona = existsSync(personaPath) ? readFileSync(personaPath, 'utf-8') : ''

      // Create task for the agent
      const taskTitle = `Content: ${item.title}`
      const taskDescription = `
You are ${item.agent}. Here is your full persona:

${persona}

---

Create content for the following brief:

**Title:** ${item.title}
**Type:** ${item.contentType}
**Tone:** ${item.tone}
**Channel:** Discord (#general)

**Brief:**
${item.brief}

---

Instructions:
1. Write the caption/post text
2. If this content needs an image or video:
   a. Create a subtask for Pixel (image) or Rolo (video): POST to /api/tasks/create
   b. IMPORTANT: Tell Pixel/Rolo to save the image to content/assets/ with a descriptive filename like content/assets/{agent}-{type}.png (e.g. content/assets/trainer-workout.png)
   c. POST to http://localhost:${port}/api/plugins/calendar/items/update with: { "id": "${item.id}", "status": "waiting", "draft": { "caption": "your caption", "imagePrompt": "prompt if applicable", "videoPrompt": "prompt if applicable" } }
   d. Register dependsOn: POST to /api/tasks/depend with your task ID and the subtask ID
   e. Exit — you will be re-dispatched when the asset is ready
3. If this content does NOT need image/video, or when you are re-dispatched after assets complete:
   - POST to http://localhost:${port}/api/plugins/calendar/items/update with: { "id": "${item.id}", "status": "review", "draft": { "caption": "...", "imagePath": "assets/{filename}.png", "videoPath": "assets/{filename}.mp4" } }
   - IMPORTANT: Use relative paths under assets/ (e.g. "assets/trainer-workout.png"), NOT absolute paths. The system will resolve them relative to the content/ directory.
   - Then mark your task complete

Channel ID for posting: ${item.channelTarget}
`

      // Create task via API
      const res = await fetch(`http://localhost:${port}/api/tasks/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          assignee: item.agent,
          description: taskDescription,
        }),
      })
      const { id: taskId } = await res.json()

      // Update item to executing
      const idx = items.findIndex((i: { id: string }) => i.id === item.id)
      if (idx !== -1) {
        items[idx].status = 'executing'
        items[idx].taskId = taskId
        items[idx].updatedAt = new Date().toISOString()
        writeFileSync(calendarPath, JSON.stringify(items, null, 2))
      }

      // Log to audit
      const entry = {
        ts: new Date().toISOString(),
        event: 'calendar.execute',
        agent: 'system',
        data: { itemId: item.id, taskId, title: item.title },
      }
      appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n')

      console.log(`[calendar] Executing content: ${item.title} -> task ${taskId}`)
    }
  } catch (err) {
    console.error('[calendar] Execution error:', err)
  }
}

function startCalendarCron() {
  const CALENDAR_INTERVAL = 5 * 60 * 1000 // 5 minutes
  setInterval(() => {
    executeScheduledContent().catch(err => console.error('[calendar] Cron error:', err))
  }, CALENDAR_INTERVAL)
  console.log('[calendar] Content execution cron started (every 5 min)')
}

function startWatchdog() {
  const WATCHDOG_INTERVAL = 5 * 60 * 1000
  const STUCK_THRESHOLD = 30 * 60 * 1000

  setInterval(() => {
    try {
      const taskboardPath = join(CONTENT_DIR, 'TASKBOARD.md')
      if (!existsSync(taskboardPath)) return
      const content = readFileSync(taskboardPath, 'utf-8')
      const tasks = parseInProgressTasks(content)
      const now = Date.now()

      for (const task of tasks) {
        const lastActivity = task.lastLogTs ? task.lastLogTs.getTime() : (now - STUCK_THRESHOLD - 1)
        const stuckMs = now - lastActivity
        if (stuckMs > STUCK_THRESHOLD) {
          const minutesStuck = Math.round(stuckMs / 60000)
          const alertMsg = `Task stuck: "${task.title}" (@${task.agent || 'unassigned'}) — no log update in ${minutesStuck} minutes`

          broadcast({ type: 'alert', title: task.title, agent: task.agent, message: alertMsg })

          try {
            const logBody = JSON.stringify({ title: task.title, author: 'watchdog', message: `ALERT: No progress logged in ${minutesStuck}+ minutes` })
            const logReq = require('http').request({
              hostname: 'localhost', port, path: '/api/tasks/log',
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(logBody) }
            })
            logReq.write(logBody)
            logReq.end()
          } catch { /* best effort */ }

          execFile(OPENCLAW, [
            'message', '--channel', 'discord',
            '--to', 'channel:1483917792745885768',
            '--message', `⚠️ **Watchdog Alert**: Task "${task.title}" (@${task.agent || 'unassigned'}) has had no progress log in ${minutesStuck}+ minutes.`
          ], (err) => {
            if (err) console.error('Watchdog Discord alert failed:', err.message)
          })

          console.log(`[watchdog] Alert fired for stuck task: "${task.title}"`)
        }
      }
    } catch (err) {
      console.error('[watchdog] Error:', err)
    }
  }, WATCHDOG_INTERVAL)
}

// ---------------------------------------------------------------------------
// Start everything
// ---------------------------------------------------------------------------
app.prepare().then(async () => {
  // Initialize plugin registry
  console.log('Loading plugins...')
  await pluginRegistry.initialize(config, storage, eventBus)

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
        dispatchTasks()
          .then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }))
          })
          .catch((err) => {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: String(err) }))
          })
        return
      }
      // GET — return timer state
      const state = loadDispatchState()
      const now = Date.now()
      const baseline = state.lastRun || state.serverStart || now
      const nextRun = baseline + HEARTBEAT_DISPATCH_INTERVAL
      const secondsUntilNext = Math.max(0, Math.round((nextRun - now) / 1000))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        intervalMs: HEARTBEAT_DISPATCH_INTERVAL,
        intervalMin: HEARTBEAT_DISPATCH_INTERVAL / 60000,
        lastRun: state.lastRun ? new Date(state.lastRun).toISOString() : null,
        nextRun: new Date(nextRun).toISOString(),
        secondsUntilNext,
        dispatchedCount: state.dispatched.length,
      }))
      return
    }

    // Internal endpoint: task dependency continuation
    if (url.pathname === '/api/internal/continuation' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const { completedTaskId, completedTitle } = JSON.parse(body)
          checkAndContinueDependents(completedTaskId, completedTitle).catch(err => {
            console.error('Continuation check failed:', err)
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
        }
      })
      return
    }

    // Internal endpoint: emit a typed activity event via SSE
    if (url.pathname === '/api/activity/emit' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const payload = JSON.parse(body)
          broadcast({ type: 'activity', agent: payload.agent, message: payload.message, ts: payload.ts })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
        }
      })
      return
    }

    // Let Next.js handle everything else
    handle(req, res)
  })

  startWatcher()
  startHeartbeatDispatch()
  startCalendarCron()
  startWatchdog()

  // Write initial dispatch state
  const state = loadDispatchState()
  state.serverStart = Date.now()
  saveDispatchState(state)

  server.listen(port, '0.0.0.0', () => {
    console.log(`> Mission Control ready on http://0.0.0.0:${port}`)
    console.log(`> Tailscale: http://100.91.112.69:${port}`)
  })

  // Audit system init
  try {
    const entry = {
      ts: new Date().toISOString(),
      event: 'system.init',
      agent: 'system',
      data: {},
    }
    appendFileSync(join(CONTENT_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n')
    broadcastAuditEvent(entry)
  } catch { /* */ }
})
