'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from '@bakin/sdk/hooks'
import { ArrowLeft, Loader2, Camera, Trash2, Copy, Info } from 'lucide-react'
import { Badge } from "@bakin/sdk/ui"
import { Button } from "@bakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@bakin/sdk/ui"
import { Skeleton } from "@bakin/sdk/ui"
import { useGatewayStatus } from "@bakin/sdk/hooks"
import type { AvailableModel } from "@bakin/sdk/types"
import { useAgentStore, useAgentColor, useMainAgentId, usePackageState } from '@bakin/sdk/hooks'
import { useQueryState } from "@bakin/sdk/hooks"
import { PackageStateBadge } from './package-state-badge'
import { AdoptDialog } from './adopt-dialog'
import { KnowledgeToggleList } from './knowledge-toggle-list'
import { MarkdownEditTab } from './markdown-edit-tab'
import { HeartbeatTab } from './heartbeat-tab'
import { ActiveContextTab } from './active-context-tab'
import { OverviewTab } from './overview-tab'
import type { AgentProfile, SkillSummary, PackageStateRow } from '../types'

type Tab = 'overview' | 'memory' | 'heartbeat' | 'soul' | 'rules' | 'tools' | 'skills' | 'knowledge' | 'active-context'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'memory', label: 'Memory' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'soul', label: 'Soul' },
  { id: 'rules', label: 'Rules' },
  { id: 'tools', label: 'Tools' },
  { id: 'skills', label: 'Skills' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'active-context', label: 'Active Context' },
]

export function AgentDetail({ agentId }: { agentId: string }) {
  const router = useRouter()
  const accentColor = useAgentColor(agentId)
  const mainAgentId = useMainAgentId()
  const reload = useAgentStore((s) => s.load)
  const packageState = usePackageState(agentId)
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [tabParam, setTabParam] = useQueryState('tab', 'overview')
  const activeTab = (TABS.some((t) => t.id === tabParam) ? tabParam : 'overview') as Tab
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
        {activeTab === 'overview' && (
          <OverviewTab
            agentId={agentId}
            profile={profile}
            packageState={packageState}
            availableModels={availableModels}
            onModelChange={handleModelChange}
            savingModel={savingModel}
          />
        )}
        {activeTab === 'memory' && <MemoryTab agentId={agentId} />}
        {activeTab === 'heartbeat' && <HeartbeatTab agentId={agentId} />}
        {activeTab === 'soul' && <MarkdownEditTab agentId={agentId} filename="SOUL.md" initialContent={profile.soul} />}
        {activeTab === 'rules' && <MarkdownEditTab agentId={agentId} filename="AGENTS.md" initialContent={profile.rules} />}
        {activeTab === 'tools' && <MarkdownEditTab agentId={agentId} filename="TOOLS.md" initialContent={profile.tools} />}
        {activeTab === 'skills' && <SkillsTab agentId={agentId} />}
        {activeTab === 'knowledge' && <KnowledgeTab agentId={agentId} packageState={packageState} />}
        {activeTab === 'active-context' && <ActiveContextTab agentId={agentId} />}
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

// ─── Package Card (embedded by OverviewTab) ──────────────────────────────────

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

const ADOPT_INFO = `Adopting attaches an agent-package to this agent. Bakin then tracks the source repo + commit, projects the package's knowledge lessons + skills into the workspace, and lets you toggle which lessons are active. Your existing SOUL/IDENTITY/AGENTS/TOOLS files stay on disk untouched.`

export function PackageCard({ agentId, packageState }: { agentId: string; packageState: PackageStateRow | undefined }) {
  // Default to "unmanaged" when the API hasn't reported a row at all — the
  // most common reason is the agent exists in OpenClaw but has never been
  // adopted, which is the same thing as state=unmanaged.
  const state = packageState?.state ?? 'unmanaged'
  const mainAgentId = useMainAgentId()
  const isMain = agentId === mainAgentId
  const refreshPackageStates = useAgentStore((s) => s.refreshPackageStates)
  const [adoptOpen, setAdoptOpen] = useState(false)

  // Main agent is the user's persona — adopting/replacing it doesn't make
  // sense. Show a different framing instead of the Adopt button.
  if (isMain && (state === 'unmanaged' || state === 'absent')) {
    return (
      <section>
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-2">Package</h3>
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">Self-managed</Badge>
            <span className="text-xs text-muted-foreground">main agent</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your main agent is your own persona — its workspace files live with you, not a package template. Adoption is intentionally not offered here.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-2">Package</h3>
      <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <PackageStateBadge state={state} packageId={packageState?.packageId} />
          {state === 'unmanaged' && (
            <Button
              size="sm"
              onClick={() => setAdoptOpen(true)}
              title={ADOPT_INFO}
              aria-label={`Adopt this agent into a package — ${ADOPT_INFO}`}
            >
              <Info className="size-3 mr-1.5" />
              Adopt
            </Button>
          )}
        </div>
        {state === 'unmanaged' && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            This agent isn't tracked by an agent-package. Adopt to enable
            knowledge-lesson toggles, automatic skill projection, and
            update-from-source tracking. Your workspace files stay as-is.
          </p>
        )}
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
    </section>
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

// ─── Skills Tab ──────────────────────────────────────────────────────────────

function SkillsTab({ agentId }: { agentId: string }) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/plugins/team/${agentId}/skills`)
      .then((r) => r.json())
      .then((data) => {
        const list: SkillSummary[] = data.skills ?? []
        setSkills(list)
        // Auto-select the first skill on load so the user never lands on an
        // empty pane wondering what to click.
        if (list.length > 0) setSelectedSkill((current) => current ?? list[0].id)
      })
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
    <div className="flex gap-6 min-h-[calc(100vh-260px)]">
      <div className="w-56 shrink-0 space-y-1 border-r border-border pr-4 max-h-[calc(100vh-260px)] overflow-auto">
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
          <div className="bg-muted/30 rounded-lg p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed h-full overflow-auto">
            {skillContent}
          </div>
        ) : selectedSkill ? (
          <div className="text-sm text-muted-foreground">No SKILL.md found for this skill.</div>
        ) : null}
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
      .then((data) => {
        const list: string[] = data.files ?? []
        setFiles(list)
        // Auto-select the most recent file on load (server returns
        // newest-first by convention).
        if (list.length > 0) setSelectedFile((current) => current ?? list[0])
      })
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
    <div className="flex gap-6 min-h-[calc(100vh-260px)]">
      <div className="w-56 shrink-0 space-y-1 border-r border-border pr-4 max-h-[calc(100vh-260px)] overflow-auto">
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
          <div className="bg-muted/30 rounded-lg p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed h-full overflow-auto">
            {content}
          </div>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </div>
    </div>
  )
}

