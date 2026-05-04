'use client'

import { Badge } from '@bakin/sdk/ui'

/**
 * Visual badge for an agent's agent-package state. Five states map to
 * five color variants so the team grid surfaces install status at a
 * glance.
 *
 *   unmanaged          gray   — exists in runtime, no Bakin tracking
 *   adopted            blue   — package attached, workspace files preserved
 *   managed            green  — fully package-managed
 *   drifted            yellow — projection sha mismatch (warn from doctor)
 *   update-available   orange — newer version of the source pkg published
 */

export type PackageState =
  | 'absent'
  | 'unmanaged'
  | 'adopted'
  | 'managed'
  | 'drifted'
  | 'update-available'

export interface PackageStateBadgeProps {
  state: PackageState
  /** Optional package id — shown in a secondary line under the badge */
  packageId?: string
  /** Hover tooltip override; defaults to a state-specific explainer */
  title?: string
  /**
   * Compact mode — drops the text label, renders a small colored pill.
   * For cramped contexts like the agent grid card. Tooltip is preserved
   * so the user can still read the state on hover.
   */
  compact?: boolean
}

const STATE_STYLES: Record<PackageState, { label: string; cls: string; tip: string }> = {
  absent: {
    label: 'absent',
    cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
    tip: 'No runtime entry and no package tracking.',
  },
  unmanaged: {
    label: 'unmanaged',
    cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
    tip: 'Exists in the active runtime but no Bakin agent-package tracks it. Install or adopt to enable lessons / project asset management.',
  },
  adopted: {
    label: 'adopted',
    cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    tip: 'Package attached to an existing runtime agent. Bakin manages lesson markers + projected assets but never touches the workspace template files.',
  },
  managed: {
    label: 'managed',
    cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    tip: 'Agent fully package-managed. Workspace files were seeded from the package template; lessons + assets project from the package source.',
  },
  drifted: {
    label: 'drifted',
    cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    tip: 'Projection sha mismatch detected. Run `bakin install agent-assets` to repair, or set `.userEdited` to lock the file.',
  },
  'update-available': {
    label: 'update available',
    cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
    tip: 'Source repo has moved past the recorded commit. Run `bakin agents update` to pull.',
  },
}

export function PackageStateBadge({ state, packageId, title, compact }: PackageStateBadgeProps) {
  const style = STATE_STYLES[state]
  if (compact) {
    return (
      <span
        title={title ?? `${style.label} — ${style.tip}`}
        aria-label={`Package state: ${style.label}`}
        data-state={state}
        className={`inline-block size-2 rounded-full ${style.cls}`}
      />
    )
  }
  return (
    <span title={title ?? style.tip} className="inline-flex items-center gap-2">
      <Badge className={style.cls} variant="secondary">
        {style.label}
      </Badge>
      {packageId && state !== 'unmanaged' && state !== 'absent' && (
        <span className="text-xs text-muted-foreground">[{packageId}]</span>
      )}
    </span>
  )
}
