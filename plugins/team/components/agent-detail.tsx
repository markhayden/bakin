'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Calendar, Camera, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { Section } from '@makinbakin/sdk/layout'
import { useHistoryBack, useRouter } from '@makinbakin/sdk/navigation'
import {
  AgentAvatar,
  ConfirmDialog,
  Page,
  PageBody,
  PageHeader,
  StatusBadge,
} from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  DropdownMenuItem,
  FileInput,
  Skeleton,
  SystemState,
  Tabs,
  TabsList,
  TabsTrigger,
  type FileInputHandle,
} from '@makinbakin/sdk/ui'
import {
  useAgentStore,
  useAvailableModels,
  useMainAgentId,
  usePackageState,
  useQueryState,
  useRuntimeStatus,
} from '@makinbakin/sdk/hooks'
import { ActiveContextTab } from './active-context-tab'
import { DiagnosticsTab } from './diagnostics-tab'
import { HeartbeatTab } from './heartbeat-tab'
import { LessonToggleList } from './lesson-toggle-list'
import { MarkdownEditTab } from './markdown-edit-tab'
import { OverviewTab } from './overview-tab'
import type { AgentProfile, PackageStateRow, SkillSummary } from '../types'

type Tab =
  | 'overview'
  | 'diagnostics'
  | 'identity'
  | 'soul'
  | 'memory'
  | 'heartbeat'
  | 'rules'
  | 'tools'
  | 'skills'
  | 'lessons'
  | 'active-context'

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
  const reload = useAgentStore((state) => state.load)
  const packageState = usePackageState(agentId)
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [tabParam, setTabParam] = useQueryState('tab', 'overview')
  const activeTab = (TABS.some((tab) => tab.id === tabParam) ? tabParam : 'overview') as Tab
  const [loading, setLoading] = useState(true)
  const [avatarKey, setAvatarKey] = useState(0)
  const avatarInputRef = useRef<FileInputHandle>(null)
  const availableModels = useAvailableModels()
  const [savingModel, setSavingModel] = useState(false)
  const runtimeStatus = useRuntimeStatus()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/plugins/team/${agentId}`)
      .then((response) => response.json())
      .then((data) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false))
  }, [agentId])

  const handleModelChange = async (modelId: string) => {
    if (!profile) return
    setSavingModel(true)
    try {
      const ownModel = modelId === '__default__' ? null : modelId
      const response = await fetch('/api/plugins/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, ownModel }),
      })
      if (response.ok) {
        runtimeStatus.markDirty()
        const updated = await fetch(`/api/plugins/team/${agentId}`).then((result) => result.json())
        setProfile(updated)
      }
    } finally {
      setSavingModel(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const response = await fetch(`/api/plugins/team/${agentId}`, { method: 'DELETE' })
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to delete agent' }))
        setDeleteError(error.error || 'Failed to delete agent')
        return
      }
      await reload()
      router.push('/team')
    } finally {
      setDeleting(false)
    }
  }

  const handleAvatarUpload = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    const formData = new FormData()
    formData.append('avatar', file)
    const response = await fetch(`/api/plugins/team/${agentId}/avatar`, {
      method: 'POST',
      body: formData,
    })
    if (response.ok) setAvatarKey(Date.now())
  }

  if (loading) {
    return (
      <Page>
        <PageHeader title="Agent" eyebrow="Team / agent" />
        <PageBody
          state={(
            <SystemState
              kind="loading"
              scope="page"
              title="Loading agent"
              description="Profile, package, and runtime details will appear when ready."
              preview={<Skeleton className="h-40 w-full" />}
            />
          )}
        />
      </Page>
    )
  }

  if (!profile) {
    return (
      <Page>
        <PageHeader
          navigation={(
            <Button type="button" variant="ghost" size="icon-sm" onClick={goBack} aria-label="Back to agents">
              <ArrowLeft aria-hidden="true" />
            </Button>
          )}
          eyebrow="Team / agent"
          title="Agent not found"
        />
        <PageBody
          state={(
            <SystemState
              kind="error"
              recovery="available"
              scope="page"
              title="Agent not found"
              description="This agent may have been removed or its workspace is unavailable."
              action={<Button type="button" variant="outline" onClick={goBack}>Back to Team</Button>}
            />
          )}
        />
      </Page>
    )
  }

  const avatarUrl = profile.headshot || avatarKey
    ? `/api/plugins/team/${agentId}/avatar${avatarKey ? `?t=${avatarKey}` : ''}`
    : undefined

  return (
    <Page data-agent-detail>
      <PageHeader
        navigation={(
          <Button type="button" variant="ghost" size="icon-sm" onClick={goBack} aria-label="Back to agents">
            <ArrowLeft aria-hidden="true" />
          </Button>
        )}
        eyebrow="Team / agent"
        measure="wide"
        title={(
          <span className="flex min-w-0 items-center gap-bakin-3">
            <span className="group/avatar relative inline-flex shrink-0">
              <AgentAvatar
                agent={{
                  id: agentId,
                  name: profile.name,
                  imageSrc: avatarUrl,
                  initials: profile.emoji || undefined,
                }}
                size="xl"
                decorative
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Change agent image"
                onClick={() => avatarInputRef.current?.open()}
                className="absolute inset-0 size-full rounded-bakin-pill bg-bakin-canvas-default/70 opacity-0 transition-opacity group-hover/avatar:opacity-100 focus-visible:opacity-100"
              >
                <Pencil aria-hidden="true" />
              </Button>
            </span>
            <span>{profile.name}</span>
          </span>
        )}
        description={profile.role || undefined}
        meta={(
          <code
            className="max-w-full truncate font-bakin-typography-family-mono"
            title={profile.workspacePath}
          >
            {profile.workspacePath}
          </code>
        )}
        overflowActionsLabel="Agent actions"
        overflowActions={(
          <>
            <DropdownMenuItem
              onClick={() => avatarInputRef.current?.open()}
            >
              <Camera aria-hidden="true" />
              Change image
            </DropdownMenuItem>
            {agentId !== mainAgentId ? (
              <DropdownMenuItem
                variant="danger"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            ) : null}
          </>
        )}
      />
      <FileInput
        ref={avatarInputRef}
        label="Change agent image"
        accept="image/jpeg,image/png,image/webp"
        onFiles={(files) => void handleAvatarUpload(files)}
      />

      {runtimeStatus.restartNeeded ? (
        <Alert tone="attention">
          <AlertTitle>Runtime configuration is out of sync</AlertTitle>
          <AlertDescription>Restart the runtime to apply this agent’s latest configuration.</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="warning"
              size="sm"
              onClick={runtimeStatus.restart}
              disabled={runtimeStatus.restarting}
            >
              {runtimeStatus.restarting ? 'Restarting…' : 'Restart runtime'}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <Tabs value={activeTab} onValueChange={(tabId) => setTabParam(tabId as Tab)}>
        <TabsList variant="underline" activateOnFocus aria-label="Agent sections">
          {TABS.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              id={`agent-detail-tab-${item.id}`}
              aria-controls={`agent-detail-panel-${item.id}`}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <PageBody>
          <div
            id={`agent-detail-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`agent-detail-tab-${activeTab}`}
            className="flex min-h-96 min-w-0 flex-1 flex-col"
          >
            {activeTab === 'overview' ? (
              <OverviewTab
                agentId={agentId}
                profile={profile}
                packageState={packageState}
                availableModels={availableModels}
                onModelChange={handleModelChange}
                savingModel={savingModel}
              />
            ) : null}
            {activeTab === 'diagnostics' ? <DiagnosticsTab agentId={agentId} /> : null}
            {activeTab === 'memory' ? <MemoryTab agentId={agentId} /> : null}
            {activeTab === 'heartbeat' ? <HeartbeatTab agentId={agentId} /> : null}
            {activeTab === 'identity' ? (
              <MarkdownEditTab agentId={agentId} filename="IDENTITY.md" initialContent={profile.identity} />
            ) : null}
            {activeTab === 'soul' ? (
              <MarkdownEditTab agentId={agentId} filename="SOUL.md" initialContent={profile.soul} />
            ) : null}
            {activeTab === 'rules' ? (
              <MarkdownEditTab agentId={agentId} filename="AGENTS.md" initialContent={profile.rules} />
            ) : null}
            {activeTab === 'tools' ? (
              <MarkdownEditTab agentId={agentId} filename="TOOLS.md" initialContent={profile.tools} />
            ) : null}
            {activeTab === 'skills' ? <SkillsTab agentId={agentId} /> : null}
            {activeTab === 'lessons' ? <LessonsTab agentId={agentId} packageState={packageState} /> : null}
            {activeTab === 'active-context' ? <ActiveContextTab agentId={agentId} /> : null}
          </div>
      </PageBody>

      <ConfirmDialog
        open={deleteOpen}
        busy={deleting}
        busyLabel="Deleting…"
        title="Delete agent?"
        description={(
          <>
            This removes <strong>{profile.name}</strong> from the roster, moves its workspace to trash,
            and restarts the active runtime.
          </>
        )}
        error={deleteError}
        confirmLabel="Delete agent"
        confirmTone="danger"
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleteOpen(false)
          setDeleteError(null)
        }}
      />
    </Page>
  )
}

