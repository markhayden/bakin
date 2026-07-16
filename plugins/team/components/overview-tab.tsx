'use client'

/**
 * Overview tab — consolidated agent dashboard.
 *
 * Replaces the old Profile tab (which regurgitated content from the
 * Soul/Rules/Tools/Heartbeat tabs). Folds in what the killed Stats tab
 * used to show, plus summary counts (skills + lessons), recent
 * activity (5m/1h/24h dispatch counts), model selector, and team
 * selector — both moved out of the agent-detail header.
 */
import { Loader2, Sparkles, BookOpen, MessageSquare, Coins, Database, Activity } from 'lucide-react'
import { ModelSelect } from '@makinbakin/sdk/components'
import { useAgentStore, useAgentColor, useJsonFetch } from '@makinbakin/sdk/hooks'
import type { AgentUsage, AvailableModel } from '@makinbakin/sdk/types'
import { useQueryState } from '@makinbakin/sdk/hooks'
import type { AgentProfile, PackageStateRow, RecentActivity } from '../types'
import { PackageCardBody } from './package-card'
import { useAgentAttention, DiagnosticsChipsView } from './diagnostics-tab'

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-2">{children}</h3>
  )
}

interface MetricTileProps {
  label: string
  value: string
  sublabel?: string
  icon: React.ComponentType<{ className?: string }>
  /** Tailwind color stem used for the icon, value text, and accent border (e.g. "text-blue-400") */
  accent: string
  /** Tailwind background stem for the icon chip (e.g. "bg-blue-500/10") */
  accentBg: string
}

function MetricTile({ label, value, sublabel, icon: Icon, accent, accentBg }: MetricTileProps) {
  return (
    <div className="relative rounded-xl border border-border bg-muted/15 px-4 py-4 overflow-hidden group transition-colors hover:bg-muted/25">
      <div className={`absolute inset-y-0 left-0 w-1 ${accentBg.replace('/10', '/40')}`} />
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`size-7 rounded-lg flex items-center justify-center ${accentBg}`}>
          <Icon className={`size-3.5 ${accent}`} />
        </span>
      </div>
      <div className={`text-2xl font-semibold tabular-nums leading-tight ${accent}`}>{value}</div>
      {sublabel && <div className="text-[11px] text-muted-foreground mt-1">{sublabel}</div>}
    </div>
  )
}

interface ActivityTileProps {
  label: string
  count: number
  errors: number
  agentColor: string
}

function ActivityTile({ label, count, errors, agentColor }: ActivityTileProps) {
  const isActive = count > 0
  return (
    <div
      className="rounded-xl border border-border bg-muted/15 px-4 py-3 flex items-center gap-3 transition-colors"
      style={isActive ? { borderColor: `${agentColor}40`, boxShadow: `inset 0 0 0 1px ${agentColor}20` } : undefined}
    >
      <div
        className="size-9 rounded-lg flex items-center justify-center shrink-0"
        style={isActive ? { background: `${agentColor}20` } : { background: 'rgb(63 63 70 / 0.4)' }}
      >
        <Activity className={`size-4 ${isActive ? '' : 'text-muted-foreground'}`} style={isActive ? { color: agentColor } : undefined} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums leading-tight" style={isActive ? { color: agentColor } : { color: 'rgb(244 244 245 / 0.85)' }}>
          {count.toLocaleString()}
        </div>
      </div>
      {errors > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 font-medium">
          {errors} err
        </span>
      )}
    </div>
  )
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

