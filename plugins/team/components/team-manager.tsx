'use client'

import { useState } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { EmptyState } from "@makinbakin/sdk/components"
import { Input } from "@makinbakin/sdk/ui"
import { Label } from "@makinbakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@makinbakin/sdk/ui"
import { useAgentStore } from '@makinbakin/sdk/hooks'
import type { OrgTeam } from '../types'

export function TeamManager() {
  const teams = useAgentStore((s) => s.teams)
  const agents = useAgentStore((s) => s.agents)
  const reload = useAgentStore((s) => s.load)

  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newId, setNewId] = useState('')
  const [newReportsTo, setNewReportsTo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const handleAdd = async () => {
    const id = newId || newLabel.toLowerCase().replace(/[^a-z0-9]/g, '-')
    if (!id || !newLabel || !newReportsTo) return

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/plugins/team/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, label: newLabel, reportsTo: newReportsTo }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create team' }))
        setError(err.error || 'Failed to create team')
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

  const handleDelete = async (teamId: string) => {
    setError(null)
    const res = await fetch(`/api/plugins/team/teams/${teamId}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to delete team' }))
      setError(err.error || 'Failed to delete team')
      return
    }
    setDeleteTarget(null)
    await reload()
  }

  const handleUpdate = async (teamId: string, patch: Partial<OrgTeam>) => {
    setError(null)
    const res = await fetch(`/api/plugins/team/teams/${teamId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update team' }))
      setError(err.error || 'Failed to update team')
      return
    }
    await reload()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Teams organize agents in the org chart. Each team reports to an agent.
      </p>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Existing teams */}
      {teams.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No teams yet"
          description="Create one to organize your agents."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex-1 min-w-0">
              <a href="/team/teams/global" className="text-sm font-semibold hover:underline">Global</a>
              <div className="text-xs text-muted-foreground">Shared context for every agent</div>
            </div>
            <code className="text-[10px] text-muted-foreground font-mono">global</code>
          </div>
          {teams.map((team) => {
            return (
              <div
                key={team.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex-1 min-w-0">
                  <a href={`/team/teams/${encodeURIComponent(team.id)}`} className="text-sm font-semibold hover:underline">
                    {team.label}
                  </a>
                  <div className="text-xs text-muted-foreground">
                    Reports to{' '}
                    <select
                      value={team.reportsTo ?? ''}
                      onChange={(e) => handleUpdate(team.id, { reportsTo: e.target.value })}
                      className="inline-flex h-5 rounded border border-border bg-transparent px-1 text-[10px] text-foreground focus:outline-none"
                    >
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <code className="text-[10px] text-muted-foreground font-mono">{team.id}</code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDeleteTarget(team.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add team form */}
      {showAdd ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="team-label">Team Name</Label>
            <Input
              id="team-label"
              value={newLabel}
              onChange={(e) => {
                setNewLabel(e.target.value)
                if (!newId) setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'))
              }}
              placeholder="e.g. Builders"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-id">ID</Label>
            <Input
              id="team-id"
              value={newId}
              onChange={(e) => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="e.g. builders"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-reports-to">Reports To</Label>
            <select
              id="team-reports-to"
              value={newReportsTo}
              onChange={(e) => setNewReportsTo(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Select an agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!newLabel || !newReportsTo || submitting}
            >
              Create Team
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)} className="self-start">
          <Plus className="size-3.5" />
          Add Team
        </Button>
      )}

      {/* Delete team confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete team?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will delete <span className="text-foreground font-medium">{deleteTarget}</span> and
            unassign all agents from it.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteTarget && handleDelete(deleteTarget)}>
              Delete Team
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
