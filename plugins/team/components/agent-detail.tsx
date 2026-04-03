'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Loader2, Camera, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AgentAvatar } from '@/components/agent-avatar'
import { MarkdownContent } from '@/components/markdown-content'
import { ModelSelect } from '@/components/model-select'
import type { AvailableModel } from '@bakin/models/types'
import { useAgentStore, useAgentColor } from '../hooks/use-agent-store'
import type { AgentProfile, SkillSummary } from '../types'
import type { AgentUsage } from '../../../src/core/agent-usage'

type Tab = 'profile' | 'soul' | 'rules' | 'tools' | 'skills' | 'memory' | 'stats'

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'soul', label: 'Soul' },
  { id: 'rules', label: 'Rules' },
  { id: 'tools', label: 'Tools' },
  { id: 'skills', label: 'Skills' },
  { id: 'memory', label: 'Memory' },
  { id: 'stats', label: 'Stats' },
]

export function AgentDetail({ agentId }: { agentId: string }) {
  const router = useRouter()
  const accentColor = useAgentColor(agentId)
  const teams = useAgentStore((s) => s.teams)
  const displaySettings = useAgentStore((s) => s.displaySettings)
  const reload = useAgentStore((s) => s.load)
  const currentTeamId = displaySettings[agentId]?.teamId ?? ''
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [loading, setLoading] = useState(true)
  const [avatarKey, setAvatarKey] = useState(0)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [savingModel, setSavingModel] = useState(false)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/plugins/team/${agentId}`)
      .then((r) => r.json())
      .then((data) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false))
    fetch('/api/plugins/models/available')
      .then((r) => r.json())
      .then((data) => { if (data.models) setAvailableModels(data.models) })
      .catch(() => {})
  }, [agentId])

  // Resolve profile.model (e.g. "claude-opus-4-6") to a full available model ID
  const resolvedModelId = availableModels.find((m) => m.id.startsWith(profile?.model ?? ''))?.id ?? profile?.model ?? ''

  const handleModelChange = async (modelId: string) => {
    if (!profile) return
    setSavingModel(true)
    try {
      const ownModel = modelId === '__default__' ? null : modelId
      const res = await fetch('/api/plugins/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, ownModel }),
      })
      if (res.ok) {
        setProfile({ ...profile, model: modelId === '__default__' ? 'default' : modelId })
        setRestartNeeded(true)
      }
    } finally {
      setSavingModel(false)
    }
  }

  const handleGatewayRestart = async () => {
    setRestarting(true)
    try {
      await fetch('/api/plugins/models/gateway/restart', { method: 'POST' })
      setRestartNeeded(false)
    } catch {
      // silent — banner stays visible so user can retry
    } finally {
      setRestarting(false)
    }
  }

  const handleTeamChange = async (teamId: string) => {
    const res = await fetch(`/api/plugins/team/${agentId}/team`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: teamId || null }),
    })
    if (res.ok) await reload()
  }

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/plugins/team/${agentId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to delete agent' }))
        setDeleteError(err.error || 'Failed to delete agent')
        return
      }
      await reload()
      router.push('/team')
    } finally {
      setDeleting(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('avatar', file)
    const res = await fetch(`/api/plugins/team/${agentId}/avatar`, {
      method: 'POST',
      body: formData,
    })
    if (res.ok) setAvatarKey(Date.now())
    if (avatarInputRef.current) avatarInputRef.current.value = ''
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Agent not found
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push('/team')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div
          className="relative group cursor-pointer shrink-0"
          onClick={() => avatarInputRef.current?.click()}
        >
          <div className="size-16 rounded-full overflow-hidden bg-muted">
            <img
              src={`/api/plugins/team/${agentId}/avatar${avatarKey ? `?t=${avatarKey}` : ''}`}
              alt={profile?.name ?? agentId}
              className="w-full h-full object-cover object-top"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
          <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Camera className="size-5 text-white" />
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold">{profile.name}</h1>
          <div className="text-sm text-muted-foreground">{profile.role}</div>
          <div className="flex items-center gap-2 mt-1">
            {availableModels.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <ModelSelect
                  value={resolvedModelId}
                  onChange={handleModelChange}
                  models={availableModels}
                  defaultLabel="Use default"
                  className="h-6 w-48 text-xs"
                />
                {savingModel && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
              </div>
            ) : (
              <span className="text-xs font-mono text-muted-foreground">{profile.model}</span>
            )}
            {profile.subagentPerms && (
              <Badge variant="outline" className="text-[10px]">
                manages: {profile.subagentPerms.join(', ')}
              </Badge>
            )}
            {teams.length > 0 && (
              <select
                value={currentTeamId}
                onChange={(e) => handleTeamChange(e.target.value)}
                className="h-6 rounded border border-border bg-transparent px-1.5 text-[10px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        {agentId !== 'main-operator' && (
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      {/* Restart banner */}
      {restartNeeded && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <span className="text-sm text-amber-400">
            Model updated. Restart the gateway to apply changes.
          </span>
          <Button
            onClick={handleGatewayRestart}
            disabled={restarting}
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          >
            {restarting ? 'Restarting...' : 'Restart Gateway'}
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`px-3 py-2 text-sm transition-colors ${
              activeTab === tab.id
                ? 'text-foreground border-b-2 font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            style={activeTab === tab.id ? { borderColor: accentColor } : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'profile' && <ProfileTab profile={profile} />}
        {activeTab === 'soul' && <FileEditorTab agentId={agentId} filename="SOUL.md" content={profile.soul} />}
        {activeTab === 'rules' && <FileEditorTab agentId={agentId} filename="AGENTS.md" content={profile.rules} />}
        {activeTab === 'tools' && <FileEditorTab agentId={agentId} filename="TOOLS.md" content={profile.tools} />}
        {activeTab === 'skills' && <SkillsTab agentId={agentId} />}
        {activeTab === 'memory' && <MemoryTab agentId={agentId} />}
        {activeTab === 'stats' && <StatsTab agentId={agentId} />}
      </div>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={(v) => { if (!v && !deleting) { setDeleteOpen(false); setDeleteError(null) } }}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete agent?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove <span className="text-foreground font-medium">{profile.name}</span> from
            the agent roster and restart the OpenClaw gateway. The workspace will be moved to trash.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            This cannot be undone from the UI.
          </p>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteError(null) }} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><Loader2 className="size-3.5 animate-spin mr-1.5" />Deleting...</> : 'Delete Agent'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────

function ProfileSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-2">{label}</h3>
      {children}
    </section>
  )
}

function ProfileMarkdown({ content }: { content: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs [&_.prose-invert]:text-xs [&_.prose-invert]:leading-relaxed [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_p]:text-xs [&_li]:text-xs [&_code]:text-[11px] [&_pre]:text-[11px]">
      <MarkdownContent content={content} />
    </div>
  )
}

function ProfileTab({ profile }: { profile: AgentProfile }) {
  return (
    <div className="space-y-5 max-w-2xl">
      {profile.identity && (
        <ProfileSection label="Identity">
          <ProfileMarkdown content={profile.identity} />
        </ProfileSection>
      )}
      {profile.soul && (
        <ProfileSection label="Soul">
          <ProfileMarkdown content={profile.soul} />
        </ProfileSection>
      )}
      {profile.rules && (
        <ProfileSection label="Rules">
          <ProfileMarkdown content={profile.rules} />
        </ProfileSection>
      )}
      {profile.tools && (
        <ProfileSection label="Tools">
          <ProfileMarkdown content={profile.tools} />
        </ProfileSection>
      )}
      {profile.heartbeatMd && (
        <ProfileSection label="Heartbeat">
          <ProfileMarkdown content={profile.heartbeatMd} />
        </ProfileSection>
      )}
      <ProfileSection label="Workspace">
        <code className="text-[11px] text-muted-foreground font-mono">{profile.workspacePath}</code>
      </ProfileSection>
    </div>
  )
}

// ─── File Editor Tab ─────────────────────────────────────────────────────────

