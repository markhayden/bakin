'use client'

/**
 * MemoryShell — layout frame for /memory.
 *
 * Agent picker (left) + tier tab bar (top) + content area (center).
 * The content area is empty until per-tier commits (C3–C8) mount the
 * real feeds. Ships intentionally bare so C2 can activate the new
 * plugin shell without depending on tier-specific UI.
 */
import { Suspense } from 'react'

export function MemoryShell() {
  return (
    <Suspense fallback={null}>
      <div className="flex h-full flex-col gap-4 p-6">
        <header>
          <h1 className="text-2xl font-semibold">Memory</h1>
          <p className="text-sm text-muted-foreground">
            Observability over every memory tier — sessions, turns, checkpoints,
            daily notes, dreams, durable bootstrap files, and Bakin&rsquo;s audit log.
          </p>
        </header>

        <div className="rounded-md border border-dashed border-muted-foreground/30 p-8 text-center text-sm text-muted-foreground">
          Tier UI ships in subsequent commits. Global search already indexes
          whatever the indexer has backfilled so far.
        </div>
      </div>
    </Suspense>
  )
}
