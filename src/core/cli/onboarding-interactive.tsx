import { render } from 'ink'
import { useState } from 'react'
import {
  MultiSelect,
  createMultiSelectState,
  type MultiSelectItem,
  type MultiSelectState,
} from './ui/multi-select'
import { recommendedAgentsComponent } from '../onboarding/recommended-agents'
import { recommendedPluginsComponent } from '../onboarding/recommended-plugins'
import { runtimeComponent } from '../onboarding/runtime'
import type { CheckResult, OnboardingOptions } from '../onboarding/types'

interface CatalogChoice {
  id: string
  name?: string
  description?: string
  defaultSelected?: boolean
}

export interface OnboardingSelections {
  selectedRecommendedPluginIds?: readonly string[]
  selectedRecommendedAgentIds?: readonly string[]
}

function choicesFromCheck(check: CheckResult): CatalogChoice[] {
  const available = check.details?.available
  if (!Array.isArray(available)) return []
  return available
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map(entry => ({
      id: String(entry.id ?? ''),
      name: typeof entry.name === 'string' ? entry.name : undefined,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      defaultSelected: entry.defaultSelected === true,
    }))
    .filter(choice => choice.id.length > 0)
}

function missingIdsFromCheck(check: CheckResult): Set<string> {
  const missing = check.details?.missing
  if (!Array.isArray(missing)) return new Set()
  return new Set(missing.filter((id): id is string => typeof id === 'string' && id.length > 0))
}

export function buildSelectionItems(check: CheckResult): MultiSelectItem[] {
  const missing = missingIdsFromCheck(check)
  return choicesFromCheck(check).map(choice => ({
    id: choice.id,
    label: choice.name ?? choice.id,
    description: choice.description,
    selected: missing.has(choice.id) && choice.defaultSelected === true,
    disabled: !missing.has(choice.id),
    note: missing.has(choice.id) ? undefined : 'installed',
  }))
}

function MultiSelectPrompt({ title, items, onSubmit }: {
  title: string
  items: MultiSelectItem[]
  onSubmit: (ids: string[]) => void
}) {
  const [state, setState] = useState<MultiSelectState>(() => createMultiSelectState(items))
  return <MultiSelect title={title} items={items} state={state} onChange={setState} onSubmit={onSubmit} />
}

export async function promptMultiSelect(title: string, items: MultiSelectItem[]): Promise<string[]> {
  if (items.filter(item => !item.disabled).length === 0) return []

  return await new Promise((resolve) => {
    let app: ReturnType<typeof render> | null = null
    app = render(
      <MultiSelectPrompt
        title={title}
        items={items}
        onSubmit={(ids) => {
          app?.unmount()
          resolve(ids)
        }}
      />,
    )
  })
}

export async function collectOnboardingSelections(opts: Pick<OnboardingOptions, 'interactive' | 'autoApprove' | 'json' | 'checkOnly'>): Promise<OnboardingSelections> {
  if (!opts.interactive || opts.autoApprove || opts.json || opts.checkOnly) return {}

  const runtime = await runtimeComponent.check()
  if (runtime.status !== 'ok') return {}

  const pluginCheck = await recommendedPluginsComponent.check()
  const agentCheck = await recommendedAgentsComponent.check()

  const selectedRecommendedPluginIds = pluginCheck.status === 'missing'
    ? await promptMultiSelect('Install official plugins', buildSelectionItems(pluginCheck))
    : undefined
  const selectedRecommendedAgentIds = agentCheck.status === 'missing'
    ? await promptMultiSelect('Install official agents', buildSelectionItems(agentCheck))
    : undefined

  return {
    selectedRecommendedPluginIds,
    selectedRecommendedAgentIds,
  }
}