function FileEditorTab({ agentId, filename, content: initialContent }: {
  agentId: string
  filename: string
  content: string | null
}) {
  const [content, setContent] = useState(initialContent ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setContent(initialContent ?? '')
    setDirty(false)
    setSaved(false)
  }, [initialContent, agentId, filename])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await fetch(`/api/plugins/team/${agentId}/files/${filename}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [agentId, filename, content])

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty) handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dirty, handleSave])

  if (initialContent === null) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {filename} does not exist in this agent&apos;s workspace.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono text-muted-foreground">{filename}</code>
          {dirty && <span className="text-xs text-amber-400">modified</span>}
          {saved && <span className="text-xs text-green-400">saved</span>}
        </div>
        <Button
          size="sm"
          variant={dirty ? 'default' : 'secondary'}
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? <Loader2 className="size-3 animate-spin mr-1.5" /> : <Save className="size-3 mr-1.5" />}
          Save
        </Button>
      </div>
      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); setDirty(true) }}
        className="w-full min-h-[500px] bg-muted/30 border border-border rounded-lg p-4 text-sm font-mono leading-relaxed text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary"
        spellCheck={false}
      />
    </div>
  )
}

// ─── Skills Tab ──────────────────────────────────────────────────────────────

function SkillsTab({ agentId }: { agentId: string }) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/plugins/team/${agentId}/skills`)
      .then((r) => r.json())
      .then((data) => setSkills(data.skills ?? []))
      .finally(() => setLoading(false))
  }, [agentId])

  useEffect(() => {
    if (!selectedSkill) { setSkillContent(null); return }
    fetch(`/api/plugins/team/${agentId}/skills/${selectedSkill}`)
      .then((r) => r.json())
      .then((data) => setSkillContent(data.content ?? null))
  }, [agentId, selectedSkill])

  if (loading) return <div className="text-sm text-muted-foreground">Loading skills...</div>
  if (skills.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">No skills installed</div>

  return (
    <div className="flex gap-6">
      <div className="w-48 shrink-0 space-y-1">
        {skills.map((s) => (
          <button
            key={s.id}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              selectedSkill === s.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setSelectedSkill(s.id)}
          >
            {s.name}
            {s.hasSkillMd && <span className="text-[10px] text-muted-foreground ml-1">SKILL.md</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        {skillContent ? (
          <div className="bg-muted/30 rounded-lg p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed max-h-[600px] overflow-auto">
            {skillContent}
          </div>
        ) : selectedSkill ? (
          <div className="text-sm text-muted-foreground">No SKILL.md found</div>
        ) : (
          <div className="text-sm text-muted-foreground">Select a skill to view</div>
        )}
      </div>
    </div>
  )
}

// ─── Memory Tab ──────────────────────────────────────────────────────────────

function MemoryTab({ agentId }: { agentId: string }) {
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/plugins/team/${agentId}/memory`)
      .then((r) => r.json())
      .then((data) => setFiles(data.files ?? []))
      .finally(() => setLoading(false))
  }, [agentId])

  useEffect(() => {
    if (!selectedFile) { setContent(null); return }
    fetch(`/api/plugins/team/${agentId}/memory/${selectedFile}`)
      .then((r) => r.json())
      .then((data) => setContent(data.content ?? null))
  }, [agentId, selectedFile])

  if (loading) return <div className="text-sm text-muted-foreground">Loading memory...</div>
  if (files.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">No memory files</div>

  return (
    <div className="flex gap-6">
      <div className="w-48 shrink-0 space-y-1 max-h-[500px] overflow-auto">
        {files.map((f) => (
          <button
            key={f}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-mono transition-colors ${
              selectedFile === f ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setSelectedFile(f)}
          >
            {f.replace('.md', '')}
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        {content ? (
          <div className="bg-muted/30 rounded-lg p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed max-h-[600px] overflow-auto">
            {content}
          </div>
        ) : selectedFile ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="text-sm text-muted-foreground">Select a date to view</div>
        )}
      </div>
    </div>
  )
}

// ─── Stats Tab ───────────────────────────────────────────────────────────────

function StatsTab({ agentId }: { agentId: string }) {
  const [usage, setUsage] = useState<AgentUsage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/plugins/team/${agentId}/stats`)
      .then((r) => r.json())
      .then((data) => setUsage(data.usage ?? null))
      .finally(() => setLoading(false))
  }, [agentId])

  if (loading) return <div className="text-sm text-muted-foreground">Loading stats...</div>

  if (!usage) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No session data available</div>
  }

  const fmt = (n: number) => n.toLocaleString()
  const fmtCost = (n: number) => `$${n.toFixed(4)}`

  return (
    <div className="max-w-lg space-y-6">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Latest Session</h3>
        <div className="bg-muted/30 rounded-lg p-4 space-y-2">
          <Row label="Model" value={usage.model} />
          <Row label="Messages" value={fmt(usage.messages)} />
          <Row label="Session started" value={usage.sessionStarted ? new Date(usage.sessionStarted).toLocaleString() : 'N/A'} />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Token Usage</h3>
        <div className="bg-muted/30 rounded-lg p-4 space-y-2">
          <Row label="Input" value={fmt(usage.tokens.input)} />
          <Row label="Output" value={fmt(usage.tokens.output)} />
          <Row label="Cache read" value={fmt(usage.tokens.cacheRead)} />
          <Row label="Cache write" value={fmt(usage.tokens.cacheWrite)} />
          <Row label="Total" value={fmt(usage.tokens.total)} highlight />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Cost</h3>
        <div className="bg-muted/30 rounded-lg p-4 space-y-2">
          <Row label="Input" value={fmtCost(usage.cost.input)} />
          <Row label="Output" value={fmtCost(usage.cost.output)} />
          <Row label="Cache read" value={fmtCost(usage.cost.cacheRead)} />
          <Row label="Cache write" value={fmtCost(usage.cost.cacheWrite)} />
          <Row label="Total" value={fmtCost(usage.cost.total)} highlight />
        </div>
      </section>
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={highlight ? 'font-semibold text-foreground' : 'font-mono text-foreground'}>{value}</span>
    </div>
  )
}
