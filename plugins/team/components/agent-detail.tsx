'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from '@bakin/sdk/hooks'
import { ArrowLeft, Save, Loader2, Camera, Trash2, Copy } from 'lucide-react'
import { Badge } from "@bakin/sdk/ui"
import { Button } from "@bakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@bakin/sdk/ui"
import { AgentAvatar } from "@bakin/sdk/components"
import { Skeleton } from "@bakin/sdk/ui"
import { MarkdownContent } from "@bakin/sdk/components"
import { ModelSelect } from "@bakin/sdk/components"
import { useGatewayStatus } from "@bakin/sdk/hooks"
import type { AvailableModel } from "@bakin/sdk/types"
import { useAgentStore, useAgentColor, useMainAgentId, usePackageState } from '@bakin/sdk/hooks'
import { useQueryState } from "@bakin/sdk/hooks"
import { PackageStateBadge } from './package-state-badge'
import { AdoptDialog } from './adopt-dialog'
import { KnowledgeToggleList } from './knowledge-toggle-list'
import type { AgentProfile, SkillSummary, PackageStateRow } from '../types'
import type { AgentUsage } from '../../../src/core/agent-usage'

type Tab = 'profile' | 'soul' | 'rules' | 'tools' | 'skills' | 'knowledge' | 'memory' | 'stats'

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'soul', label: 'Soul' },
  { id: 'rules', label: 'Rules' },
  { id: 'tools', label: 'Tools' },
  { id: 'skills', label: 'Skills' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'memory', label: 'Memory' },
  { id: 'stats', label: 'Stats' },
]

