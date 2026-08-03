'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Section } from '@makinbakin/sdk/layout'
import { useHistoryBack, useRouter } from '@makinbakin/sdk/navigation'
import {
  AgentAvatar,
  Page,
  PageAside,
  PageBody,
  PageHeader,
  SaveBar,
  StatusBadge,
  ListRow,
  ListRows,} from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  SystemState,
  Textarea,
} from '@makinbakin/sdk/ui'

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
  const goBack = useHistoryBack('/team')
  const isGlobal = teamId === 'global'

  const [team, setTeam] = useState<TeamInfo | null>(isGlobal ? GLOBAL_TEAM : null)
  const [members, setMembers] = useState<MemberMeta[] | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [savedContent, setSavedContent] = useState('')
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
    setLoadError(null)
    try {
      if (isGlobal) {
        const agentsResponse = await fetch('/api/plugins/team/')
        const agentsBody = await agentsResponse.json()
        const list = Array.isArray(agentsBody) ? agentsBody : agentsBody.agents ?? []
        setMembers(list.map((agent: MemberMeta) => ({
          id: agent.id,
          name: agent.name ?? agent.id,
          emoji: agent.emoji,
        })))
      } else {
        const response = await fetch(`/api/plugins/team/teams/${encodeURIComponent(teamId)}/members`)
        if (!response.ok) throw new Error(`Team "${teamId}" not found`)
        const body = await response.json()
        setTeam(body.team)
        setMembers((body.members ?? []).map((agent: MemberMeta) => ({
          id: agent.id,
          name: agent.name ?? agent.id,
          emoji: agent.emoji,
        })))
      }

      const contextResponse = await fetch(contextUrl)
      const contextBody = await contextResponse.json()
      if (contextBody.ok) {
        const nextContent = contextBody.content ?? ''
        setContent(nextContent)
        setSavedContent(nextContent)
        setContentPath(contextBody.path ?? null)
        setDirty(false)
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [contextUrl, isGlobal, teamId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (content === null) return
    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch(contextUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const body = await response.json()
      if (!body.ok) throw new Error(body.error ?? `save failed (${response.status})`)
      const nextContent = body.content ?? content
      setContent(nextContent)
      setSavedContent(nextContent)
      setDirty(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const syncTeam = async () => {
    setSyncing(true)
    setSyncResults(null)
    try {
      if (isGlobal) {
        const rows: SyncResultRow[] = []
        for (const member of members ?? []) {
          try {
            const response = await fetch(`/api/agent-packages/${encodeURIComponent(member.id)}/sync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            })
            const body = await response.json()
            rows.push(body.ok
              ? { agentId: member.id, receipt: body.receipt }
              : { agentId: member.id, error: body.error ?? `sync failed (${response.status})` })
          } catch (error) {
            rows.push({ agentId: member.id, error: error instanceof Error ? error.message : String(error) })
          }
        }
        setSyncResults(rows)
      } else {
        const response = await fetch(`/api/plugins/team/teams/${encodeURIComponent(teamId)}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const body = await response.json()
        if (!body.ok) throw new Error(body.error ?? `sync failed (${response.status})`)
        setSyncResults(body.results ?? [])
      }
    } catch (error) {
      setSyncResults([{ agentId: '(team)', error: error instanceof Error ? error.message : String(error) }])
    } finally {
      setSyncing(false)
    }
  }

  const resultByAgent = useMemo(
    () => new Map((syncResults ?? []).map((result) => [result.agentId, result])),
    [syncResults],
  )

  const skippedResults = useMemo(
    () => (syncResults ?? []).flatMap((result) => (result.receipt?.skipped ?? []).map((skip) => ({
      ...skip,
      agentId: result.agentId,
    }))),
    [syncResults],
  )

  const pageTitle = team?.label ?? (isGlobal ? 'Global' : teamId)
  let bodyState
  if (loadError) {
    bodyState = (
      <SystemState
        kind="error"
        recovery="available"
        scope="page"
        title="Team could not be loaded"
        description={loadError}
        action={<Button variant="outline" onClick={() => void load()}>Try again</Button>}
      />
    )
  } else if (!members) {
    bodyState = (
      <SystemState
        kind="loading"
        scope="page"
        title="Loading team context"
        description="Shared rules and member state will appear here when they are ready."
      />
    )
  }

  return (
    <Page>
      <PageHeader
        navigation={(
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to Team" onClick={goBack}>
            <ArrowLeft aria-hidden="true" />
          </Button>
        )}
        eyebrow="Team / shared context"
        title={pageTitle}
        meta={members ? (
          <>
            <Badge size="xs" variant="outline">{members.length} members</Badge>
            <code className="font-bakin-typography-family-mono">{teamId}</code>
          </>
        ) : undefined}
        actions={members ? (
          <Button type="button" onClick={() => void syncTeam()} disabled={syncing}>
            <RefreshCw className={syncing ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden="true" />
            {syncing ? 'Syncing…' : isGlobal ? 'Sync all agents' : 'Sync team'}
          </Button>
        ) : undefined}
      />

      <PageBody layout="aside" busy={syncing} state={bodyState}>
        <div className="flex min-w-0 flex-1 flex-col gap-bakin-6">
          <Section spacing="compact">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
              <div className="min-w-0">
                <h2 className="m-0 text-bakin-typography-size-title font-bakin-typography-weight-semibold text-bakin-text-primary">
                  Shared context
                </h2>
                <p className="m-0 mt-bakin-1 max-w-prose text-bakin-text-muted">
                  Standing instructions for {isGlobal ? 'every agent' : `every ${pageTitle} member`}. Sync composes
                  these rules into managed blocks without changing personal notes outside those blocks.
                </p>
              </div>
              {contentPath ? (
                <code className="break-all font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                  {contentPath}
                </code>
              ) : null}
            </div>

            {(content ?? '').trim() === '' ? (
              <Alert tone="neutral">
                <AlertTitle>Start with the rules this group shares</AlertTitle>
                <AlertDescription>
                  Good fits include house style, escalation, and handoff conventions. Personalize with{' '}
                  <code>{'{{agentName}}'}</code>, <code>{'{{agentId}}'}</code>, or <code>{'{{mainAgentName}}'}</code>.
                </AlertDescription>
              </Alert>
            ) : null}

            <Textarea
              value={content ?? ''}
              onChange={(event) => {
                setContent(event.target.value)
                setDirty(event.target.value !== savedContent)
              }}
              className="min-h-96 resize-y font-bakin-typography-family-mono"
              placeholder={isGlobal
                ? `# House rules\n\n- Keep replies short and direct.\n- {{agentName}} reports blockers to {{mainAgentName}} immediately.`
                : `# ${pageTitle} team rules\n\n- Follow the team style guide.\n- Hand finished work back by assetId, never file paths.`}
              aria-label="Shared context content"
            />
          </Section>

          {skippedResults.length > 0 ? (
            <Alert tone="attention">
              <AlertTitle>User-edited content was preserved</AlertTitle>
              <AlertDescription>
                <ul className="m-0 grid gap-bakin-1 pl-bakin-4">
                  {skippedResults.map((skip) => (
                    <li key={`${skip.agentId}-${skip.target}`}>
                      {skip.agentId}: {skip.target}{skip.hint ? ` — ${skip.hint}` : ''}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <PageAside label="Team members">
          <div>
            <h2 className="m-0 text-bakin-typography-size-title font-bakin-typography-weight-semibold text-bakin-text-primary">
              Members
            </h2>
            <p className="m-0 mt-bakin-1 text-bakin-text-muted">
              Open an agent to inspect its individual context and diagnostics.
            </p>
          </div>

          {members?.length === 0 ? (
            <SystemState
              kind="initial-empty"
              scope="inline"
              title="No members assigned"
              description="Assign an agent from Team management to include it here."
            />
          ) : (
            <ListRows variant="separated" aria-label="Team members">
              {members?.map((member) => {
                const result = resultByAgent.get(member.id)
                const recomposedCount = (result?.receipt?.blocks ?? []).filter((block) => block.action === 'recomposed').length
                const status = result?.error
                  ? { label: 'Sync failed', tone: 'danger' as const }
                  : result
                    ? {
                        label: result.receipt?.verification?.status === 'ok'
                          ? recomposedCount > 0 ? `Synced · ${recomposedCount} updated` : 'Synced'
                          : 'Needs attention',
                        tone: result.receipt?.verification?.status === 'ok' ? 'success' as const : 'attention' as const,
                      }
                    : null

                return (
                  <ListRow key={member.id} className="flex min-w-0 items-center gap-bakin-3">
                    <AgentAvatar
                      agent={{ id: member.id, name: member.name, initials: member.emoji }}
                      size="sm"
                      decorative
                    />
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      className="min-w-0 flex-1 justify-start"
                      onClick={() => router.push(`/team/${member.id}`)}
                    >
                      <span className="truncate">{member.name}</span>
                    </Button>
                    {status ? (
                      <StatusBadge tone={status.tone} variant="solid" size="xs" title={result?.error}>
                        {status.label}
                      </StatusBadge>
                    ) : null}
                  </ListRow>
                )
              })}
            </ListRows>
          )}
        </PageAside>
      </PageBody>

      <SaveBar
        dirty={dirty}
        saving={saving}
        error={saveError}
        onSave={() => void save()}
        onDiscard={() => {
          setContent(savedContent)
          setDirty(false)
          setSaveError(null)
        }}
      >
        Saved context must be synced before members receive it.
      </SaveBar>
    </Page>
  )
}
