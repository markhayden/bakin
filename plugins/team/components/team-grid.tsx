'use client'

import { useMemo, useState } from 'react'
import { PluginLink, useRouter } from '@makinbakin/sdk/navigation'
import { Plus, Settings2, ScrollText } from 'lucide-react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type NodeTypes,
  Position,
  Handle,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AgentAvatar,
  PageHeader,
  StatusBadge,
  WorkspacePage,
  WorkspacePageBody,
  WorkspacePageCompactHeader,
  WorkspacePageHeader,
  PageBody,
  PageCanvas,
} from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardFooter,
  CardMedia,
  Drawer,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  SystemState,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { useRuntimeStatus } from '@makinbakin/sdk/hooks'
import { useAgentStore, useMainAgentId, usePackageState, usePluginJsonFetch } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { buildGraph } from '../lib/build-graph'
import { AgentForm, type AgentFormData } from './agent-form'
import { TeamManager } from './team-manager'
import { PackageStateBadge, type PackageState } from './package-state-badge'
import type { AgentWithStatus } from '../types'
import './team-graph.css'

/**
 * Render a compact package badge on an agent card only when the state is
 * attention-worthy. Healthy states (managed/absent/undefined) leave
 * the card uncluttered — the convention is "no badge means OK."
 */
const ATTENTION_STATES: PackageState[] = ['unmanaged', 'drifted', 'update-available']
const TEAM_PAGE_DESCRIPTION = 'Create and organize agents, choose how they work, and see who is available.'

// ─── Custom Nodes ────────────────────────────────────────────────────────────

interface FounderNodeData extends Record<string, unknown> {
  label: string
}

function FounderNode({ data }: NodeProps) {
  const { label } = data as FounderNodeData
  return (
    <div className="flex w-52 items-center justify-center rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default px-bakin-4 py-bakin-3">
      <div className="truncate font-bakin-typography-weight-semibold text-bakin-text-primary">{label}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-border-subtle" />
    </div>
  )
}

interface AgentNodeData extends Record<string, unknown> {
  agent: AgentWithStatus
}

export function AgentCardNode({ data }: NodeProps) {
  const { agent } = data as AgentNodeData
  const pkgState = usePackageState(agent.id)
  const showBadge = pkgState && ATTENTION_STATES.includes(pkgState.state)

  const statusLabel =
    agent.status === 'working' ? 'working' :
    agent.status === 'online' ? 'online' :
    agent.status === 'available' ? 'available' :
    'offline'
  const statusTone = agent.status === 'working'
    ? 'attention'
    : agent.status === 'online' || agent.status === 'available'
      ? 'success'
      : 'neutral'

  return (
    <Card
      data-team-agent-card=""
      className="w-52 gap-bakin-0"
      interactive={{
        label: `Open ${agent.name}`,
        render: <PluginLink to={`/team/${encodeURIComponent(agent.id)}`} />,
      }}
    >
      <CardMedia className="flex aspect-square w-full items-center justify-center bg-bakin-canvas-default">
        <Handle type="target" position={Position.Top} className="!bg-bakin-border-subtle" />
        {agent.headshot ? (
          <img
            src={agent.headshot}
            alt=""
            className="absolute inset-0 size-full object-cover object-top"
          />
        ) : (
          <AgentAvatar
            agent={{
              id: agent.id,
              name: agent.name,
              initials: agent.emoji || agent.name.charAt(0).toUpperCase(),
            }}
            size="xl"
            decorative
          />
        )}
        <div className="absolute right-bakin-2 top-bakin-2">
          <StatusBadge tone={statusTone} variant="solid" size="xs">
            {statusLabel}
          </StatusBadge>
        </div>
      </CardMedia>
      <div className="flex min-h-20 flex-1 flex-col items-center gap-bakin-1 p-bakin-3 text-center">
        <div className="flex w-full items-center justify-center gap-bakin-2 leading-tight">
          <span className="truncate font-bakin-typography-weight-semibold text-bakin-text-primary">{agent.name}</span>
          {showBadge && pkgState && (
            <PackageStateBadge state={pkgState.state} compact />
          )}
        </div>
        {/* Clipped text: a tooltip is the affordance, not a native title —
            dropping it entirely made the full role unreadable for everyone. */}
        <Tooltip>
          <TooltipTrigger
            render={<div />}
            className="line-clamp-3 w-full text-bakin-typography-size-meta leading-snug text-bakin-text-muted"
          >
            {agent.role || 'No role assigned'}
          </TooltipTrigger>
          <TooltipContent>{agent.role || 'No role assigned'}</TooltipContent>
        </Tooltip>
      </div>
      <CardFooter
        variant="meta"
        className="relative justify-center px-bakin-3 pb-bakin-2 pt-bakin-2 font-bakin-typography-family-mono"
      >
        <Tooltip>
          <TooltipTrigger render={<span />} className="min-w-0 truncate">{agent.model}</TooltipTrigger>
          <TooltipContent>{agent.model}</TooltipContent>
        </Tooltip>
        <Handle type="source" position={Position.Bottom} className="!bg-bakin-border-subtle" />
      </CardFooter>
    </Card>
  )
}