export function AgentDetail({ agentId }: { agentId: string }) {
  const router = useRouter()
  const accentColor = useAgentColor(agentId)
  const mainAgentId = useMainAgentId()
  const teams = useAgentStore((s) => s.teams)
  const displaySettings = useAgentStore((s) => s.displaySettings)
  const reload = useAgentStore((s) => s.load)
  const packageState = usePackageState(agentId)
  const currentTeamId = displaySettings[agentId]?.teamId ?? ''
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [tabParam, setTabParam] = useQueryState('tab', 'profile')
  const activeTab = (TABS.some((t) => t.id === tabParam) ? tabParam : 'profile') as Tab
  const setActiveTab = (t: Tab) => setTabParam(t)
  const [loading, setLoading] = useState(true)
  const [avatarKey, setAvatarKey] = useState(0)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [savingModel, setSavingModel] = useState(false)
  const gateway = useGatewayStatus()

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
      .catch((e) => console.error('Failed to fetch available models:', e))
  }, [agentId])

  const profileModel = profile?.model ?? ''
  const resolvedModelId = availableModels.find((m) => m.id === profileModel)?.id ?? profileModel

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
        gateway.markDirty()
        // Refetch profile to get the correct effective model
        const updated = await fetch(`/api/plugins/team/${agentId}`).then((r) => r.json())
        setProfile(updated)
      }
    } finally {
      setSavingModel(false)
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
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex flex-col gap-2 flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-40 w-full" />
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
        {agentId !== mainAgentId && (
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      {/* Restart banner */}
      {gateway.restartNeeded && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <span className="text-sm text-amber-400">
            Gateway config out of sync. Restart to apply changes.
          </span>
          <Button
            onClick={gateway.restart}
            disabled={gateway.restarting}
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          >
            {gateway.restarting ? 'Restarting...' : 'Restart Gateway'}
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
        {activeTab === 'profile' && <ProfileTab profile={profile} agentId={agentId} packageState={packageState} />}
        {activeTab === 'soul' && <FileEditorTab agentId={agentId} filename="SOUL.md" content={profile.soul} />}
        {activeTab === 'rules' && <FileEditorTab agentId={agentId} filename="AGENTS.md" content={profile.rules} />}
        {activeTab === 'tools' && <FileEditorTab agentId={agentId} filename="TOOLS.md" content={profile.tools} />}
        {activeTab === 'skills' && <SkillsTab agentId={agentId} />}
        {activeTab === 'knowledge' && <KnowledgeTab agentId={agentId} packageState={packageState} />}
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

function ProfileTab({
  profile,
  agentId,
  packageState,
}: {
  profile: AgentProfile
  agentId: string
  packageState: PackageStateRow | undefined
}) {
  return (
    <div className="space-y-5 max-w-2xl">
      <PackageCard agentId={agentId} packageState={packageState} />
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

// ─── Package Card (lives inside Profile Tab) ─────────────────────────────────

function CliHint({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard api unavailable — fail quietly, the command is visible
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <code className="flex-1 font-mono text-foreground">{command}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy'}
        aria-label="Copy command"
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  )
}

function PackageEntryFields({ entry, packageId }: { entry: NonNullable<PackageStateRow['entry']>; packageId?: string }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      {packageId && (
        <>
          <dt className="text-muted-foreground">Package</dt>
          <dd className="font-mono text-foreground break-all">{packageId}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Source</dt>
      <dd className="font-mono text-foreground break-all">{entry.source}</dd>
      {entry.ref && (
        <>
          <dt className="text-muted-foreground">Ref</dt>
          <dd className="font-mono text-foreground">{entry.ref}</dd>
        </>
      )}
      {entry.commitSha && (
        <>
          <dt className="text-muted-foreground">Commit</dt>
          <dd className="font-mono text-foreground">{entry.commitSha.slice(0, 7)}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Installed</dt>
      <dd className="text-foreground">{entry.installedAt}</dd>
      {entry.dependencies && entry.dependencies.length > 0 && (
        <>
          <dt className="text-muted-foreground">Depends on</dt>
          <dd className="flex flex-wrap gap-1">
            {entry.dependencies.map((d) => (
              <Badge key={d} variant="outline" className="text-[10px] font-mono">{d}</Badge>
            ))}
          </dd>
        </>
      )}
    </dl>
  )
}

function PackageCard({ agentId, packageState }: { agentId: string; packageState: PackageStateRow | undefined }) {
  // Default to "unmanaged" when the API hasn't reported a row at all — the
  // most common reason is the agent exists in OpenClaw but has never been
  // adopted, which is the same thing as state=unmanaged.
  const state = packageState?.state ?? 'unmanaged'
  const refreshPackageStates = useAgentStore((s) => s.refreshPackageStates)
  const [adoptOpen, setAdoptOpen] = useState(false)
  return (
    <ProfileSection label="Package">
      <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <PackageStateBadge state={state} packageId={packageState?.packageId} />
          {state === 'unmanaged' && (
            <Button size="sm" onClick={() => setAdoptOpen(true)}>
              Adopt
            </Button>
          )}
        </div>
        {packageState?.entry && (state === 'managed' || state === 'adopted') && (
          <PackageEntryFields entry={packageState.entry} packageId={packageState.packageId} />
        )}
        {state === 'drifted' && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Projection sha mismatch detected. Repair from the CLI:
            </p>
            <CliHint command="bakin install agent-assets" />
          </div>
        )}
        {state === 'update-available' && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              A newer version of the source package is available. Update from the CLI:
            </p>
            <CliHint command={`bakin agents update ${agentId}`} />
          </div>
        )}
      </div>
      <AdoptDialog
        open={adoptOpen}
        onOpenChange={setAdoptOpen}
        agentId={agentId}
        onAdopted={() => { refreshPackageStates() }}
      />
    </ProfileSection>
  )
}

// ─── Knowledge Tab ───────────────────────────────────────────────────────────

function KnowledgeTab({ agentId, packageState }: { agentId: string; packageState: PackageStateRow | undefined }) {
  const state = packageState?.state ?? 'unmanaged'
  if (state === 'managed' || state === 'adopted') {
    return (
      <div className="max-w-2xl">
        <KnowledgeToggleList agentId={agentId} />
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
      <div className="text-base font-medium text-foreground mb-1">Coming soon</div>
      <p className="text-sm max-w-md">
        Knowledge management requires a managed agent-package. Adopt this agent in the Package card on the Profile tab to unlock per-lesson toggles.
      </p>
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

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
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

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
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
          <Skeleton className="h-40 w-full" />
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

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

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
