'use client'

import { useState, useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import { useActivityContext } from '@/context/activity-context'
import { useContentStore } from '@/hooks/use-content-store'

const AGENT_EMOJI: Record<string, string> = {
  roscoe: '🐾',
  basil: '🥗',
  pixel: '🖼️',
  rolo: '🎬',
  patch: '⚙️',
  scout: '🔭',
  watchdog: '🐕',
  dashboard: '📊',
  api: '🔌',
  system: '⚡',
  workflow: '🔀',
  dispatch: '📡',
}

const AGENT_COLOR: Record<string, string> = {
  roscoe: 'text-blue-400',
  basil: 'text-green-400',
  pixel: 'text-violet-400',
  rolo: 'text-orange-400',
  patch: 'text-zinc-400',
  scout: 'text-amber-400',
  watchdog: 'text-yellow-400',
  dashboard: 'text-cyan-400',
  api: 'text-teal-400',
  system: 'text-slate-400',
  workflow: 'text-cyan-400',
  dispatch: 'text-emerald-400',
}

/** Normalize agent IDs for display — "main" is the roscoe process */
const DISPLAY_AGENT: Record<string, string> = {
  main: 'system',
}

/** Non-agent sources that will never have a headshot image */
const SYSTEM_SOURCES = new Set(['system', 'workflow', 'dispatch', 'watchdog', 'dashboard', 'api'])

function AgentAvatar({ agent, size = 24 }: { agent: string; size?: number }) {
  const [imgError, setImgError] = useState(false)
  const sizeClass = size === 24 ? 'size-6' : 'size-8'

  if (!imgError && !SYSTEM_SOURCES.has(agent)) {
    return (
      <img
        src={`/headshots/${agent}.png`}
        alt={agent}
        onError={() => setImgError(true)}
        className={`${sizeClass} rounded-full object-cover object-top ring-1 ring-zinc-700/50 shrink-0`}
      />
    )
  }
  return (
    <span className={`${sizeClass} rounded-full bg-zinc-800 flex items-center justify-center text-xs shrink-0`}>
      {AGENT_EMOJI[agent] || '❓'}
    </span>
  )
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (isNaN(diff) || diff < 0) return 'just now'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ActivityFeed() {
  const { open, toggle } = useActivityContext()
  const events = useContentStore((s) => s.activityEvents)
  const connected = useContentStore((s) => s.sseConnected)
  const [, setTick] = useState(0)

  // Force re-render every 30s to keep relative timestamps fresh
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      {/* Collapsed toggle tab — always visible */}
      {!open && (
        <button
          onClick={toggle}
          className="fixed right-0 top-[calc(50%+28px)] -translate-y-1/2 z-50 flex w-8 flex-col items-center justify-center gap-2 py-4 rounded-l-md border border-r-0 border-border bg-zinc-900/95 backdrop-blur-sm transition-colors hover:bg-zinc-800"
        >
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-zinc-500'}`} />
          <span className="text-[10px] font-medium text-zinc-400 [writing-mode:vertical-lr]">
            Live Activity
          </span>
        </button>
      )}

      {/* Full-height panel */}
      <div
        className="flex w-[360px] h-full flex-col bg-background"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-zinc-500'}`} />
            <span className="text-sm font-medium text-zinc-200">Live Activity</span>
          </div>
          <button
            onClick={toggle}
            className="text-zinc-400 hover:text-zinc-200 transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.06)]"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto py-1 flex flex-col">
          {events.length === 0 && (
            <p className="text-xs text-zinc-500 text-center mt-8">No activity yet</p>
          )}
          {events.map((evt, i) => (
            <div
              key={`${evt.id}-${i}`}
              className={`flex gap-2.5 px-3 py-2.5 hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/60 last:border-0 ${
                evt.type === 'alert' ? 'bg-amber-950/20' : ''
              }`}
            >
              <AgentAvatar agent={DISPLAY_AGENT[evt.agent] ?? evt.agent} size={24} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1.5 mb-0.5">
                  <span className={`text-[11px] font-medium ${AGENT_COLOR[DISPLAY_AGENT[evt.agent] ?? evt.agent] ?? 'text-slate-400'}`}>
                    {DISPLAY_AGENT[evt.agent] ?? evt.agent}
                  </span>
                  <span className="text-zinc-500 text-[10px] shrink-0 tabular-nums">{relativeTime(evt.ts)}</span>
                </div>
                {evt.taskTitle && evt.type === 'log' && (
                  <p className="text-[10px] text-zinc-500 mb-0.5 truncate">{evt.taskTitle}</p>
                )}
                <p className={`text-[12px] leading-snug break-words ${
                  evt.type === 'alert' ? 'text-amber-400' : 'text-zinc-300'
                }`}>{evt.message}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
