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
import { Loader2 } from 'lucide-react'
import { Badge } from '@bakin/sdk/ui'
import { ModelSelect } from '@bakin/sdk/components'
import { useAgentStore } from '@bakin/sdk/hooks'
import type { AvailableModel } from '@bakin/sdk/types'
import type { AgentProfile, PackageStateRow, RecentActivity } from '../types'
import type { AgentUsage } from '../../../src/core/agent-usage'
import { PackageCard } from './agent-detail'

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

function Section({ title, children, span }: { title: string; children: React.ReactNode; span?: 'full' }) {
  return (
    <section className={span === 'full' ? 'col-span-full' : undefined}>
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-2">{title}</h3>
      {children}
    </section>
  )
}

function StatTile({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold text-foreground tabular-nums leading-tight mt-1">{value}</div>
      {sublabel && <div className="text-[11px] text-muted-foreground mt-1">{sublabel}</div>}
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
  const currentTeamId = displaySettings[agentId]?.teamId ?? ''

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
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 w-full">
      <Section title="Identity">
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-3xl leading-none">{profile.emoji || '🤖'}</span>
            <div>
              <div className="text-base font-semibold text-foreground">{profile.name}</div>
              <div className="text-xs text-muted-foreground">{profile.role || 'No role assigned'}</div>
            </div>
          </div>
          {profile.subagentPerms && profile.subagentPerms.length > 0 && (
            <div className="text-xs text-muted-foreground pt-1">
              <span className="text-foreground/80">Manages:</span>{' '}
              {profile.subagentPerms.map((id) => (
                <Badge key={id} variant="outline" className="text-[10px] mx-0.5">{id}</Badge>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Settings">
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Model</div>
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
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Team</div>
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
      </Section>

      <PackageCard agentId={agentId} packageState={packageState} />

      <Section title="Workspace" span="full">
        <code className="text-[11px] text-muted-foreground font-mono break-all">{profile.workspacePath}</code>
      </Section>

      <Section title="Capacity" span="full">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatTile label="Skills" value={loading || skillCount === null ? '—' : fmtNum(skillCount)} />
          <StatTile
            label="Knowledge lessons"
            value={loading || !knowledge ? '—' : fmtNum(knowledge.total)}
            sublabel={knowledge ? `${knowledge.enabled} enabled` : undefined}
          />
          <StatTile
            label="Sessions"
            value={loading ? '—' : fmtNum(usage?.messages ?? 0)}
            sublabel="latest session messages"
          />
        </div>
      </Section>

      <Section title="Latest Session" span="full">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : usage ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Model" value={usage.model || 'unknown'} />
            <StatTile label="Tokens" value={fmtNum(usage.tokens.total)} sublabel={`in ${fmtNum(usage.tokens.input)} · out ${fmtNum(usage.tokens.output)}`} />
            <StatTile label="Cache reads" value={fmtNum(usage.tokens.cacheRead)} />
            <StatTile label="Cost" value={fmtCost(usage.cost.total)} sublabel={`$${(usage.cost.total / Math.max(1, usage.messages)).toFixed(4)}/msg`} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No session data yet
          </div>
        )}
      </Section>

      <Section title="Recent Activity" span="full">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : activity ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatTile
                label="Last 5 min"
                value={fmtNum(activity.windowMs['5m'])}
                sublabel={activity.errors['5m'] ? `${activity.errors['5m']} errors` : undefined}
              />
              <StatTile
                label="Last hour"
                value={fmtNum(activity.windowMs['1h'])}
                sublabel={activity.errors['1h'] ? `${activity.errors['1h']} errors` : undefined}
              />
              <StatTile
                label="Last 24 h"
                value={fmtNum(activity.windowMs['24h'])}
                sublabel={activity.errors['24h'] ? `${activity.errors['24h']} errors` : undefined}
              />
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              Counts since server start ({new Date(activity.sinceServerStart).toLocaleString()}).
              The recorder is in-memory and resets on restart.
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No activity recorded
          </div>
        )}
      </Section>
    </div>
  )
}
