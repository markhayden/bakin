/**
 * Messaging content execution cron.
 * Checks for scheduled content items and creates tasks for agents to execute them.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'

const log = createLogger('messaging-cron')

let cronTimer: NodeJS.Timeout | null = null

async function executeScheduledContent(contentDir: string, port: number): Promise<void> {
  try {
    const messagingPath = join(contentDir, 'messaging.json')
    if (!existsSync(messagingPath)) return

    const items = JSON.parse(readFileSync(messagingPath, 'utf-8'))
    const now = new Date()

    for (const item of items) {
      if (item.status !== 'scheduled') continue
      const scheduledTime = new Date(item.scheduledAt)
      if (scheduledTime > now) continue

      // Load agent persona
      const personaPath = join(contentDir, 'team', 'personas', `${item.agent}.md`)
      const persona = existsSync(personaPath) ? readFileSync(personaPath, 'utf-8') : ''

      const taskTitle = `Content: ${item.title}`
      const taskDescription = buildContentTaskDescription(item, persona, port)

      // Create task via API
      const res = await fetch(`http://localhost:${port}/api/plugins/tasks/`, {
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
        writeFileSync(messagingPath, JSON.stringify(items, null, 2))
      }

      appendAudit(contentDir, 'messaging.execute', 'system', {
        itemId: item.id,
        taskId,
        title: item.title,
      })

      log.info('Content executing', { title: item.title, taskId })
    }
  } catch (err) {
    log.error('Messaging execution error', err)
  }
}

function buildContentTaskDescription(
  item: Record<string, string>,
  persona: string,
  port: number
): string {
  return `
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
   a. Create a subtask for Pixel (image) or Rolo (video) using bakin_exec_tasks_create
   b. IMPORTANT: Tell Pixel/Rolo to discover the assets path via GET /api/paths?key=assets, then save files there with descriptive filenames like {agent}-{type}.png
   c. PUT to http://localhost:${port}/api/plugins/messaging/${item.id} with: { "status": "waiting", "draft": { "caption": "your caption", "imagePrompt": "prompt if applicable", "videoPrompt": "prompt if applicable" } }
   d. Register dependsOn using bakin_exec_tasks_set_dependency with your task ID and the subtask ID
   e. Exit — you will be re-dispatched when the asset is ready
3. If this content does NOT need image/video, or when you are re-dispatched after assets complete:
   - PUT to http://localhost:${port}/api/plugins/messaging/${item.id} with: { "status": "review", "draft": { "caption": "...", "imageFilename": "{filename}.png", "videoFilename": "{filename}.mp4" } }
   - IMPORTANT: Use the bare filename returned by the asset save tool (e.g. "20260416-nemo-workout-a1b2c3d4.png"), NOT a path. Filenames are globally unique and stable across retype/relink.
   - Then mark your task complete

Channel ID for posting: ${item.channelTarget}
`
}

export function start(contentDir: string, port: number): void {
  const settings = getSettings()
  cronTimer = setInterval(() => {
    executeScheduledContent(contentDir, port).catch(err =>
      log.error('Messaging cron error', err)
    )
  }, settings.messaging.intervalMs)
  log.info('Messaging cron started', { intervalMs: settings.messaging.intervalMs })
}

export function stop(): void {
  if (cronTimer) {
    clearInterval(cronTimer)
    cronTimer = null
    log.info('Messaging cron stopped')
  }
}