interface SectionNodeData extends Record<string, unknown> {
  label: string
  teamId?: string
  hasContext?: boolean
}

function SectionNode({ data }: NodeProps) {
  const { label, teamId, hasContext } = data as SectionNodeData
  const router = useRouter()
  return (
    <div className="flex items-center justify-center gap-bakin-1 px-bakin-4">
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={(e) => {
          e.stopPropagation()
          if (teamId) router.push(`/team/teams/${encodeURIComponent(teamId)}`)
        }}
        className="whitespace-nowrap uppercase tracking-widest text-bakin-text-muted"
      >
        {label}
      </Button>
      {hasContext && (
        <>
          <ScrollText aria-hidden="true" className="size-bakin-3 text-bakin-signal-info" />
          <span className="sr-only">{label} carries shared context rules</span>
        </>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  )
}

const nodeTypes: NodeTypes = {
  founder: FounderNode,
  agentCard: AgentCardNode,
  section: SectionNode,
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TeamGrid() {
  const router = useRouter()
  const agentsWithStatus = useAgentStore((s) => s.agentsWithStatus)
  const teams = useAgentStore((s) => s.teams)
  const displaySettings = useAgentStore((s) => s.displaySettings)
  const mainAgentId = useMainAgentId()
  const loaded = useAgentStore((s) => s.loaded)
  const reload = useAgentStore((s) => s.load)
  const [showCreate, setShowCreate] = useState(false)
  const [showTeams, setShowTeams] = useState(false)

  // Badge data is best-effort: a failed fetch just renders no badges.
  const teamContextRes = usePluginJsonFetch<{
    ok?: boolean
    teams?: Array<{ teamId: string; content: string | null }>
  }>('team', 'context')
  const teamsWithContext = useMemo(() => {
    if (!teamContextRes.data?.ok) return new Set<string>()
    return new Set(
      (teamContextRes.data.teams ?? [])
        .filter((t) => (t.content ?? '').trim().length > 0)
        .map((t) => t.teamId),
    )
  }, [teamContextRes.data])
  const runtimeStatus = useRuntimeStatus()
  const [submitting, setSubmitting] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<{ data: AgentFormData; avatarFile: File | null } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)


  const { nodes, edges } = useMemo(
    () => loaded
      ? buildGraph({ agents: agentsWithStatus, teams, displaySettings, mainAgentId, teamsWithContext })
      : { nodes: [], edges: [] },
    [agentsWithStatus, teams, displaySettings, mainAgentId, loaded, teamsWithContext],
  )

  // Step 1: form submits → stash data and show confirmation dialog
  const handleFormSubmit = async (data: AgentFormData, avatarFile: File | null) => {
    setCreateError(null)
    setPendingCreate({ data, avatarFile })
  }

  // Step 2: user confirms → actually create the agent
  const handleConfirmCreate = async () => {
    if (!pendingCreate) return
    const { data, avatarFile } = pendingCreate

    setSubmitting(true)
    setCreateError(null)
    try {
      const res = await pluginFetch('team', '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        setCreateError(err.error || 'Failed to create agent')
        return
      }

      // Upload avatar if provided
      if (avatarFile) {
        const formData = new FormData()
        formData.append('avatar', avatarFile)
        await pluginFetch('team', `${data.id}/avatar`, {
          method: 'POST',
          body: formData,
        })
      }

      setPendingCreate(null)
      setShowCreate(false)
      await reload()
      router.push(`/team/${data.id}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (!loaded) {
    return (
      <WorkspacePage mode="immersive">
        <WorkspacePageHeader>
          <PageHeader title="Team" description={TEAM_PAGE_DESCRIPTION} />
        </WorkspacePageHeader>
        <WorkspacePageCompactHeader
          title="Team"
          action={(
            <Button size="icon-sm" onClick={() => setShowCreate(true)} aria-label="New agent">
              <Plus aria-hidden="true" />
            </Button>
          )}
          overflowActionsLabel="Team actions"
          overflowActions={(
            <DropdownMenuItem onClick={() => setShowTeams(true)}>
              <Settings2 aria-hidden="true" />
              Manage teams
            </DropdownMenuItem>
          )}
        />
        <WorkspacePageBody>
          <PageBody
            gap="content"
            className="flex-1"
            state={(
              <SystemState
                kind="loading"
                scope="page"
                title="Loading your team"
                description="Reporting lines and agent availability will appear here when the roster is ready."
              />
            )}
          />
        </WorkspacePageBody>
      </WorkspacePage>
    )
  }

  return (
    <>
      <WorkspacePage mode="immersive">
        <WorkspacePageHeader>
          <PageHeader
            title="Team"
            description={TEAM_PAGE_DESCRIPTION}
            meta={<Badge size="xs" variant="outline">{agentsWithStatus.length} agents</Badge>}
            actions={(
              <>
                <Button variant="outline" onClick={() => setShowTeams(true)}>
                  <Settings2 aria-hidden="true" />
                  Teams
                </Button>
                <Button onClick={() => setShowCreate(true)}>
                  <Plus aria-hidden="true" />
                  New Agent
                </Button>
              </>
            )}
          />
        </WorkspacePageHeader>
        <WorkspacePageCompactHeader
          title="Team"
          action={(
            <Button size="icon-sm" onClick={() => setShowCreate(true)} aria-label="New agent">
              <Plus aria-hidden="true" />
            </Button>
          )}
          overflowActionsLabel="Team actions"
          overflowActions={(
            <DropdownMenuItem onClick={() => setShowTeams(true)}>
              <Settings2 aria-hidden="true" />
              Manage teams
            </DropdownMenuItem>
          )}
        />
        <WorkspacePageBody>
          <PageBody
            gap="content"
            className="h-full min-h-0 flex-1"
            feedback={runtimeStatus.restartNeeded ? (
              <Alert tone="attention">
                <AlertTitle>Runtime restart required</AlertTitle>
                <AlertDescription>
                  Agent configuration changed and is not active in the runtime yet.
                </AlertDescription>
                <AlertAction>
                  <Button
                    onClick={runtimeStatus.restart}
                    disabled={runtimeStatus.restarting}
                    variant="warning"
                    size="sm"
                  >
                    {runtimeStatus.restarting ? 'Restarting…' : 'Restart runtime'}
                  </Button>
                </AlertAction>
              </Alert>
            ) : undefined}
          >
            <PageCanvas
              data-team-graph-canvas=""
              label="Team reporting graph"
              orientation="vertical"
              className="h-full min-h-32 flex-1 overflow-hidden rounded-none border-x-0 border-b-0"
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                minZoom={0.4}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
                nodesConnectable={false}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  color="var(--bakin-color-border-subtle)"
                  gap={24}
                  size={1}
                />
                <Controls showInteractive={false} />
              </ReactFlow>
            </PageCanvas>
          </PageBody>
        </WorkspacePageBody>
      </WorkspacePage>

      <Drawer
        open={showCreate}
        onOpenChange={(o) => { if (!o) { setShowCreate(false); setPendingCreate(null); setCreateError(null) } }}
        title="New Agent"
        storageKey="team-new-agent"
      >
        <AgentForm
          onSubmit={handleFormSubmit}
          onCancel={() => setShowCreate(false)}
          submitting={submitting}
        />
      </Drawer>

      {/* Confirm agent creation */}
      <Dialog open={!!pendingCreate} onOpenChange={(v) => { if (!v && !submitting) { setPendingCreate(null); setCreateError(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create {pendingCreate?.data.name || 'agent'}?</DialogTitle>
            <DialogDescription>
              Register the agent in the active runtime and create its workspace.
            </DialogDescription>
          </DialogHeader>
          {createError && (
            <Alert tone="danger">
              <AlertTitle>Agent could not be created</AlertTitle>
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                if (!pendingCreate) return
                const { data, avatarFile } = pendingCreate
                setSubmitting(true)
                setCreateError(null)
                try {
                  const res = await pluginFetch('team', '?skipRestart=true', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                  })
                  if (!res.ok) {
                    const err = await res.json()
                    setCreateError(err.error || 'Failed to create agent')
                    return
                  }
                  if (avatarFile) {
                    const formData = new FormData()
                    formData.append('avatar', avatarFile)
                    await pluginFetch('team', `${data.id}/avatar`, { method: 'POST', body: formData })
                  }
                  setPendingCreate(null)
                  setShowCreate(false)
                  await reload()
                  router.push(`/team/${data.id}`)
                } finally {
                  setSubmitting(false)
                }
              }}
              disabled={submitting}
            >
              Save without restart
            </Button>
            <Button onClick={handleConfirmCreate} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create and restart'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Drawer
        open={showTeams}
        onOpenChange={(o) => { if (!o) setShowTeams(false) }}
        title="Manage Teams"
        defaultWidth={480}
        storageKey="team-manager"
      >
        <TeamManager />
      </Drawer>
    </>
  )
}
