'use client'

/**
 * Advanced › Agents: one sortable table of every agent — Agent | Team |
 * Model | Subagents (when the runtime manages them). The main agent leads
 * by default; Agent and Team sort. Opens with plain-words guidance — most
 * agents should stay on the default; pin a model only where one agent's
 * work is different enough to earn it.
 */
import { Users } from 'lucide-react'
import { useAgent, useAgentColor, useAgentStore, useMainAgentId } from '@makinbakin/sdk/hooks'
import { Stack } from '@makinbakin/sdk/layout'
import { AgentAvatar, DEFAULT_MODEL_VALUE, DataTable, GuideCard, ModelSelect, type DataTableColumn, type ModelSelectOption } from '@makinbakin/sdk/patterns'
import { Badge, SystemState, Text } from '@makinbakin/sdk/ui'

import { agentRows, type AgentRow } from '../lib/advanced'
import { StagedMark } from './advanced-shared'
import { PendingChip, SelectionCallout } from './selection-callout'
import { useDeepLinkFocus } from './use-deep-link-focus'
import type { SelectionsData } from './use-selections'

export interface AdvancedAgentsProps {
  sel: SelectionsData
  modelOptions: readonly ModelSelectOption[]
  /**
   * Per-agent picker options: an agent's pins are validated under ITS
   * credentials, so its row disables by that verdict (#907 review). Falls
   * back to the install-wide options until the scoped read lands.
   */
  agentModelOptions?: (agentId: string) => readonly ModelSelectOption[]
}

/** Supplies registered-agent identity (headshot, color) to the presentation avatar. */
function OverrideAgentAvatar({ agentId, name }: { agentId: string; name: string }) {
  const agent = useAgent(agentId)
  const color = useAgentColor(agentId)
  return (
    <AgentAvatar
      agent={{ id: agentId, name, imageSrc: agent?.headshot || undefined, color: agent ? color : undefined }}
      size="sm"
      decorative
    />
  )
}

