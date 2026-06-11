'use client'

/**
 * Team detail page (layered-context spec, C11) — the home of the shared-rules
 * confidence loop. Renders for a real OrgTeam OR the `global` pseudo-team
 * ("the team everyone's on"):
 *
 *   - header: name, color, member avatars
 *   - shared context editor: the team's (or global) context file with the
 *     two-zone ownership made visible — user content edits in place; the
 *     Bakin-managed block (role files only) is never editable here
 *   - members with per-agent sync state (from the last receipts/doctor data)
 *   - "Sync team" → POST /teams/:teamId/sync (global: syncs every agent via
 *     the per-agent route) → combined receipt summary
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '@makinbakin/sdk/hooks'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Textarea,
} from '@makinbakin/sdk/ui'
import { PluginHeader } from '@makinbakin/sdk/components'
import { ArrowLeft, CircleCheck, Globe, RefreshCw, TriangleAlert, Users } from 'lucide-react'

interface TeamInfo {
  id: string
  label: string
  color?: string
}

interface MemberMeta {
  id: string
  name: string
  emoji?: string
}

interface SyncResultRow {
  agentId: string
  receipt?: {
    verification?: { status: string; findings?: Array<{ message: string }> }
    blocks?: Array<{ file: string; action: string }>
    skipped?: Array<{ target: string; hint?: string }>
  }
  error?: string
}

const GLOBAL_TEAM: TeamInfo = { id: 'global', label: 'Global' }

export function TeamDetail({ teamId }: { teamId: string }) {
  const router = useRouter()
  const isGlobal = teamId === 'global'

  const [team, setTeam] = useState<TeamInfo | null>(isGlobal ? GLOBAL_TEAM : null)
  const [members, setMembers] = useState<MemberMeta[] | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentPath, setContentPath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResults, setSyncResults] = useState<SyncResultRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const contextUrl = isGlobal
    ? '/api/plugins/team/context/global'
    : `/api/plugins/team/context/team?id=${encodeURIComponent(teamId)}`

  const load = useCallback(async () => {
    try {
      if (isGlobal) {
        const agentsRes = await fetch('/api/plugins/team/')
        const agentsJson = await agentsRes.json()
        const list = Array.isArray(agentsJson) ? agentsJson : agentsJson.agents ?? []
        setMembers(list.map((a: MemberMeta) => ({ id: a.id, name: a.name ?? a.id, emoji: (a as { emoji?: string }).emoji })))
      } else {
        const res = await fetch(`/api/plugins/team/teams/${encodeURIComponent(teamId)}/members`)
        if (!res.ok) throw new Error(`Team "${teamId}" not found`)
        const json = await res.json()
        setTeam(json.team)
        setMembers((json.members ?? []).map((a: MemberMeta) => ({ id: a.id, name: a.name ?? a.id, emoji: (a as { emoji?: string }).emoji })))
      }

      const ctxRes = await fetch(contextUrl)
      const ctxJson = await ctxRes.json()
      if (ctxJson.ok) {
        setContent(ctxJson.content ?? '')
        setContentPath(ctxJson.path ?? null)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [contextUrl, isGlobal, teamId])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (content === null) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(contextUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? `save failed (${res.status})`)
      setContent(json.content ?? content)
      setDirty(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const syncTeam = async () => {
    setSyncing(true)
    setSyncResults(null)
    try {
      if (isGlobal) {
        // Global pseudo-team: sync every agent via the per-agent route.
        const rows: SyncResultRow[] = []
        for (const member of members ?? []) {
          try {
            const res = await fetch(`/api/agent-packages/${encodeURIComponent(member.id)}/sync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            })
            const json = await res.json()
            rows.push(json.ok ? { agentId: member.id, receipt: json.receipt } : { agentId: member.id, error: json.error ?? `sync failed (${res.status})` })
          } catch (err) {
            rows.push({ agentId: member.id, error: err instanceof Error ? err.message : String(err) })
          }
        }
        setSyncResults(rows)
      } else {
        const res = await fetch(`/api/plugins/team/teams/${encodeURIComponent(teamId)}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const json = await res.json()
        if (!json.ok) throw new Error(json.error ?? `sync failed (${res.status})`)
        setSyncResults(json.results ?? [])
      }
    } catch (err) {
      setSyncResults([{ agentId: '(team)', error: err instanceof Error ? err.message : String(err) }])
    } finally {
      setSyncing(false)
    }
  }

  const resultByAgent = useMemo(
    () => new Map((syncResults ?? []).map((r) => [r.agentId, r])),
    [syncResults],
  )

  if (loadError) {
    return <p className="text-sm text-red-400">{loadError}</p>
  }

  if (!members) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => router.push('/team')}>
            <ArrowLeft className="size-4" /> Team
          </Button>
          {isGlobal
            ? <Globe className="size-5 text-muted-foreground" />
            : <Users className="size-5" style={team?.color ? { color: team.color } : undefined} />}
          <PluginHeader title={team?.label ?? teamId} count={members.length} />
        </div>
        <Button onClick={syncTeam} disabled={syncing} className="gap-1">
          <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : isGlobal ? 'Sync all agents' : 'Sync team'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline justify-between text-base">
            <span>Shared context</span>
            {contentPath && <span className="text-xs font-normal text-muted-foreground">{contentPath}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {isGlobal
              ? 'Reaches EVERY agent’s AGENTS.md managed block on sync. Content inside a bakin:managed block (role files) is Bakin-owned and re-asserted automatically.'
              : 'Reaches every member’s AGENTS.md managed block on sync.'}
          </p>
          <Textarea
            value={content ?? ''}
            onChange={(e) => { setContent(e.target.value); setDirty(true) }}
            rows={12}
            className="font-mono text-xs"
            placeholder={isGlobal ? '# House rules for every agent…' : `# Rules for the ${team?.label ?? teamId} team…`}
            aria-label="Shared context content"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {dirty && <span className="text-xs text-yellow-500">Unsaved changes — members go stale after save until synced.</span>}
            {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {members.length === 0 && <p className="text-sm text-muted-foreground">No members assigned yet.</p>}
            {members.map((member) => {
              const result = resultByAgent.get(member.id)
              return (
                <div key={member.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <button
                    type="button"
                    className="flex items-center gap-2 hover:underline"
                    onClick={() => router.push(`/team/${member.id}`)}
                  >
                    <span>{member.emoji ?? '🤖'}</span>
                    <span className="font-medium">{member.name}</span>
                    <span className="text-muted-foreground text-xs">{member.id}</span>
                  </button>
                  {result && (
                    result.error ? (
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 gap-1">
                        <TriangleAlert className="size-3" /> {result.error.slice(0, 60)}
                      </Badge>
                    ) : (
                      <Badge className={result.receipt?.verification?.status === 'ok'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 gap-1'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 gap-1'}>
                        <CircleCheck className="size-3" />
                        {result.receipt?.verification?.status === 'ok' ? 'synced' : 'issues'}
                        {(result.receipt?.blocks ?? []).filter((b) => b.action === 'recomposed').length > 0 &&
                          ` · ${(result.receipt?.blocks ?? []).filter((b) => b.action === 'recomposed').length} block(s)`}
                      </Badge>
                    )
                  )}
                </div>
              )
            })}
          </div>
          {syncResults && syncResults.some((r) => (r.receipt?.skipped?.length ?? 0) > 0) && (
            <div className="mt-3 space-y-1 text-xs text-yellow-600 dark:text-yellow-400">
              {syncResults.flatMap((r) => (r.receipt?.skipped ?? []).map((skip, i) => (
                <p key={`${r.agentId}-${i}`}>
                  Skipped (user-edited; preserved): {skip.target}{skip.hint ? ` — ${skip.hint}` : ''}
                </p>
              )))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