function fmtCost(n: number | null): string {
  if (n === null) return '—'
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export function OverviewTab({
  agentId,
  profile,
  packageState,
  availableModels,
  onModelChange,
  savingModel,
}: OverviewTabProps) {
  const teams = useAgentStore((s) => s.teams)
  const displaySettings = useAgentStore((s) => s.displaySettings)
  const reload = useAgentStore((s) => s.load)
  const accentColor = useAgentColor(agentId)
  const currentTeamId = displaySettings[agentId]?.teamId ?? ''
  const attention = useAgentAttention(agentId)
  const [, setTabParam] = useQueryState('tab', 'overview')
  // The dead-until-now 'drifted' badge state (#385): layered on from the
  // cached doctor result, same source as the dashboard attention chips.
  const effectivePackageState: PackageStateRow | undefined =
    packageState && attention.drift && packageState.state === 'managed'
      ? { ...packageState, state: 'drifted' }
      : packageState

  // Four independent reads; a failed endpoint degrades to the same fallback
  // the old Promise.all catch-defaults produced. useJsonFetch keeps the
  // previous payload across url changes and on error, and this component can
  // survive /team/a → /team/b navigation — so every read is error-guarded:
  // a failed fetch for agent B must render B's fallback, never A's numbers.
  const statsRes = useJsonFetch<{ usage: AgentUsage | null }>(`/api/plugins/team/${agentId}/stats`)
  const activityRes = useJsonFetch<{ ok: boolean; activity?: RecentActivity }>(
    `/api/plugins/team/${agentId}/recent-activity`,
  )
  const skillsRes = useJsonFetch<{ skills?: unknown[] }>(`/api/plugins/team/${agentId}/skills`)
  const lessonsRes = useJsonFetch<{ ok: boolean; lessons?: Array<{ enabled: boolean }> }>(
    `/api/agent-packages/${agentId}/lessons`,
  )
  const loading = statsRes.loading || activityRes.loading || skillsRes.loading || lessonsRes.loading
  const usage = statsRes.error ? null : (statsRes.data?.usage ?? null)
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
    : `${fmtCost(reportedCost)}${costCoverageComplete ? '' : '+'}`
  const costSublabel = !usage || reportedCost === null
    ? undefined
    : costCoverageComplete
      ? `${fmtCost(reportedCost / usage.messages)}/msg`
      : costCoverageKnown
        ? `Partial reported cost · ${costedMessages} of ${usage.messages} messages`
        : 'Reported cost · coverage unavailable'
  const activity =
    !activityRes.error && activityRes.data?.ok && activityRes.data.activity ? activityRes.data.activity : null
  const skillCount = skillsRes.loading
    ? null
    : !skillsRes.error && Array.isArray(skillsRes.data?.skills)
      ? skillsRes.data.skills.length
      : 0
  const lessonsMeta: LessonsMeta | null = lessonsRes.loading
    ? null
    : !lessonsRes.error && lessonsRes.data?.ok && Array.isArray(lessonsRes.data.lessons)
      ? {
          total: lessonsRes.data.lessons.length,
          enabled: lessonsRes.data.lessons.filter((l) => l.enabled).length,
        }
      : { total: 0, enabled: 0 }

  const resolvedModelId = availableModels.find((m) => m.id === profile.model)?.id ?? profile.model

  const handleTeamChange = async (teamId: string) => {
    const res = await fetch(`/api/plugins/team/${agentId}/team`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: teamId || null }),
    })
    if (res.ok) await reload()
  }

  return (
    <div className="space-y-6 w-full">
      {/* HERO — Settings + Package merged into one accent-bordered card.
          Identity (avatar/name/role/manages) lives in the page header above
          and is intentionally not duplicated here. Stacks 1-up at narrow
          widths; splits 1:1 at lg+. */}
      <section
        className="relative rounded-2xl border-2 overflow-hidden"
        style={{
          borderColor: `${accentColor}55`,
          background: `linear-gradient(135deg, ${accentColor}10 0%, transparent 50%)`,
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/40">
          {/* SETTINGS — no header, the labeled selectors below are self-explanatory */}
          <div className="px-6 py-5 space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Model</div>
              {availableModels.length > 0 ? (
                <div className="flex items-center gap-2">
                  <ModelSelect
                    value={resolvedModelId}
                    onChange={onModelChange}
                    models={availableModels}
                    defaultLabel="Use default"
                    className="h-8 w-full text-xs"
                  />
                  {savingModel && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                </div>
              ) : (
                <code className="text-xs font-mono text-muted-foreground">{profile.model}</code>
              )}
            </div>
            {teams.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Team</div>
                <select
                  value={currentTeamId}
                  onChange={(e) => handleTeamChange(e.target.value)}
                  className="h-8 w-full rounded border border-border bg-transparent px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* PACKAGE */}
          <div className="px-6 py-5 space-y-3">
            <SectionLabel>Agent Package</SectionLabel>
            <PackageCardBody agentId={agentId} packageState={effectivePackageState} />
          </div>
        </div>
      </section>

      {/* DIAGNOSTICS STATUS — drift / context / burn chips (#385) */}
      <section>
        <SectionLabel>Diagnostics</SectionLabel>
        <DiagnosticsChipsView attention={attention} onOpen={() => setTabParam('diagnostics')} />
      </section>

      {/* TELEMETRY — 4 metric tiles, color-coded, with icons */}
      <section>
        <SectionLabel>Metrics</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricTile
            label="Skills"
            value={loading || skillCount === null ? '—' : fmtNum(skillCount)}
            icon={Sparkles}
            accent="text-violet-300"
            accentBg="bg-violet-500/15"
          />
          <MetricTile
            label="Lessons"
            value={loading || !lessonsMeta ? '—' : fmtNum(lessonsMeta.total)}
            sublabel={lessonsMeta ? `${lessonsMeta.enabled} enabled` : undefined}
            icon={BookOpen}
            accent="text-cyan-300"
            accentBg="bg-cyan-500/15"
          />
          <MetricTile
            label="Tokens"
            value={loading ? '—' : fmtNum(usage?.tokens.total ?? 0)}
            sublabel={usage ? `in ${fmtNum(usage.tokens.input)} · out ${fmtNum(usage.tokens.output)}` : undefined}
            icon={MessageSquare}
            accent="text-blue-300"
            accentBg="bg-blue-500/15"
          />
          <MetricTile
            label="Cost"
            value={loading ? '—' : costValue}
            sublabel={loading ? undefined : costSublabel}
            icon={Coins}
            accent="text-emerald-300"
            accentBg="bg-emerald-500/15"
          />
        </div>
        {usage && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <MetricTile
              label="Model"
              value={usage.model || 'unknown'}
              icon={MessageSquare}
              accent="text-zinc-300"
              accentBg="bg-zinc-500/15"
            />
            <MetricTile
              label="Messages"
              value={fmtNum(usage.messages)}
              icon={MessageSquare}
              accent="text-zinc-300"
              accentBg="bg-zinc-500/15"
            />
            <MetricTile
              label="Cache reads"
              value={fmtNum(usage.tokens.cacheRead)}
              icon={Database}
              accent="text-amber-300"
              accentBg="bg-amber-500/15"
            />
            <MetricTile
              label="Cache writes"
              value={fmtNum(usage.tokens.cacheWrite)}
              icon={Database}
              accent="text-amber-300"
              accentBg="bg-amber-500/15"
            />
          </div>
        )}
      </section>

      {/* RECENT ACTIVITY — 3 tiles tinted with agent accent when active */}
      <section>
        <SectionLabel>Activity</SectionLabel>
        {loading ? (
          <div className="text-sm text-muted-foreground py-3">Loading…</div>
        ) : activity ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ActivityTile label="Last 5 min" count={activity.windowMs['5m']} errors={activity.errors['5m']} agentColor={accentColor} />
              <ActivityTile label="Last hour" count={activity.windowMs['1h']} errors={activity.errors['1h']} agentColor={accentColor} />
              <ActivityTile label="Last 24 h" count={activity.windowMs['24h']} errors={activity.errors['24h']} agentColor={accentColor} />
            </div>
            <div className="text-[11px] text-muted-foreground mt-2.5 text-center">
              Counts since server start ({new Date(activity.sinceServerStart).toLocaleString()}). The recorder is in-memory and resets on restart.
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No activity recorded yet
          </div>
        )}
      </section>

    </div>
  )
}
