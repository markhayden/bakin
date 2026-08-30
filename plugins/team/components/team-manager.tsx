'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { useRouter } from '@makinbakin/sdk/navigation'
import { AgentSelect, ConfirmDialog, ListRow, ListRows } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Button,
  DrawerSection,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Form,
  FormActions,
  Input,
  SubmitButton,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'
import { useAgentStore } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'
import type { OrgTeam } from '../types'

export function TeamManager() {
  const router = useRouter()
  const teams = useAgentStore((state) => state.teams)
  const agents = useAgentStore((state) => state.agents)
  const reload = useAgentStore((state) => state.load)

  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newId, setNewId] = useState('')
  const [newReportsTo, setNewReportsTo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const agentOptions = useMemo(() => agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    imageSrc: agent.headshot || null,
  })), [agents])

  const handleAdd = async () => {
    const id = newId || newLabel.toLowerCase().replace(/[^a-z0-9]/g, '-')
    if (!id || !newLabel || !newReportsTo) return

    setSubmitting(true)
    setError(null)
    try {
      const response = await pluginFetch('team', 'teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, label: newLabel, reportsTo: newReportsTo }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Failed to create team' }))
        setError(body.error || 'Failed to create team')
        return
      }
      setShowAdd(false)
      setNewLabel('')
      setNewId('')
      setNewReportsTo('')
      await reload()
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleAdd()
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

  const handleUpdate = async (teamId: string, patch: Partial<OrgTeam>) => {
    setError(null)
    const response = await pluginFetch('team', `teams/${teamId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to update team' }))
      setError(body.error || 'Failed to update team')
      return
    }
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

      <DrawerSection title="Teams">
        <div className="grid gap-bakin-2">
          {teams.length === 0 ? (
            <SystemState
              kind="initial-empty"
              scope="inline"
              title="No custom teams yet"
              description="Every agent remains in Global until you create a smaller group with its own shared context."
            />
          ) : null}

          <ListRows variant="bordered" aria-label="Teams">
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
              <ListRow
                key={team.id}
                className="flex min-w-0 flex-col gap-bakin-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="justify-start text-bakin-text-primary"
                    onClick={() => router.push(`/team/teams/${encodeURIComponent(team.id)}`)}
                  >
                    {team.label}
                  </Button>
                  <Text size="meta" tone="muted" mono as="code" className="block">
                    {team.id}
                  </Text>
                </div>
                <div className="min-w-0 sm:w-56">
                  <AgentSelect
                    ariaLabel={`${team.label} reports to`}
                    value={team.reportsTo ?? ''}
                    onValueChange={(value) => void handleUpdate(team.id, { reportsTo: value })}
                    agents={agentOptions}
                    placeholder="Select reporting agent"
                    className="w-full"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${team.label}`}
                  onClick={() => setDeleteTarget(team.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </ListRow>
            ))}
          </ListRows>
        </div>
      </DrawerSection>

      <DrawerSection title="Create a team">
        {showAdd ? (
          <Form busy={submitting} onSubmit={handleSubmit}>
            <FieldGroup>
              <Field name="teamLabel">
                <FieldLabel htmlFor="team-label">Team name</FieldLabel>
                <FieldDescription>The visible name used throughout the org chart.</FieldDescription>
                <Input
                  id="team-label"
                  value={newLabel}
                  onChange={(event) => {
                    setNewLabel(event.target.value)
                    if (!newId) {
                      setNewId(event.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'))
                    }
                  }}
                  placeholder="e.g. Builders"
                  autoFocus
                />
              </Field>
              <Field name="teamId">
                <FieldLabel htmlFor="team-id">Team ID</FieldLabel>
                <FieldDescription>Stable lowercase identifier used in routing and configuration.</FieldDescription>
                <Input
                  id="team-id"
                  value={newId}
                  onChange={(event) => setNewId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="e.g. builders"
                  className="font-bakin-typography-family-mono"
                />
              </Field>
              <Field name="reportsTo">
                <FieldLabel>Reports to</FieldLabel>
                <FieldDescription>The agent responsible for this team.</FieldDescription>
                <AgentSelect
                  id="team-reports-to"
                  value={newReportsTo}
                  onValueChange={setNewReportsTo}
                  agents={agentOptions}
                  placeholder="Select an agent"
                  className="w-full"
                />
              </Field>
            </FieldGroup>
            <FormActions>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <SubmitButton
                size="sm"
                disabled={!newLabel || !newReportsTo || submitting}
                busyLabel="Creating…"
              >
                Create team
              </SubmitButton>
            </FormActions>
          </Form>
        ) : (
          <Button type="button" size="sm" onClick={() => setShowAdd(true)}>
            <Plus aria-hidden="true" />
            Add team
          </Button>
        )}
      </DrawerSection>

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
