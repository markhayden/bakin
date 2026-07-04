/**
 * Post-process the messaging plugin's deliverable fixtures after they're
 * copied into the mock home, so the content calendar actually shows them:
 *
 *  - Dates shift RELATIVE TO NOW: the fixture timeline (anchored at
 *    2026-04-15) maps onto a window centered on today, so the calendar's
 *    current month always has entries and some future ones spill forward.
 *  - Plan-linked deliverables get a `taskId`: the calendar hides
 *    `planId && !taskId` rows (plan lines that never became work), which was
 *    every fixture — an empty calendar. Task ids cycle through the seeded
 *    Bakin task store so drawer links resolve.
 *  - `proposed` / `cancelled` rows stay untouched (still hidden by design —
 *    they demo the proposals surface instead).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const DAY = 86_400_000
/** Fixture timeline anchor — mid-point of the authored publishAt spread. */
const FIXTURE_ANCHOR = Date.parse('2026-04-15T00:00:00Z')

const DATE_FIELDS = ['publishAt', 'prepStartAt', 'publishedAt', 'createdAt', 'updatedAt'] as const

/** Seeded Bakin task ids (fixtures/tasks.json) for plan-linked deliverables. */
const TASK_IDS = ['task-dn-001', 'task-ip-001', 'task-ip-002', 'task-ip-003', 'task-td-001', 'task-td-002']

export function seedMessagingCalendar(mockHome: string): void {
  const dir = join(mockHome, 'plugin-data', 'messaging', 'messaging', 'deliverables')
  if (!existsSync(dir)) return

  // Align day boundaries so shifted timestamps keep their authored time-of-day.
  const shiftMs = Math.round((Date.now() - FIXTURE_ANCHOR) / DAY) * DAY

  let updated = 0
  let taskIdx = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
    const deliverable = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>

    for (const field of DATE_FIELDS) {
      const value = deliverable[field]
      if (typeof value === 'string' && value) {
        const parsed = Date.parse(value)
        if (!Number.isNaN(parsed)) deliverable[field] = new Date(parsed + shiftMs).toISOString()
      }
    }

    const status = deliverable.status
    if (deliverable.planId && !deliverable.taskId && status !== 'proposed' && status !== 'cancelled') {
      deliverable.taskId = TASK_IDS[taskIdx % TASK_IDS.length]
      taskIdx++
    }

    writeFileSync(path, JSON.stringify(deliverable) + '\n', 'utf-8')
    updated++
  }

  console.log(`[seed] Messaging deliverables re-dated (+${Math.round(shiftMs / DAY)}d) and task-linked (${updated} files)`)
}
