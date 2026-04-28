'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2, Upload, X, ChevronRight } from 'lucide-react'
import { Button } from "@bakin/sdk/ui"
import { Input } from "@bakin/sdk/ui"
import { Label } from "@bakin/sdk/ui"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@bakin/sdk/ui"
import { ModelSelect } from "@bakin/sdk/components"
import type { AvailableModel } from "@bakin/sdk/types"

export interface AgentFormData {
  id: string
  name: string
  emoji: string
  model: string
  soul: string
  role: string
  vibe: string
  primaryFunction: string
  tools: string
  teamId: string
}

export function AgentForm({
  onSubmit,
  onCancel,
  submitting = false,
}: {
  onSubmit: (data: AgentFormData, avatarFile: File | null) => Promise<void>
  onCancel: () => void
  submitting?: boolean
}) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idManual, setIdManual] = useState(false)
  const [emoji, setEmoji] = useState('')
  const [model, setModel] = useState('')
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [soul, setSoul] = useState('')
  const [role, setRole] = useState('')
  const [vibe, setVibe] = useState('')
  const [primaryFunction, setPrimaryFunction] = useState('')
  const [tools, setTools] = useState('')
  const [teamId, setTeamId] = useState('')
  const [teams, setTeams] = useState<Array<{ id: string; label: string }>>([])
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/plugins/models/available')
      .then((r) => r.json())
      .then((data) => {
        if (data.models) {
          setAvailableModels(data.models)
          const preferred = data.models.find((m: AvailableModel) => m.isDefault)
            ?? data.models.find((m: AvailableModel) => m.configured)
            ?? data.models[0]
          if (preferred && !model) setModel(preferred.id)
        }
      })
      .catch((e) => console.error('Failed to fetch available models:', e))

    fetch('/api/plugins/team/teams')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTeams(data) })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-derive ID from name unless user manually edited it
  const handleNameChange = (v: string) => {
    setName(v)
    if (!idManual) {
      setId(v.toLowerCase().replace(/[^a-z0-9]/g, ''))
    }
  }

  const handleIdChange = (v: string) => {
    setIdManual(true)
    setId(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = () => setAvatarPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const clearAvatar = () => {
    setAvatarFile(null)
    setAvatarPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const valid = name.trim().length > 0 && id.trim().length > 0

  return (
    <div className="flex flex-col gap-5">
      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div
          className="relative size-20 rounded-xl border-2 border-dashed border-border bg-muted/30 flex items-center justify-center overflow-hidden cursor-pointer hover:border-foreground/30 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          {avatarPreview ? (
            <>
              <img src={avatarPreview} alt="Preview" className="absolute inset-0 w-full h-full object-cover" />
              <button
                className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-background/80 hover:bg-background text-foreground"
                onClick={(e) => { e.stopPropagation(); clearAvatar() }}
              >
                <X className="size-3" />
              </button>
            </>
          ) : (
            <Upload className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium">Profile Image</div>
          <div className="text-xs text-muted-foreground">JPG or PNG, shown in team grid and across the app</div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleAvatarChange}
        />
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-name">Name</Label>
        <Input
          id="agent-name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Pixel"
          autoFocus
        />
      </div>

      {/* ID */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-id">ID</Label>
        <Input
          id="agent-id"
          value={id}
          onChange={(e) => handleIdChange(e.target.value)}
          placeholder="e.g. pixel"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Used in OpenClaw config and workspace paths. Lowercase, no spaces.
        </p>
      </div>

      {/* Emoji */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-emoji">Emoji</Label>
        <Input
          id="agent-emoji"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder="🤖"
          className="w-20"
        />
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <Label>Model</Label>
        <ModelSelect
          value={model}
          onChange={setModel}
          models={availableModels}
        />
      </div>

      {/* Soul */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-soul">Soul (SOUL.md)</Label>
        <textarea
          id="agent-soul"
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
          placeholder="You are {name} — describe who this agent is, what they do, how they behave..."
          className="w-full min-h-[120px] bg-muted/30 border border-border rounded-lg p-3 text-sm font-mono leading-relaxed text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Written to the selected runtime workspace as SOUL.md
        </p>
      </div>

      {/* Advanced */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group cursor-pointer">
          <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
          Advanced
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4 pt-3">
          {/* Role */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-role">Role</Label>
            <Input
              id="agent-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Research Agent"
            />
          </div>

          {/* Vibe */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-vibe">Vibe</Label>
            <Input
              id="agent-vibe"
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              placeholder="e.g. Sharp, credible, practical, curious"
            />
          </div>

          {/* Primary Function */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-primary-function">Primary Function</Label>
            <Input
              id="agent-primary-function"
              value={primaryFunction}
              onChange={(e) => setPrimaryFunction(e.target.value)}
              placeholder="e.g. Multi-source research, evidence gathering"
            />
          </div>

          {/* Tools */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-tools">Tools (TOOLS.md)</Label>
            <textarea
              id="agent-tools"
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder="Tool usage guidance for the agent..."
              className="w-full min-h-[80px] bg-muted/30 border border-border rounded-lg p-3 text-sm font-mono leading-relaxed text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary"
              spellCheck={false}
            />
          </div>

          {/* Team */}
          {teams.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="agent-team">Team</Label>
              <select
                id="agent-team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full h-9 bg-muted/30 border border-border rounded-lg px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">None</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={() => onSubmit({ id, name, emoji, model, soul, role, vibe, primaryFunction, tools, teamId }, avatarFile)}
          disabled={!valid || submitting}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
          Create Agent
        </Button>
      </div>
    </div>
  )
}
