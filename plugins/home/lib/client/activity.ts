/**
 * What is happening on this home, for the everyday Home: read from the
 * pages that own it (Tasks, Chat, Schedule) over their own HTTP routes and
 * reduced here. Pure apart from `useHomeActivity`; nothing is stored, and a
 * source that cannot answer contributes nothing rather than a guess.
 */
import { useCallback, useEffect, useState } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'

/** The fields Home reads from a task on the board. */
export interface BoardTask {
  id: string
  title: string
  /** `system` marks tasks Bakin opened for itself (Health): not the person's work. */
  createdBy?: string
  updatedAt?: number
}
export type BoardColumns = Partial<Record<'backlog' | 'todo' | 'inProgress' | 'blocked' | 'review' | 'done' | 'archived', BoardTask[]>>

export interface ChatRow {
  id: string
  title: string
  updatedAt: string
  /** When the person last opened it. */
  lastSeenAt?: string
  lastMessagePreview?: string
}

export interface Occurrence {
  at: string
  past: boolean
}

export interface PickUpItem {
  key: string
  kind: 'chat' | 'task'
  title: string
  /** What it is and where it stands, e.g. "Task · In review". */
  detail: string
  href: string
  /** When it last moved or was last opened, epoch ms. */
  at: number
}

export interface HomeActivity {
  /** The person has done something here: Home shows what is happening instead of where to start. */
  hasWork: boolean
  /** The board, as the person would count it. Bakin's own Health tasks are left out. `unknown` when the board could not be read. */
  tasks: { planned: number; inProgress: number; completed: number; blocked: number } | 'unknown'
  /** How many projects there are; null when the Projects plugin is not installed, `unknown` when it could not be read. */
  projects: number | null | 'unknown'
  /** Scheduled jobs, and how many runs fall in the coming week; `unknown` when the schedule could not be read. */
  scheduled: { jobs: number; comingUp: number } | 'unknown'
  pickUp: PickUpItem[]
}

/** "Recently" and "coming up" both mean a week. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const PICK_UP_LIMIT = 5

/** Every column whose tasks count as recent activity, with how each is described. */
const RECENT_COLUMNS = [['backlog', 'Planned'], ['todo', 'Planned'], ['inProgress', 'In progress'], ['review', 'Waiting on you'], ['blocked', 'Blocked'], ['done', 'Completed']] as const

const mine = (tasks: BoardTask[] | undefined): BoardTask[] => (tasks ?? []).filter((task) => task.createdBy !== 'system')

/**
 * What the pages answered. `unknown` is a page that could not answer: Home
 * says so instead of showing a zero it does not know to be true.
 */
export interface ActivitySources {
  columns: BoardColumns | 'unknown'
  chats: readonly ChatRow[] | 'unknown'
  occurrences: readonly Occurrence[] | 'unknown'
  /** Scheduled jobs. */
  jobs: number | 'unknown'
  /** Projects; null when the plugin is not installed. */
  projects: number | null | 'unknown'
}

export function summarizeActivity(input: ActivitySources, now: number): HomeActivity {
  const columns: BoardColumns = input.columns === 'unknown' ? {} : input.columns
  const chats = input.chats === 'unknown' ? [] : input.chats
  const recent = RECENT_COLUMNS.flatMap(([column, label]) => mine(columns[column]).map((task) => ({ task, label })))
  const anyTask = (Object.values(columns) as BoardTask[][]).some((tasks) => mine(tasks).length > 0)

  const pickUp: PickUpItem[] = [
    ...recent.map(({ task, label }): PickUpItem => ({
      key: `task:${task.id}`, kind: 'task', title: task.title, detail: `Task · ${label}`,
      href: `/tasks?taskId=${encodeURIComponent(task.id)}`, at: task.updatedAt ?? 0,
    })),
    ...chats.map((chat): PickUpItem => ({
      key: `chat:${chat.id}`, kind: 'chat', title: chat.title, detail: chat.lastMessagePreview ? `Chat · ${chat.lastMessagePreview}` : 'Chat',
      // The later of its last message and the last time the person opened it.
      href: `/chat/${encodeURIComponent(chat.id)}`, at: Math.max(Date.parse(chat.updatedAt) || 0, Date.parse(chat.lastSeenAt ?? '') || 0),
    })),
  ].sort((a, b) => b.at - a.at).slice(0, PICK_UP_LIMIT)

  const { occurrences, jobs } = input
  return {
    hasWork: chats.length > 0 || anyTask,
    tasks: input.columns === 'unknown' ? 'unknown' : {
      planned: mine(columns.backlog).length + mine(columns.todo).length,
      inProgress: mine(columns.inProgress).length + mine(columns.review).length,
      completed: mine(columns.done).length,
      blocked: mine(columns.blocked).length,
    },
    projects: input.projects,
    scheduled: jobs === 'unknown' || occurrences === 'unknown' ? 'unknown' : {
      jobs,
      comingUp: occurrences.filter((occurrence) => {
        const at = Date.parse(occurrence.at)
        return !occurrence.past && Number.isFinite(at) && at >= now && at - now < WEEK_MS
      }).length,
    },
    pickUp,
  }
}

/** A page's answer: its value, `absent` when the page is not there (404), `unknown` when it could not answer. */
async function read<T>(url: string, pick: (body: Record<string, unknown>) => T): Promise<T | 'absent' | 'unknown'> {
  try {
    const res = await fetch(url)
    if (res.status === 404) return 'absent'
    if (!res.ok) return 'unknown'
    return pick(await res.json() as Record<string, unknown>)
  } catch {
    // Unreachable, timed out, or not JSON: Home says it could not tell, never zero.
    return 'unknown'
  }
}

/** Not there is the same as could not answer, for a page Home always has. */
const known = <T,>(answer: T | 'absent' | 'unknown'): T | 'unknown' => (answer === 'absent' ? 'unknown' : answer)

/** The activity summary, or null until the first read. Looks again when a chat turn finishes; every visit to Home reads afresh. */
export function useHomeActivity(enabled: boolean): HomeActivity | null {
  const [activity, setActivity] = useState<HomeActivity | null>(null)
  const load = useCallback(async () => {
    const now = Date.now()
    const [columns, chats, occurrences, jobs, projects] = await Promise.all([
      read('/api/plugins/tasks/', (body) => (body.columns ?? {}) as BoardColumns),
      read('/api/plugins/chat/chats', (body) => (Array.isArray(body.chats) ? body.chats : []) as ChatRow[]),
      read(
        `/api/plugins/schedule/occurrences?from=${encodeURIComponent(new Date(now).toISOString())}&to=${encodeURIComponent(new Date(now + WEEK_MS).toISOString())}`,
        (body) => (Array.isArray(body.occurrences) ? body.occurrences : []) as Occurrence[],
      ),
      read('/api/plugins/schedule/', (body) => (Array.isArray(body.jobs) ? body.jobs.length : 0)),
      read('/api/plugins/projects/', (body) => (Array.isArray(body.projects) ? body.projects.length : 0)),
    ])
    setActivity(summarizeActivity({
      columns: known(columns), chats: known(chats), occurrences: known(occurrences), jobs: known(jobs),
      // A missing Projects plugin answers 404: that is "not installed", not "could not tell".
      projects: projects === 'absent' ? null : projects,
    }, now))
  }, [])
  useEffect(() => { if (enabled) void load() }, [enabled, load])
  usePluginEvent('chat.done', () => { if (enabled) void load() })
  return enabled ? activity : null
}
