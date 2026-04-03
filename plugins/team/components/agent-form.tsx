'use client'

import { useState, useRef } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface AgentFormData {
  id: string
  name: string
  emoji: string
  model: string
  soul: string
}

const DEFAULT_MODELS = [
  'anthropic/claude-sonnet-4-20250514',
  'anthropic/claude-opus-4-20250514',
  'anthropic/claude-haiku-4-5-20251001',
]

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
  const [model, setModel] = useState(DEFAULT_MODELS[0])
  const [soul, setSoul] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
        <Label htmlFor="agent-model">Model</Label>
        <select
          id="agent-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {DEFAULT_MODELS.map((m) => (
            <option key={m} value={m}>{m.replace('anthropic/', '')}</option>
          ))}
        </select>
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
          Written directly to ~/.openclaw/workspaces/{id}/SOUL.md
        </p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={() => onSubmit({ id, name, emoji, model, soul }, avatarFile)}
          disabled={!valid || submitting}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
          Create Agent
        </Button>
      </div>
    </div>
  )
}
