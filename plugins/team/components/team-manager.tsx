'use client'

import { useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Trash, Users } from 'lucide-react'
import { useRouter } from '@makinbakin/sdk/navigation'
import { ConfirmDialog, ListRow, ListRows } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Button,
  DrawerSection,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'
import { useAgentStore } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { TeamFormDialog, type TeamFormMode } from './team-form-dialog'

export function TeamManager() {
  const router = useRouter()
  const teams = useAgentStore((state) => state.teams)
  const agents = useAgentStore((state) => state.agents)
  const mainAgentId = useAgentStore((state) => state.mainAgentId)
  const reload = useAgentStore((state) => state.load)

  const [formMode, setFormMode] = useState<TeamFormMode | null>(null)
  const [lastMode, setLastMode] = useState<TeamFormMode>({ kind: 'create' })
  const triggerRef = useRef<HTMLElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const agentOptions = useMemo(() => agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    imageSrc: agent.headshot || null,
  })), [agents])

  const openForm = (mode: TeamFormMode, trigger: HTMLElement) => {
    triggerRef.current = trigger
    setError(null)
    setLastMode(mode)
    setFormMode(mode)
  }

  // The change landed; a failed refresh must not read as a failed save.
  const handleSaved = () => {
    void reload().then((refreshed) => {
      if (!refreshed) setError('The team was saved, but the list could not refresh. Reload the page to see it.')
    })
  }

  const handleDelete = async (teamId: string) => {
    setError(null)
    const response = await pluginFetch('team', `teams/${teamId}`, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to delete team' }))
      setError(body.error || 'Failed to delete team')
      return
    }
    setDeleteTarget(null)
    await reload()
  }

  return (
    <div className="flex min-w-0 flex-col gap-bakin-6 pb-bakin-6">
      <p className="m-0 text-bakin-text-muted">
        Teams create smaller reporting groups with their own shared context. Global includes every
        agent by default.
      </p>

      {error ? (
        <Alert tone="danger">
          <AlertTitle>Team change failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DrawerSection
        title="Teams"
        actions={(
          <Button type="button" size="sm" onClick={(event) => openForm({ kind: 'create' }, event.currentTarget)}>
            <Plus aria-hidden="true" />
            Add team
          </Button>
        )}
      >
        <div className="grid gap-bakin-2">
          {teams.length === 0 ? (
            <SystemState
              kind="initial-empty"
              scope="inline"
              title="No custom teams yet"
              description="Every agent remains in Global until you create a smaller group with its own shared context."
            />
          ) : null}

          <ListRows variant="separated" aria-label="Teams">
            <ListRow className="flex min-w-0 items-center gap-bakin-3">
              <Avatar size="md">
                <AvatarFallback>
                  <Users className="size-bakin-4" aria-hidden="true" />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="justify-start text-bakin-text-primary"
                  onClick={() => router.push('/team/teams/global')}
                >
                  Global
                </Button>
                <Text size="meta" tone="muted" as="p">
                  Shared context for every agent
                </Text>
              </div>
              <Text size="meta" tone="muted" mono as="code">
                global
              </Text>
            </ListRow>

            {teams.map((team) => (
              <ListRow key={team.id} className="flex min-w-0 items-center gap-bakin-3">
                <div className="min-w-0 flex-1">
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="h-auto max-w-full justify-start whitespace-normal break-words text-left text-bakin-text-primary"
                    onClick={() => router.push(`/team/teams/${encodeURIComponent(team.id)}`)}
                  >
                    {team.label}
                  </Button>
                  <Text size="meta" tone="muted" mono as="code" className="block break-all">
                    {team.id}
                  </Text>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${team.label}`}
                  onClick={(event) => openForm({ kind: 'edit', teamId: team.id }, event.currentTarget)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${team.label}`}
                  onClick={() => setDeleteTarget(team.id)}
                >
                  <Trash aria-hidden="true" />
                </Button>
              </ListRow>
            ))}
          </ListRows>
        </div>
      </DrawerSection>

      <TeamFormDialog
        open={formMode !== null}
        mode={formMode ?? lastMode}
        agents={agentOptions}
        mainAgentId={mainAgentId}
        triggerRef={triggerRef}
        onClose={() => setFormMode(null)}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete team?"
        description={(
          <>
            This will delete <strong>{deleteTarget}</strong> and unassign every agent from it.
          </>
        )}
        confirmLabel="Delete team"
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
