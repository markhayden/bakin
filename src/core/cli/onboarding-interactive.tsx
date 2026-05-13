import { Badge, ConfirmInput } from '@inkjs/ui'
import { render, renderToString, Box, Text } from 'ink'
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
import { searchComponent } from '../onboarding/search'
import { searchModelsComponent } from '../onboarding/search-models'
import { mcporterComponent } from '../onboarding/mcporter'
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
  approvedComponents?: readonly string[]
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
  return <MultiSelect title={title} items={items} state={state} onChange={setState} onSubmit={onSubmit} marginTop={1} />
}

function ConfirmStep({ title, description, defaultChoice, onSubmit }: {
  title: string
  description: string
  defaultChoice: 'confirm' | 'cancel'
  onSubmit: (approved: boolean) => void
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Badge color="#ff2bd6">{title}</Badge>
      <Text dimColor>{description}</Text>
      <Box marginTop={1}>
        <Text>Continue? </Text>
        <ConfirmInput
          defaultChoice={defaultChoice}
          onConfirm={() => onSubmit(true)}
          onCancel={() => onSubmit(false)}
        />
      </Box>
    </Box>
  )
}

function OnboardingIntro() {
  return (
    <Box flexDirection="column">
      <Text color="#ff2bd6" bold>oooooooooo.            oooo         o8o              o8o </Text>
      <Text color="#ff2bd6" bold>`888'   `Y8b           `888         `"'              `YP </Text>
      <Text color="#ff2bd6" bold> 888     888  .oooo.    888  oooo  oooo  ooo. .oo.    '  </Text>
      <Text color="#ff2bd6" bold> 888oooo888' `P  )88b   888 .8P'   `888  `888P"Y88b      </Text>
      <Text color="#ff2bd6" bold> 888    `88b  .oP"888   888888.     888   888   888      </Text>
      <Text color="#ff2bd6" bold> 888    .88P d8(  888   888 `88b.   888   888   888      </Text>
      <Text color="#ff2bd6" bold>o888bood8P'  `Y888""8o o888o o888o o888o o888o o888o     </Text>
      <Text dimColor>
        This wizard will walk you through the initial Bakin setup. You will choose official plugins and agents,
        approve required local dependencies, and then Bakin will run the setup steps with live progress.
      </Text>
      <Text dimColor>
        You can decline optional installs and rerun `bakin onboard` later.
      </Text>
    </Box>
  )
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

async function promptConfirm(title: string, description: string, defaultChoice: 'confirm' | 'cancel' = 'confirm'): Promise<boolean> {
  return await new Promise((resolve) => {
    let app: ReturnType<typeof render> | null = null
    app = render(
      <ConfirmStep
        title={title}
        description={description}
        defaultChoice={defaultChoice}
        onSubmit={(approved) => {
          app?.unmount()
          resolve(approved)
        }}
      />,
    )
  })
}

export async function collectOnboardingSelections(opts: Pick<OnboardingOptions, 'interactive' | 'autoApprove' | 'json' | 'checkOnly'>): Promise<OnboardingSelections> {
  if (!opts.interactive || opts.autoApprove || opts.json || opts.checkOnly) return {}

  const runtime = await runtimeComponent.check()
  if (runtime.status !== 'ok') return {}

  const searchCheck = await searchComponent.check()
  const searchModelsCheck = await searchModelsComponent.check()
  const mcporterCheck = await mcporterComponent.check()
  const pluginCheck = await recommendedPluginsComponent.check()
  const agentCheck = await recommendedAgentsComponent.check()
  const hasWizardSteps = [searchCheck, searchModelsCheck, mcporterCheck, pluginCheck, agentCheck].some(check => check.status === 'missing' || check.status === 'broken')
  if (hasWizardSteps) {
    console.log(renderToString(<OnboardingIntro />))
  }

  const approvedComponents: string[] = []
  const selectedRecommendedPluginIds = pluginCheck.status === 'missing'
    ? await promptMultiSelect('Install official plugins', buildSelectionItems(pluginCheck))
    : undefined
  const selectedRecommendedAgentIds = agentCheck.status === 'missing'
    ? await promptMultiSelect('Install official agents', buildSelectionItems(agentCheck))
    : undefined

  const searchNeedsInstall = searchCheck.status === 'missing' || searchCheck.status === 'broken'
  const searchApproved = searchNeedsInstall
    ? await promptConfirm(
      'Search adapter',
      `${searchCheck.message}. Bakin will install Antfly via Homebrew if you continue.`,
      'confirm',
    )
    : true
  if (searchNeedsInstall && searchApproved) approvedComponents.push('search')

  if (searchApproved && (searchModelsCheck.status === 'missing' || searchModelsCheck.status === 'broken')) {
    const approved = await promptConfirm(
      'Search models',
      `${searchModelsCheck.message}. Bakin will download the required Termite models if you continue.`,
      'confirm',
    )
    if (approved) approvedComponents.push('search-models')
  }

  if (mcporterCheck.status === 'missing' || mcporterCheck.status === 'broken') {
    const approved = await promptConfirm(
      'MCP porter',
      `${mcporterCheck.message}. Bakin will install and configure mcporter if you continue.`,
      'confirm',
    )
    if (approved) approvedComponents.push('mcporter')
  }

  return {
    selectedRecommendedPluginIds,
    selectedRecommendedAgentIds,
    approvedComponents,
  }
}