function LessonsTab({
  agentId,
  packageState,
}: {
  agentId: string
  packageState: PackageStateRow | undefined
}) {
  if (packageState?.state === 'managed') {
    return <LessonToggleList agentId={agentId} />
  }

  return (
    <SystemState
      kind="initial-empty"
      scope="page"
      title="Lessons require a package"
      description="Adopt this agent into a package from Overview to manage its individual curriculum."
      action={(
        <Button type="button" variant="outline" size="sm" disabled>
          <BookOpen aria-hidden="true" />
          Package required
        </Button>
      )}
    />
  )
}

function SkillsTab({ agentId }: { agentId: string }) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/plugins/team/${agentId}/skills`)
      .then((response) => response.json())
      .then((data) => {
        const list: SkillSummary[] = data.skills ?? []
        setSkills(list)
        if (list.length > 0) setSelectedSkill((current) => current ?? list[0].id)
      })
      .finally(() => setLoading(false))
  }, [agentId])

  useEffect(() => {
    if (!selectedSkill) {
      setSkillContent(null)
      return
    }
    setSkillContent(null)
    fetch(`/api/plugins/team/${agentId}/skills/${selectedSkill}`)
      .then((response) => response.json())
      .then((data) => setSkillContent(data.content ?? null))
  }, [agentId, selectedSkill])

  if (loading) {
    return (
      <SystemState
        kind="loading"
        scope="page"
        title="Loading skills"
        description="Installed capabilities will appear when ready."
      />
    )
  }

  if (skills.length === 0) {
    return (
      <SystemState
        kind="initial-empty"
        scope="page"
        title="No skills installed"
        description="Install a skill pack to give this agent reusable runtime capabilities."
        action={(
          <Button type="button" variant="outline" size="sm" disabled>
            <Sparkles aria-hidden="true" />
            No skills
          </Button>
        )}
      />
    )
  }

  return (
    <div className="grid min-w-0 gap-bakin-4 lg:grid-cols-4">
      <aside className="lg:col-span-1">
        <Section as="div" spacing="compact" className="max-h-screen overflow-auto">
          <h2 className="m-0 text-bakin-typography-size-title font-bakin-typography-weight-semibold">
            Installed skills
          </h2>
          <div className="grid gap-bakin-1">
            {skills.map((skill) => (
              <Button
                key={skill.id}
                type="button"
                variant={selectedSkill === skill.id ? 'secondary' : 'ghost'}
                className="w-full justify-between"
                onClick={() => setSelectedSkill(skill.id)}
              >
                <span className="truncate">{skill.name}</span>
                {skill.hasSkillMd ? <StatusBadge tone="neutral" variant="solid">Guide</StatusBadge> : null}
              </Button>
            ))}
          </div>
        </Section>
      </aside>

      <Section spacing="compact" className="min-h-96 lg:col-span-3">
        {skillContent ? (
          <pre className="m-0 max-h-screen overflow-auto whitespace-pre-wrap font-bakin-typography-family-mono text-bakin-typography-size-body leading-relaxed text-bakin-text-primary">
            {skillContent}
          </pre>
        ) : selectedSkill ? (
          <SystemState
            kind="initial-empty"
            scope="inline"
            title="No SKILL.md found"
            description="This capability does not include a readable skill guide."
          />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </Section>
    </div>
  )
}

function MemoryTab({ agentId }: { agentId: string }) {
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/plugins/team/${agentId}/memory`)
      .then((response) => response.json())
      .then((data) => {
        const list: string[] = data.files ?? []
        setFiles(list)
        if (list.length > 0) setSelectedFile((current) => current ?? list[0])
      })
      .finally(() => setLoading(false))
  }, [agentId])

  useEffect(() => {
    if (!selectedFile) {
      setContent(null)
      return
    }
    setContent(null)
    fetch(`/api/plugins/team/${agentId}/memory/${selectedFile}`)
      .then((response) => response.json())
      .then((data) => setContent(data.content ?? null))
  }, [agentId, selectedFile])

  if (loading) {
    return (
      <SystemState
        kind="loading"
        scope="page"
        title="Loading memory"
        description="Daily memory files will appear when ready."
      />
    )
  }

  if (files.length === 0) {
    return (
      <SystemState
        kind="initial-empty"
        scope="page"
        title="No memory yet"
        description="Daily memory files appear after this agent records its first durable lesson."
        action={(
          <Button type="button" variant="outline" size="sm" disabled>
            <Calendar aria-hidden="true" />
            No entries
          </Button>
        )}
      />
    )
  }

  return (
    <div className="grid min-w-0 gap-bakin-4 lg:grid-cols-4">
      <aside className="lg:col-span-1">
        <Section as="div" spacing="compact" className="max-h-screen overflow-auto">
          <h2 className="m-0 text-bakin-typography-size-title font-bakin-typography-weight-semibold">
            Daily memory
          </h2>
          <div className="grid gap-bakin-1">
            {files.map((file) => (
              <Button
                key={file}
                type="button"
                variant={selectedFile === file ? 'secondary' : 'ghost'}
                className="w-full justify-start font-bakin-typography-family-mono"
                onClick={() => setSelectedFile(file)}
              >
                {file.replace('.md', '')}
              </Button>
            ))}
          </div>
        </Section>
      </aside>

      <Section spacing="compact" className="min-h-96 lg:col-span-3">
        {content ? (
          <pre className="m-0 max-h-screen overflow-auto whitespace-pre-wrap font-bakin-typography-family-mono text-bakin-typography-size-body leading-relaxed text-bakin-text-primary">
            {content}
          </pre>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </Section>
    </div>
  )
}
