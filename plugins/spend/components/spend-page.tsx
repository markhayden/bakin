'use client'

import { Suspense } from 'react'
import { useQueryState } from '@makinbakin/sdk/navigation'
import { Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { SystemState, Tabs, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'
import type { SpendTab } from '../types'

const TABS: Array<{ id: SpendTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'limits', label: 'Limits' },
]

/**
 * /spend — Overview (what you spend) and Limits (opt-in caps). Pattern:
 * storybook/public/recipes/settings-dashboard-pages — DashboardOverview /
 * SettingsCategories. Tab state rides the URL (`?tab=`), default overview.
 */
export function SpendPage() {
  const [tabParam, setTab] = useQueryState('tab')
  const tab: SpendTab = tabParam === 'limits' ? 'limits' : 'overview'

  return (
    <Page>
      <PageHeader
        title="Spend"
        description="What your agents spend, observed and projected — and the limits you choose to set once you know what normal looks like."
      />

      <Tabs value={tab} onValueChange={(id) => setTab(id === 'overview' ? null : id)}>
        <TabsList variant="underline" activateOnFocus aria-label="Spend sections">
          {TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id} id={`spend-tab-${item.id}`} aria-controls={`spend-panel-${item.id}`}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <PageBody id={`spend-panel-${tab}`} role="tabpanel" aria-labelledby={`spend-tab-${tab}`}>
        <Suspense>
          {tab === 'overview' ? (
            <SystemState kind="initial-empty" title="Spend overview arrives with the next step" description="Analytics move here from Models → Spend in the ownership cutover." />
          ) : (
            <SystemState kind="initial-empty" title="No spending limits" description="Bakin records everything; set a limit once you know what normal looks like." />
          )}
        </Suspense>
      </PageBody>
    </Page>
  )
}
