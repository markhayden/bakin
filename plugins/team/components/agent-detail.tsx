'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useHistoryBack } from '@makinbakin/sdk/hooks'
import { ArrowLeft, Camera, Trash2, BookOpen, Sparkles, Calendar } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { Skeleton } from "@makinbakin/sdk/ui"
import { useRuntimeStatus, useAvailableModels } from "@makinbakin/sdk/hooks"
import { useAgentStore, useMainAgentId, usePackageState } from '@makinbakin/sdk/hooks'
import { useQueryState } from "@makinbakin/sdk/hooks"
import { LessonToggleList } from './lesson-toggle-list'
import { MarkdownEditTab } from './markdown-edit-tab'
import { HeartbeatTab } from './heartbeat-tab'
import { ActiveContextTab } from './active-context-tab'
import { OverviewTab } from './overview-tab'
import { DiagnosticsTab } from './diagnostics-tab'
import { EmptyState, ConfirmDialog, UnderlineTabs } from '@makinbakin/sdk/components'
import type { AgentProfile, SkillSummary, PackageStateRow } from '../types'

type Tab = 'overview' | 'diagnostics' | 'identity' | 'soul' | 'memory' | 'heartbeat' | 'rules' | 'tools' | 'skills' | 'lessons' | 'active-context'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'identity', label: 'Identity' },
  { id: 'soul', label: 'Soul' },
  { id: 'memory', label: 'Memory' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'rules', label: 'AGENTS.md' },
  { id: 'tools', label: 'Tools' },
  { id: 'skills', label: 'Skills' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'active-context', label: 'Active Context' },
]

export function AgentDetail({ agentId }: { agentId: string }) {
  const router = useRouter()
  const goBack = useHistoryBack('/team')
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
  const availableModels = useAvailableModels()
  const [savingModel, setSavingModel] = useState(false)
  const runtimeStatus = useRuntimeStatus()

  useEffect(() => {
    setLoading(true)
    fetch(`/api/plugins/team/${agentId}`)
      .then((r) => r.json())
      .then((data) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false))
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
        runtimeStatus.markDirty()
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
    <div className="space-y-4 pb-12">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon-sm" onClick={goBack} aria-label="Back to agents">
          <ArrowLeft className="size-4" />
        </Button>
        <div
          className="relative group cursor-pointer shrink-0"
          onClick={() => avatarInputRef.current?.click()}
        >
          <div className="size-16 rounded-full overflow-hidden bg-muted">
            {profile?.headshot || avatarKey ? (
              <img
                src={`/api/plugins/team/${agentId}/avatar${avatarKey ? `?t=${avatarKey}` : ''}`}
                alt={profile?.name ?? agentId}
                className="w-full h-full object-cover object-top"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <div className="flex size-full items-center justify-center bg-muted text-lg font-semibold text-muted-foreground">
                {(profile?.emoji || profile?.name?.charAt(0) || agentId.charAt(0)).toUpperCase()}
              </div>
            )}
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
        <div className="flex-1 min-w-0 flex items-center gap-6 flex-wrap">
          <h1 className="text-xl font-semibold leading-tight">{profile.name}</h1>
          {profile.role && (
            <span className="text-sm text-muted-foreground">{profile.role}</span>
          )}
          <code
            className="text-[11px] font-mono text-muted-foreground/70 truncate min-w-0 max-w-md"
            title={profile.workspacePath}
          >
            {profile.workspacePath}
          </code>
        </div>
        {agentId !== mainAgentId && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => setDeleteOpen(true)}
            aria-label={`Delete ${profile.name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      {/* Restart banner */}
      {runtimeStatus.restartNeeded && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <span className="text-sm text-amber-400">
            Runtime config out of sync. Restart to apply changes.
          </span>
          <Button
            onClick={runtimeStatus.restart}
            disabled={runtimeStatus.restarting}
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          >
            {runtimeStatus.restarting ? 'Restarting...' : 'Restart Runtime'}
          </Button>
        </div>
      )}

      {/* Tabs */}
      <UnderlineTabs
        tabs={TABS}
        value={activeTab}
        onValueChange={(tabId) => setActiveTab(tabId as Tab)}
        ariaLabel="Agent sections"
        idPrefix="agent-detail"
        className="min-w-0 overflow-x-auto overflow-y-hidden"
      />

      {/* Tab Content */}
      <div
        id={`agent-detail-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`agent-detail-tab-${activeTab}`}
        className="min-h-[400px]"
      >
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
        {activeTab === 'diagnostics' && <DiagnosticsTab agentId={agentId} />}
        {activeTab === 'memory' && <MemoryTab agentId={agentId} />}
        {activeTab === 'heartbeat' && <HeartbeatTab agentId={agentId} />}
        {activeTab === 'identity' && <MarkdownEditTab agentId={agentId} filename="IDENTITY.md" initialContent={profile.identity} />}
        {activeTab === 'soul' && <MarkdownEditTab agentId={agentId} filename="SOUL.md" initialContent={profile.soul} />}
        {activeTab === 'rules' && <MarkdownEditTab agentId={agentId} filename="AGENTS.md" initialContent={profile.rules} />}
        {activeTab === 'tools' && <MarkdownEditTab agentId={agentId} filename="TOOLS.md" initialContent={profile.tools} />}
        {activeTab === 'skills' && <SkillsTab agentId={agentId} />}
        {activeTab === 'lessons' && <LessonsTab agentId={agentId} packageState={packageState} />}
        {activeTab === 'active-context' && <ActiveContextTab agentId={agentId} />}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        busy={deleting}
        busyLabel="Deleting..."
        title="Delete agent?"
        description={
          <>
            This will remove <span className="text-foreground font-medium">{profile.name}</span> from
            the agent roster and restart the active runtime. The workspace will be moved to trash.
            <span className="block text-xs text-muted-foreground/70 mt-1">This cannot be undone from the UI.</span>
          </>
        }
        error={deleteError}
        confirmLabel="Delete Agent"
        onConfirm={handleDelete}
        onCancel={() => { setDeleteOpen(false); setDeleteError(null) }}
      />
    </div>
  )
}


// ─── Lessons Tab ─────────────────────────────────────────────────────────────

function LessonsTab({ agentId, packageState }: { agentId: string; packageState: PackageStateRow | undefined }) {
  const state = packageState?.state ?? 'unmanaged'
  if (state === 'managed') {
    return (
      <div className="w-full">
        <LessonToggleList agentId={agentId} />
      </div>
    )
  }
  return (
    <EmptyState
      variant="panel"
      icon={BookOpen}
      title="Lessons require a package"
      description="Lessons let you toggle individual pieces of curriculum on or off per agent — useful for narrowing the persona to a task. Adopt this agent into a package on the Overview tab to unlock per-lesson toggles."
    />
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
  if (skills.length === 0) {
    return (
      <EmptyState
        variant="panel"
        icon={Sparkles}
        title="No skills installed"
        description="Skills are reusable runtime capabilities the agent can invoke. Install a skill-pack via the CLI to add some — `bakin packages install <source>`."
      />
    )
  }

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
  if (files.length === 0) {
    return (
      <EmptyState
        variant="panel"
        icon={Calendar}
        title="No memory yet"
        description="Per-day memory files appear here once this agent writes its first lesson via `bakin_exec_log_memory`. Memory accumulates as the agent works through tasks."
      />
    )
  }

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
