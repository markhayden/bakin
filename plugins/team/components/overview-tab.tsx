'use client'

import {
  Activity,
  BookOpen,
  Box,
  Coins,
  Database,
  MessageSquare,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { Section } from '@makinbakin/sdk/layout'
import { ModelSelect, StatGroup, StatTile } from '@makinbakin/sdk/patterns'
import {
  Field,
  FieldDescription,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SystemState,
} from '@makinbakin/sdk/ui'
import { useAgentStore, useJsonFetch, useQueryState } from '@makinbakin/sdk/hooks'
import type { AgentUsage, AvailableModel } from '@makinbakin/sdk/types'
import { DiagnosticsChipsView, useAgentAttention } from './diagnostics-tab'
import { PackageCardBody } from './package-card'
import type { AgentProfile, PackageStateRow, RecentActivity } from '../types'

export interface OverviewTabProps {
  agentId: string
  profile: AgentProfile
  packageState: PackageStateRow | undefined
  availableModels: AvailableModel[]
  onModelChange: (modelId: string) => Promise<void> | void
  savingModel: boolean
}

interface LessonsMeta {
  total: number
  enabled: number
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function formatCost(value: number | null): string {
  if (value === null) return '—'
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function SectionHeading({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div>
      <h2 className="m-0 text-bakin-typography-size-title font-bakin-typography-weight-semibold text-bakin-text-primary">
        {title}
      </h2>
      {description ? <p className="m-0 mt-bakin-1 text-bakin-text-muted">{description}</p> : null}
    </div>
  )
}

export function OverviewTab({
  agentId,
  profile,
  packageState,
  availableModels,
  onModelChange,
  savingModel,
}: OverviewTabProps) {
  const teams = useAgentStore((state) => state.teams)
  const displaySettings = useAgentStore((state) => state.displaySettings)
  const reload = useAgentStore((state) => state.load)
  const currentTeamId = displaySettings[agentId]?.teamId ?? ''
  const attention = useAgentAttention(agentId)
  const [, setTabParam] = useQueryState('tab', 'overview')
  const effectivePackageState =
    packageState && attention.drift && packageState.state === 'managed'
      ? { ...packageState, state: 'drifted' as const }
      : packageState

  const statsResult = useJsonFetch<{ usage: AgentUsage | null }>(`/api/plugins/team/${agentId}/stats`)
  const activityResult = useJsonFetch<{ ok: boolean; activity?: RecentActivity }>(
    `/api/plugins/team/${agentId}/recent-activity`,
  )
  const skillsResult = useJsonFetch<{ skills?: unknown[] }>(`/api/plugins/team/${agentId}/skills`)
  const lessonsResult = useJsonFetch<{ ok: boolean; lessons?: Array<{ enabled: boolean }> }>(
    `/api/agent-packages/${agentId}/lessons`,
  )

  const loading =
    statsResult.loading || activityResult.loading || skillsResult.loading || lessonsResult.loading
  const usage = statsResult.error ? null : (statsResult.data?.usage ?? null)
  const reportedCost = usage?.cost.total ?? null
  const costedMessages = usage?.costedMessages
  const costCoverageKnown = Boolean(
    usage
      && typeof costedMessages === 'number'
      && Number.isInteger(costedMessages)
      && costedMessages >= 0
      && costedMessages <= usage.messages
      && (costedMessages === 0
        ? reportedCost === null && usage.cost.source === 'unavailable'
        : reportedCost !== null && usage.cost.source === 'runtime'),
  )
  const costCoverageComplete = Boolean(
    usage
      && costCoverageKnown
      && usage.messages > 0
      && costedMessages === usage.messages,
  )
  const costValue = reportedCost === null
    ? '—'
    : `${formatCost(reportedCost)}${costCoverageComplete ? '' : '+'}`
  const costDescription = !usage || reportedCost === null
    ? undefined
    : costCoverageComplete
      ? `${formatCost(reportedCost / usage.messages)}/msg`
      : costCoverageKnown
        ? `Partial reported cost · ${costedMessages} of ${usage.messages} messages`
        : 'Reported cost · coverage unavailable'

  const activity =
    !activityResult.error && activityResult.data?.ok && activityResult.data.activity
      ? activityResult.data.activity
      : null
  const skillCount = skillsResult.loading
    ? null
    : !skillsResult.error && Array.isArray(skillsResult.data?.skills)
      ? skillsResult.data.skills.length
      : 0
  const lessonsMeta: LessonsMeta | null = lessonsResult.loading
    ? null
    : !lessonsResult.error && lessonsResult.data?.ok && Array.isArray(lessonsResult.data.lessons)
      ? {
          total: lessonsResult.data.lessons.length,
          enabled: lessonsResult.data.lessons.filter((lesson) => lesson.enabled).length,
        }
      : { total: 0, enabled: 0 }
  const resolvedModelId =
    availableModels.find((model) => model.id === profile.model)?.id ?? profile.model

  const handleTeamChange = async (teamId: string) => {
    const response = await fetch(`/api/plugins/team/${agentId}/team`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: teamId || null }),
    })
    if (response.ok) await reload()
  }

  return (
    <div className="grid min-w-0 gap-bakin-8">
      <Section spacing="compact">
        <SectionHeading
          title="Configuration"
          description="Runtime defaults and package ownership for this agent."
        />
        <div className="grid min-w-0 gap-bakin-6 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-4 lg:grid-cols-2">
          <div className="grid min-w-0 content-start gap-bakin-4">
            <div className="flex items-center gap-bakin-2 text-bakin-text-primary">
              <Settings2 aria-hidden="true" className="size-bakin-4 text-bakin-text-muted" />
              <h3 className="m-0 text-bakin-typography-size-body font-bakin-typography-weight-semibold">
                Runtime
              </h3>
            </div>

            <Field name="agent-model">
              <FieldLabel htmlFor="agent-overview-model">Model</FieldLabel>
              <FieldDescription>The default model for new work assigned to this agent.</FieldDescription>
              <ModelSelect
                id="agent-overview-model"
                value={resolvedModelId}
                onValueChange={onModelChange}
                models={availableModels}
                defaultLabel="Use default"
                disabled={savingModel}
                ariaLabel="Agent model"
              />
            </Field>

            {teams.length > 0 ? (
              <Field name="agent-team">
                <FieldLabel htmlFor="agent-overview-team">Team</FieldLabel>
                <FieldDescription>Controls where the agent appears in the organization graph.</FieldDescription>
                <Select
                  value={currentTeamId}
                  onValueChange={(value) => void handleTeamChange(value ?? '')}
                >
                  <SelectTrigger id="agent-overview-team" aria-label="Agent team" className="w-full">
                    <SelectValue placeholder="No team">
                      {teams.find((team) => team.id === currentTeamId)?.label ?? 'No team'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No team</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </div>

          <div className="grid min-w-0 content-start gap-bakin-4 border-t border-bakin-border-subtle pt-bakin-4 lg:border-l lg:border-t-0 lg:pl-bakin-6 lg:pt-0">
            <div className="flex items-center gap-bakin-2 text-bakin-text-primary">
              <Box aria-hidden="true" className="size-bakin-4 text-bakin-text-muted" />
              <h3 className="m-0 text-bakin-typography-size-body font-bakin-typography-weight-semibold">
                Agent package
              </h3>
            </div>
            <PackageCardBody agentId={agentId} packageState={effectivePackageState} />
          </div>
        </div>
      </Section>

      <Section spacing="compact">
        <SectionHeading
          title="Diagnostics"
          description="Actionable health signals from the current runtime and package state."
        />
        <DiagnosticsChipsView attention={attention} onOpen={() => setTabParam('diagnostics')} />
      </Section>

      <Section spacing="compact">
        <SectionHeading title="Usage" description="Latest-session capability and cost signals." />
        <StatGroup label="Agent usage">
          <StatTile
            label="Skills"
            value={loading || skillCount === null ? '—' : formatNumber(skillCount)}
            icon={Sparkles}
            variant="surface"
            className="min-w-40 flex-1"
          />
          <StatTile
            label="Lessons"
            value={loading || !lessonsMeta ? '—' : formatNumber(lessonsMeta.total)}
            sub={lessonsMeta ? `${lessonsMeta.enabled} enabled` : undefined}
            icon={BookOpen}
            variant="surface"
            className="min-w-40 flex-1"
          />
          <StatTile
            label="Tokens"
            value={loading ? '—' : formatNumber(usage?.tokens.total ?? 0)}
            sub={usage
              ? `in ${formatNumber(usage.tokens.input)} · out ${formatNumber(usage.tokens.output)}`
              : undefined}
            icon={MessageSquare}
            variant="surface"
            className="min-w-40 flex-1"
          />
          <StatTile
            label="Cost"
            value={loading ? '—' : costValue}
            sub={loading ? undefined : costDescription}
            icon={Coins}
            valueTone={reportedCost ? 'success' : 'neutral'}
            variant="surface"
            className="min-w-40 flex-1"
          />
        </StatGroup>

        {usage ? (
          <StatGroup label="Latest session details">
            <StatTile
              label="Model"
              value={usage.model || 'unknown'}
              icon={MessageSquare}
              variant="plain"
              className="min-w-40 flex-1"
            />
            <StatTile
              label="Messages"
              value={formatNumber(usage.messages)}
              icon={MessageSquare}
              variant="plain"
              className="min-w-40 flex-1"
            />
            <StatTile
              label="Cache reads"
              value={formatNumber(usage.tokens.cacheRead)}
              icon={Database}
              variant="plain"
              className="min-w-40 flex-1"
            />
            <StatTile
              label="Cache writes"
              value={formatNumber(usage.tokens.cacheWrite)}
              icon={Database}
              variant="plain"
              className="min-w-40 flex-1"
            />
          </StatGroup>
        ) : null}
      </Section>

      <Section spacing="compact">
        <SectionHeading
          title="Recent activity"
          description="Dispatches observed since the current server process started."
        />
        {loading ? (
          <SystemState
            kind="loading"
            scope="inline"
            title="Loading recent activity"
            description="Current dispatch counts will appear when ready."
          />
        ) : activity ? (
          <>
            <StatGroup label="Recent dispatch activity">
              {([
                ['Last 5 min', activity.windowMs['5m'], activity.errors['5m']],
                ['Last hour', activity.windowMs['1h'], activity.errors['1h']],
                ['Last 24 h', activity.windowMs['24h'], activity.errors['24h']],
              ] as const).map(([label, count, errors]) => (
                <StatTile
                  key={label}
                  label={label}
                  value={formatNumber(count)}
                  sub={errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : 'No errors'}
                  icon={Activity}
                  valueTone={errors > 0 ? 'danger' : count > 0 ? 'accent' : 'neutral'}
                  variant="surface"
                  className="min-w-48 flex-1"
                />
              ))}
            </StatGroup>
            <p className="m-0 text-bakin-typography-size-meta text-bakin-text-muted">
              Recorder started {new Date(activity.sinceServerStart).toLocaleString()} and resets with the server.
            </p>
          </>
        ) : (
          <SystemState
            kind="initial-empty"
            scope="inline"
            title="No activity recorded yet"
            description="Dispatch counts appear after this agent starts work."
          />
        )}
      </Section>
    </div>
  )
}
