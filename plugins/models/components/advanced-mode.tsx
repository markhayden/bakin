'use client'

/**
 * The Advanced view (spec §3.4): three tabs over the same draft Simple
 * edits — Overview (default model, the recommendation, what is in use, the
 * runtime-gated extras), Agents (per-agent overrides grouped by team) and
 * Work routing (a model + thinking level per kind of work, tag overrides).
 * Every edit stages an op; the page's one SaveBar writes. The active tab
 * rides `?tab=` so a shared link opens the same section.
 */
import type { ReactNode } from 'react'
import { useQueryState } from '@makinbakin/sdk/navigation'
import type { ModelSelectOption } from '@makinbakin/sdk/patterns'
import { Tabs, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'

import { AdvancedAgents } from './advanced-agents'
import { AdvancedOverview } from './advanced-overview'
import { AdvancedRouting } from './advanced-routing'
import type { SelectionsData } from './use-selections'

export interface AdvancedModeProps {
  sel: SelectionsData
  modelOptions: readonly ModelSelectOption[]
  /** Rendered under the Overview tab only (the model catalog) — dead weight on Agents / Work routing. */
  overviewFooter?: ReactNode
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'routing', label: 'Work routing' },
] as const
type TabId = (typeof TABS)[number]['id']

/** A `?ref=` deep link lands on the tab that owns the ref. */
function tabForRef(ref: string | null): TabId | null {
  if (!ref) return null
  if (ref.startsWith('agent:')) return 'agents'
  if (ref.startsWith('route:') || ref.startsWith('tag:')) return 'routing'
  return 'overview'
}

export function AdvancedMode({ sel, modelOptions, overviewFooter }: AdvancedModeProps) {
  const [tabParam, setTab] = useQueryState('tab', 'overview')
  const requested = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'overview'
  const tab: TabId = tabForRef(sel.highlightRef) ?? requested

  return (
    // The panel is rendered by hand (like the Spend page) rather than with
    // Base UI's TabsContent, whose focusable panel carries no focus ring.
    <div className="flex min-w-0 flex-col gap-bakin-6">
      <Tabs value={tab} onValueChange={(next) => setTab(next === 'overview' ? '' : next)}>
        <TabsList variant="underline" activateOnFocus aria-label="Advanced model settings">
          {TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id} id={`models-advanced-tab-${item.id}`} aria-controls={`models-advanced-panel-${item.id}`}>{item.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div id={`models-advanced-panel-${tab}`} role="tabpanel" aria-labelledby={`models-advanced-tab-${tab}`} className="min-w-0">
        {tab === 'overview' ? (
          <div className="flex min-w-0 flex-col gap-bakin-8">
            <AdvancedOverview sel={sel} modelOptions={modelOptions} />
            {overviewFooter}
          </div>
        ) : null}
        {tab === 'agents' ? <AdvancedAgents sel={sel} modelOptions={modelOptions} /> : null}
        {tab === 'routing' ? <AdvancedRouting sel={sel} modelOptions={modelOptions} /> : null}
      </div>
    </div>
  )
}
