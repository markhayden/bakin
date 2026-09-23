'use client'

/**
 * Advanced › Agents: per-agent overrides, grouped by team when the roster
 * defines teams. Opens with plain-words guidance — most agents should stay
 * on the default; pin a model only where one agent's work is different
 * enough to earn it.
 */
import { Users } from 'lucide-react'
import { useAgent, useAgentColor, useAgentStore, useMainAgentId } from '@makinbakin/sdk/hooks'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { AgentAvatar, DEFAULT_MODEL_VALUE, DataTable, ModelSelect, type DataTableColumn, type ModelSelectOption } from '@makinbakin/sdk/patterns'
import { Badge, SystemState, Text } from '@makinbakin/sdk/ui'

import { agentRows, type AgentRow } from '../lib/advanced'
import { GuideCard } from '@makinbakin/sdk/patterns'
import { StagedMark } from './advanced-shared'
import { PendingChip, SelectionCallout } from './selection-callout'
import type { SelectionsData } from './use-selections'

export interface AdvancedAgentsProps {
  sel: SelectionsData
  modelOptions: readonly ModelSelectOption[]
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

interface TeamGroup {
  id: string
  label: string
  rows: AgentRow[]
}

export function AdvancedAgents({ sel, modelOptions }: AdvancedAgentsProps) {
  const selections = sel.selections
  const states = selections?.states ?? []
  const support = selections?.support
  const teams = useAgentStore((s) => s.teams)
  const displaySettings = useAgentStore((s) => s.displaySettings)
  const mainAgentId = useMainAgentId()
  const agent = sel.effective('policy:defaultModel')
  // The main agent (the orchestrator) always leads: first row of the first group.
  const rows = [...agentRows(states)].sort((a, b) => Number(b.agentId === mainAgentId) - Number(a.agentId === mainAgentId))
  const highlight = sel.highlightRef

  // Group by the roster's teams (team order, then label); agents without a
  // team come last so the org structure reads top-down.
  const orderedTeams = [...teams].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label))
  const groups: TeamGroup[] = orderedTeams
    .map((team) => ({ id: team.id, label: team.label, rows: rows.filter((r) => displaySettings[r.agentId]?.teamId === team.id) }))
    .filter((g) => g.rows.length > 0)
  const teamed = new Set(groups.flatMap((g) => g.rows.map((r) => r.agentId)))
  const rest = rows.filter((r) => !teamed.has(r.agentId))
  if (rest.length > 0) groups.push({ id: '__none', label: groups.length > 0 ? 'Not on a team' : 'Agents', rows: rest })
  groups.sort((a, b) => Number(b.rows.some((r) => r.agentId === mainAgentId)) - Number(a.rows.some((r) => r.agentId === mainAgentId)))
  const pinned = rows.filter((r) => sel.effective(r.modelRef).model).length

  // One header row per table, like Work routing — never a label on every row.
  const columns: ReadonlyArray<DataTableColumn<AgentRow>> = [
    {
      key: 'agent',
      header: 'Agent',
      cellClassName: 'whitespace-normal align-top',
      cell: (row) => {
        const own = sel.effective(row.modelRef)
        return (
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
              <OverrideAgentAvatar agentId={row.agentId} name={row.name} />
              <span className="min-w-0 truncate font-bakin-typography-weight-semibold text-bakin-text-primary">{row.name}</span>
              <Badge tone={own.model ? 'accent' : 'neutral'} variant="soft" size="xs" title={own.model ? 'Runs on its own model' : 'Runs on the default model'}>
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
      key: 'model',
      header: 'Model',
      cellClassName: 'align-top',
      cell: (row) => (
        <ModelSelect
          id={`agent-${row.agentId}-model`}
          value={sel.effective(row.modelRef).model ?? DEFAULT_MODEL_VALUE}
          onValueChange={(value) => sel.stage(row.modelRef, { model: value === DEFAULT_MODEL_VALUE ? null : value })}
          models={modelOptions}
          defaultLabel={`Use default model${agent.model ? ` (${agent.model})` : ''}`}
          ariaLabel={`${row.name} model`}
          className="w-full min-w-0"
        />
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
              <div className="min-w-0">
                <ModelSelect
                  id={`agent-${row.agentId}-subagent`}
                  value={sub.model ?? DEFAULT_MODEL_VALUE}
                  onValueChange={(value) => sel.stage(row.subagentRef, { model: value === DEFAULT_MODEL_VALUE ? null : value })}
                  models={modelOptions}
                  defaultLabel="Use default subagent model"
                  ariaLabel={`${row.name} subagents`}
                  className="w-full min-w-0"
                />
                {sub.staged ? <div className="mt-bakin-1"><StagedMark staged /></div> : null}
              </div>
            )
          },
        } satisfies DataTableColumn<AgentRow>]
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
      ) : groups.map((group) => (
        <Section key={group.id} spacing="compact" aria-labelledby={`agents-group-${group.id}`} data-testid={`agents-group-${group.id}`}>
          <div className="flex min-w-0 items-center gap-bakin-2">
            <h2 id={`agents-group-${group.id}`} className="m-0">{group.label}</h2>
            <Badge tone="neutral" variant="soft" size="xs">{group.rows.length} agent{group.rows.length === 1 ? '' : 's'}</Badge>
          </div>
          <DataTable
            label={`${group.label} models`}
            columns={columns}
            rows={group.rows}
            rowKey={(row) => row.agentId}
            rowProps={(row) => ({ 'data-agent-model-row': row.agentId, 'data-highlighted': highlight === row.modelRef || highlight === row.subagentRef ? 'true' : undefined })}
          />
        </Section>
      ))}
      {rows.length > 0 && !support?.perAgentSubagentModel ? (
        <Text size="meta" tone="muted">The active runtime doesn&apos;t manage per-agent subagent models.</Text>
      ) : null}
    </Stack>
  )
}