export function AdvancedAgents({ sel, modelOptions, agentModelOptions }: AdvancedAgentsProps) {
  const optionsFor = (agentId: string) => agentModelOptions?.(agentId) ?? modelOptions
  const selections = sel.selections
  const states = selections?.states ?? []
  const support = selections?.support
  const teams = useAgentStore((s) => s.teams)
  const displaySettings = useAgentStore((s) => s.displaySettings)
  const mainAgentId = useMainAgentId()
  const agent = sel.effective('policy:defaultModel')
  const rows = [...agentRows(states)]
  const highlight = sel.highlightRef
  useDeepLinkFocus(sel, rows.length > 0)

  // Default order: the main agent (the orchestrator) first, then the
  // roster's team order, then name. Column sorts (Agent, Team) take over
  // from here — the table self-sorts.
  const teamRank = new Map([...teams].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label)).map((t, i) => [t.id, i]))
  const teamOf = (row: AgentRow) => teams.find((t) => t.id === displaySettings[row.agentId]?.teamId) ?? null
  rows.sort((a, b) => {
    if (a.agentId === mainAgentId) return -1
    if (b.agentId === mainAgentId) return 1
    const ta = teamOf(a); const tb = teamOf(b)
    const ra = ta ? teamRank.get(ta.id) ?? 0 : Number.MAX_SAFE_INTEGER
    const rb = tb ? teamRank.get(tb.id) ?? 0 : Number.MAX_SAFE_INTEGER
    return ra - rb || a.name.localeCompare(b.name)
  })
  const pinned = rows.filter((r) => sel.effective(r.modelRef).model).length

  // One header row per table, like Work routing — never a label on every row.
  const columns: ReadonlyArray<DataTableColumn<AgentRow, 'agent' | 'team'>> = [
    {
      key: 'agent',
      header: 'Agent',
      sortable: true,
      sortValue: (row) => row.name,
      cellClassName: 'whitespace-normal align-top',
      cell: (row) => {
        const own = sel.effective(row.modelRef)
        return (
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
              <OverrideAgentAvatar agentId={row.agentId} name={row.name} />
              <span className="min-w-0 truncate font-bakin-typography-weight-semibold text-bakin-text-primary">{row.name}</span>
              <Badge tone={own.model ? 'accent' : 'neutral'} variant="soft" size="xs">
                {own.model ? 'own model' : 'default'}
              </Badge>
              <StagedMark staged={own.staged} />
              <PendingChip sel={sel} refName={row.modelRef} />
            </div>
            <SelectionCallout sel={sel} refName={row.modelRef} />
            <SelectionCallout sel={sel} refName={row.subagentRef} />
          </div>
        )
      },
    },
    {
      key: 'team',
      header: 'Team',
      sortable: true,
      sortValue: (row) => teamOf(row)?.label ?? null,
      cellClassName: 'align-top',
      cell: (row) => {
        const team = teamOf(row)
        return team ? <span data-agent-team={team.id}>{team.label}</span> : <Text as="span" size="meta" tone="muted">—</Text>
      },
    },
    {
      key: 'model',
      header: 'Model',
      cellClassName: 'align-top',
      cell: (row) => (
        <div className="min-w-0" data-selection-ref={row.modelRef}>
          <ModelSelect
            id={`agent-${row.agentId}-model`}
            value={sel.effective(row.modelRef).model ?? DEFAULT_MODEL_VALUE}
            onValueChange={(value) => sel.stage(row.modelRef, { model: value === DEFAULT_MODEL_VALUE ? null : value })}
            models={optionsFor(row.agentId)}
            defaultLabel={`Use default model${agent.model ? ` (${agent.model})` : ''}`}
            ariaLabel={`${row.name} model`}
            className="w-full min-w-0"
          />
        </div>
      ),
    },
    ...(support?.perAgentSubagentModel
      ? [{
          key: 'subagents',
          header: 'Subagents',
          cellClassName: 'align-top',
          cell: (row: AgentRow) => {
            const sub = sel.effective(row.subagentRef)
            return (
              <div className="min-w-0" data-selection-ref={row.subagentRef}>
                <ModelSelect
                  id={`agent-${row.agentId}-subagent`}
                  value={sub.model ?? DEFAULT_MODEL_VALUE}
                  onValueChange={(value) => sel.stage(row.subagentRef, { model: value === DEFAULT_MODEL_VALUE ? null : value })}
                  models={optionsFor(row.agentId)}
                  defaultLabel="Use default subagent model"
                  ariaLabel={`${row.name} subagents`}
                  className="w-full min-w-0"
                />
                {sub.staged ? <div className="mt-bakin-1"><StagedMark staged /></div> : null}
              </div>
            )
          },
        } satisfies DataTableColumn<AgentRow, 'agent' | 'team'>]
      : []),
  ]

  return (
    <Stack gap="section">
      <GuideCard
        icon={Users}
        title="Give one agent a different model"
        lead={`Every agent runs on the default model${agent.model ? ` (${agent.model})` : ''} unless you override it here. ${pinned === 0 ? 'Nothing is overridden right now.' : `${pinned} of ${rows.length} agent${rows.length === 1 ? '' : 's'} ${pinned === 1 ? 'has' : 'have'} an override.`}`}
        points={[
          { heading: 'Leave most agents on the default', body: 'One default keeps behavior predictable and provider switches painless. Override only where the work is genuinely different.' },
          { heading: 'Pin up for hard work, down for volume', body: 'A strategist or reviewer may earn a premium model; a triage or monitoring agent that runs constantly is where a budget model pays off.' },
          { heading: 'Subagents are a separate dial', body: 'Where the runtime supports it, an agent that delegates can send its helpers to a lighter model without changing what it uses itself.' },
        ]}
      />

      {rows.length === 0 ? (
        <SystemState kind="initial-empty" scope="section" title="No agents configured" description="Agents appear here once the runtime reports its roster." />
      ) : (
        <DataTable
          label="Agent models"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.agentId}
          rowProps={(row) => ({ 'data-agent-model-row': row.agentId })}
          rowSelected={(row) => highlight === row.modelRef || highlight === row.subagentRef}
        />
      )}
      {rows.length > 0 && !support?.perAgentSubagentModel ? (
        <Text size="meta" tone="muted">The active runtime doesn&apos;t manage per-agent subagent models.</Text>
      ) : null}
    </Stack>
  )
}
