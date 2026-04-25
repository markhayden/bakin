'use client'

/**
 * Overview tab — consolidated agent dashboard.
 *
 * Replaces the old Profile tab (which regurgitated content from the
 * Soul/Rules/Tools/Heartbeat tabs). Folds in what the killed Stats tab
 * used to show, plus summary counts (skills + knowledge), recent
 * activity (5m/1h/24h dispatch counts), model selector, and team
 * selector — both moved out of the agent-detail header.
 */
import { useEffect, useState } from 'react'
import { Loader2, Sparkles, BookOpen, MessageSquare, Coins, Database, Activity } from 'lucide-react'
import { ModelSelect } from '@bakin/sdk/components'
import { useAgentStore, useAgentColor, useRouter } from '@bakin/sdk/hooks'
import type { AvailableModel } from '@bakin/sdk/types'
import type { AgentProfile, PackageStateRow, RecentActivity } from '../types'
import type { AgentUsage } from '../../../src/core/agent-usage'
import { PackageCardBody } from './agent-detail'

export interface OverviewTabProps {
  agentId: string
  profile: AgentProfile
  packageState: PackageStateRow | undefined
  availableModels: AvailableModel[]
  onModelChange: (modelId: string) => Promise<void> | void
  savingModel: boolean
}

interface KnowledgeMeta {
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

function fmtCost(n: number): string {
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
  const agentMap = useAgentStore((s) => s.agentMap)
  const accentColor = useAgentColor(agentId)
  const router = useRouter()
  const currentTeamId = displaySettings[agentId]?.teamId ?? ''
  const reports = profile.subagentPerms ?? []

  const [usage, setUsage] = useState<AgentUsage | null>(null)
  const [activity, setActivity] = useState<RecentActivity | null>(null)
  const [skillCount, setSkillCount] = useState<number | null>(null)
  const [knowledge, setKnowledge] = useState<KnowledgeMeta | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(`/api/plugins/team/${agentId}/stats`).then((r) => r.json()).catch(() => ({ usage: null })),
      fetch(`/api/plugins/team/${agentId}/recent-activity`).then((r) => r.json()).catch(() => ({ ok: false })),
      fetch(`/api/plugins/team/${agentId}/skills`).then((r) => r.json()).catch(() => ({ skills: [] })),
      fetch(`/api/agent-packages/${agentId}/knowledge`).then((r) => r.json()).catch(() => ({ ok: false })),
    ]).then(([statsBody, activityBody, skillsBody, knowledgeBody]) => {
      if (cancelled) return
      const stats = statsBody as { usage: AgentUsage | null }
      const act = activityBody as { ok: boolean; activity?: RecentActivity }
      const skills = skillsBody as { skills?: unknown[] }
      const know = knowledgeBody as { ok: boolean; lessons?: Array<{ enabled: boolean }> }

      setUsage(stats.usage ?? null)
      setActivity(act.ok && act.activity ? act.activity : null)
      setSkillCount(Array.isArray(skills.skills) ? skills.skills.length : 0)
      if (know.ok && Array.isArray(know.lessons)) {
        setKnowledge({
          total: know.lessons.length,
          enabled: know.lessons.filter((l) => l.enabled).length,
        })
      } else {
        setKnowledge({ total: 0, enabled: 0 })
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [agentId])

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
            <SectionLabel>Package</SectionLabel>
            <PackageCardBody agentId={agentId} packageState={packageState} />
          </div>
        </div>
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
            label="Knowledge"
            value={loading || !knowledge ? '—' : fmtNum(knowledge.total)}
            sublabel={knowledge ? `${knowledge.enabled} enabled` : undefined}
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
            value={loading ? '—' : fmtCost(usage?.cost.total ?? 0)}
            sublabel={usage && usage.messages > 0 ? `${fmtCost(usage.cost.total / usage.messages)}/msg` : undefined}
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

      {/* DIRECT REPORTS — agents this one is permitted to dispatch.
          Only renders when there's anything to manage. */}
      {reports.length > 0 && (
        <section>
          <SectionLabel>Direct reports</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {reports.map((id) => {
              const report = agentMap[id]
              return (
                <button
                  key={id}
                  onClick={() => router.push(`/team/${id}`)}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-muted/15 p-3 text-left transition-colors hover:bg-muted/30 hover:border-border/80"
                >
                  <div className="size-10 rounded-full overflow-hidden bg-muted shrink-0">
                    {report?.headshot ? (
                      <img
                        src={report.headshot}
                        alt={report?.name ?? id}
                        className="w-full h-full object-cover object-top"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-lg" aria-hidden>
                        {report?.emoji || '🤖'}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate group-hover:text-foreground">
                      {report?.name ?? id}
                    </div>
                    {report?.role && (
                      <div className="text-[11px] text-muted-foreground truncate">{report.role}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

    </div>
  )
}
