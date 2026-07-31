'use client'

/**
 * Shared "Stale" attention chip for canvas nodes whose step references a
 * stale workflow skill. One implementation so the drift signal reads the
 * same on agent, parallel, and output nodes.
 */
export function StaleSkillChip({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-bakin-control border border-bakin-signal-highlight/35 bg-bakin-signal-highlight/10 px-1.5 py-0.5 text-bakin-typography-size-meta font-bakin-typography-weight-medium leading-none text-bakin-signal-highlight"
      title={title}
    >
      {children}
    </span>
  )
}
