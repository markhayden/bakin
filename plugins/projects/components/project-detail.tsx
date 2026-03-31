'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { ArrowLeft, Send, Loader2, Paperclip, X, FileText, Image, Film, Music, File, Sparkles, ChevronDown, Search, Pencil, Trash2 } from 'lucide-react'
import { AGENTS } from '@/lib/constants'
import { ProjectChecklist } from './project-checklist'
import { ProjectEditor } from './project-editor'
import { MarkdownContent } from '@/components/markdown-content'
import type { ProjectStatus } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResolvedAsset {
  path: string
  label?: string
  filename: string
  type: string
  description?: string
  tags?: string[]
  missing?: boolean
}

interface ProjectData {
  id: string
  title: string
  status: ProjectStatus
  owner: string
  progress: number
  tasks: Array<{ id: string; title: string; taskId?: string; checked: boolean }>
  assets: Array<{ path: string; label?: string }>
  body: string
  updated: string
  resolvedTasks: Record<string, { column: string; title: string } | null>
  resolvedAssets: ResolvedAsset[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<ProjectStatus, { label: string; dot: string }> = {
  draft: { label: 'Draft', dot: 'bg-zinc-400' },
  active: { label: 'Active', dot: 'bg-[#5e6ad2]' },
  completed: { label: 'Completed', dot: 'bg-emerald-400' },
  archived: { label: 'Archived', dot: 'bg-zinc-600' },
}

const IMAGE_TYPES = new Set(['images', 'image'])

const ASSET_ICONS: Record<string, typeof FileText> = {
  text: FileText,
  images: Image,
  video: Film,
  audio: Music,
}

function AssetIcon({ type }: { type: string }) {
  const Icon = ASSET_ICONS[type] || File
  return <Icon className="size-3.5 shrink-0 text-zinc-500" />
}

function AssetThumb({ asset }: { asset: ResolvedAsset }) {
  const [err, setErr] = useState(false)
  if (IMAGE_TYPES.has(asset.type) && !asset.missing && !err) {
    return (
      <img
        src={`/api/plugins/assets/file?path=${encodeURIComponent(asset.path)}`}
        alt={asset.filename}
        onError={() => setErr(true)}
        className="size-8 rounded object-cover shrink-0 bg-zinc-800"
      />
    )
  }
  return (
    <div className="size-8 rounded bg-zinc-800/60 flex items-center justify-center shrink-0">
      <AssetIcon type={asset.type} />
    </div>
  )
}

function PickerThumb({ asset }: { asset: { path: string; filename: string; type: string } }) {
  const [err, setErr] = useState(false)
  if (IMAGE_TYPES.has(asset.type) && !err) {
    return (
      <img
        src={`/api/plugins/assets/file?path=${encodeURIComponent(asset.path)}`}
        alt={asset.filename}
        onError={() => setErr(true)}
        className="size-7 rounded object-cover shrink-0 bg-zinc-800"
      />
    )
  }
  return (
    <div className="size-7 rounded bg-zinc-800/60 flex items-center justify-center shrink-0">
      <AssetIcon type={asset.type} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectDetail({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [project, setProject] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(true)

  // Edit mode — single toggle for title + spec
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editOwner, setEditOwner] = useState('')
  const [editStatus, setEditStatus] = useState<ProjectStatus>('draft')
  const [editBody, setEditBody] = useState('')

  // Brainstorm
  const [brainstormOpen, setBrainstormOpen] = useState(true)
  const [brainstormAgent, setBrainstormAgent] = useState('main')
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentLoading, setAgentLoading] = useState(false)
  const [brainstormMessages, setBrainstormMessages] = useState<Array<{ role: 'user' | 'agent'; agent?: string; content: string }>>([])
  const brainstormEndRef = useRef<HTMLDivElement>(null)

  // Dropdowns
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const ownerRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  // Assets
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [assetSearch, setAssetSearch] = useState('')
  const [availableAssets, setAvailableAssets] = useState<Array<{ path: string; filename: string; type: string; description?: string }>>([])

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/projects/get?id=${projectId}`)
      if (res.ok) {
        const data = await res.json()
        setProject(data.project)
        setEditTitle(data.project.title)
        setEditOwner(data.project.owner)
        setEditStatus(data.project.status)
        setEditBody(data.project.body)
        setEditing(false)
      }
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useState(() => { fetchProject() })

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ownerRef.current && !ownerRef.current.contains(e.target as Node)) setOwnerOpen(false)
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ---------------------------------------------------------------------------
  // Dirty state — anything changed from server state
  // ---------------------------------------------------------------------------

  const isDirty = project && (
    editTitle !== project.title ||
    editOwner !== project.owner ||
    editStatus !== project.status ||
    editBody !== project.body
  )

  // ---------------------------------------------------------------------------
  // Edit mode actions
  // ---------------------------------------------------------------------------

  const enterEdit = () => {
    if (!project) return
    setEditTitle(project.title)
    setEditBody(project.body)
    setEditing(true)
  }

  const cancelEdit = () => {
    if (!project) return
    setEditTitle(project.title)
    setEditBody(project.body)
    setEditing(false)
  }

  const handleSave = async () => {
    if (!project || !isDirty) return
    const updates: Record<string, string> = { id: projectId }
    if (editTitle !== project.title) updates.title = editTitle
    if (editOwner !== project.owner) updates.owner = editOwner
    if (editStatus !== project.status) updates.status = editStatus
    if (editBody !== project.body) updates.body = editBody
    await fetch('/api/plugins/projects/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    fetchProject()
  }

  // ---------------------------------------------------------------------------
  // Checklist handlers
  // ---------------------------------------------------------------------------

  const toggleItem = async (taskItemId: string, checked: boolean) => {
    await fetch('/api/plugins/projects/checklist/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, taskItemId, checked }) })
    fetchProject()
  }
  const addItem = async (title: string) => {
    await fetch('/api/plugins/projects/checklist/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, title }) })
    fetchProject()
  }
  const removeItem = async (taskItemId: string) => {
    await fetch('/api/plugins/projects/checklist/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, taskItemId }) })
    fetchProject()
  }
  const promoteItem = async (taskItemId: string) => {
    await fetch('/api/plugins/projects/checklist/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, taskItemId }) })
    fetchProject()
  }

  // ---------------------------------------------------------------------------
  // Brainstorm
  // ---------------------------------------------------------------------------

  const handleAgentAsk = async () => {
    if (!agentPrompt.trim() || agentLoading) return
    const prompt = agentPrompt.trim()
    const agent = brainstormAgent
    setBrainstormMessages(prev => [...prev, { role: 'user', content: prompt }])
    setAgentPrompt('')
    setAgentLoading(true)
    setTimeout(() => brainstormEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    try {
      const history = brainstormMessages.map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/plugins/projects/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, prompt, agent, history }) })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.reply) {
        setBrainstormMessages(prev => [...prev, { role: 'agent', agent, content: data.reply }])
        fetchProject()
      } else {
        setBrainstormMessages(prev => [...prev, { role: 'agent', agent, content: `Error: ${data?.error || `Agent returned ${res.status}`}` }])
      }
    } catch (err: any) {
      setBrainstormMessages(prev => [...prev, { role: 'agent', agent, content: `Error: ${err?.message || 'Failed to reach agent'}` }])
    } finally {
      setAgentLoading(false)
      setTimeout(() => brainstormEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  // ---------------------------------------------------------------------------
  // Assets
  // ---------------------------------------------------------------------------

  const openAssetPicker = async () => {
    try {
      const res = await fetch('/api/plugins/assets/list?grouped=false')
      if (res.ok) {
        const data = await res.json()
        const attached = new Set(project?.assets.map(a => a.path) || [])
        setAvailableAssets(
          (data.assets || [])
            .filter((a: { path: string }) => !attached.has(a.path))
            .map((a: { path: string; filename: string; type: string; metadata?: { description?: string } }) => ({
              path: a.path, filename: a.filename, type: a.type, description: a.metadata?.description,
            }))
        )
        setAssetSearch('')
        setAssetPickerOpen(true)
      }
    } catch { /* assets plugin may not be available */ }
  }

  const handleAttachAsset = async (assetPath: string) => {
    await fetch('/api/plugins/projects/assets/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, assetPath }) })
    setAssetPickerOpen(false)
    fetchProject()
  }

  const handleDetachAsset = async (assetPath: string) => {
    await fetch('/api/plugins/projects/assets/detach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, assetPath }) })
    fetchProject()
  }

  const filteredPickerAssets = availableAssets.filter(a => {
    if (!assetSearch.trim()) return true
    const q = assetSearch.toLowerCase()
    return a.filename.toLowerCase().includes(q) || a.type.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q)
  })

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const linkedTaskCount = project?.tasks.filter(t => t.taskId).length ?? 0

  const handleDelete = async (deleteLinkedTasks: boolean) => {
    setDeleting(true)
    try {
      await fetch('/api/plugins/projects/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: projectId, deleteLinkedTasks }),
      })
      onBack()
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) return <div className="text-sm text-muted-foreground py-8">Loading...</div>
  if (!project) return <div className="text-sm text-muted-foreground py-8">Project not found.</div>

  const statusCfg = STATUS_CONFIG[editStatus]
  const ownerAgent = AGENTS.find(a => a.id === editOwner)

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between pb-5 border-b border-[rgba(255,255,255,0.06)]">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Projects
        </button>

        <div className="flex items-center gap-3">
          {/* Status */}
          <div ref={statusRef} className="relative">
            <button
              onClick={() => setStatusOpen(!statusOpen)}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium text-zinc-300 bg-zinc-800/80 hover:bg-zinc-800 border border-[rgba(255,255,255,0.06)] transition-colors"
            >
              <span className={`size-1.5 rounded-full ${statusCfg.dot}`} />
              {statusCfg.label}
              <ChevronDown className="size-2.5 text-zinc-500" />
            </button>
            {statusOpen && (
              <div className="absolute top-full right-0 mt-1 w-36 bg-zinc-900 border border-[rgba(255,255,255,0.08)] rounded-lg shadow-xl z-30 py-1">
                {(Object.entries(STATUS_CONFIG) as [ProjectStatus, typeof statusCfg][]).map(([val, cfg]) => (
                  <button
                    key={val}
                    onClick={() => { setEditStatus(val); setStatusOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                      val === editStatus ? 'text-foreground bg-zinc-800/60' : 'text-zinc-400 hover:text-foreground hover:bg-zinc-800/40'
                    }`}
                  >
                    <span className={`size-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Owner */}
          <div ref={ownerRef} className="relative">
            <button
              onClick={() => setOwnerOpen(!ownerOpen)}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] text-zinc-400 hover:text-zinc-300 bg-zinc-800/40 hover:bg-zinc-800/60 border border-[rgba(255,255,255,0.04)] transition-colors"
            >
              {ownerAgent && <span className="text-xs">{ownerAgent.emoji}</span>}
              <span>{ownerAgent?.name || editOwner}</span>
              <ChevronDown className="size-2.5 text-zinc-600" />
            </button>
            {ownerOpen && (
              <div className="absolute top-full right-0 mt-1 w-52 bg-zinc-900 border border-[rgba(255,255,255,0.08)] rounded-lg shadow-xl z-30 py-1 max-h-52 overflow-y-auto">
                <div className="px-2 py-1.5">
                  <input
                    type="text"
                    value={editOwner}
                    onChange={(e) => setEditOwner(e.target.value)}
                    placeholder="Search or type..."
                    className="w-full text-[11px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-foreground placeholder:text-zinc-500 focus:outline-none focus:border-[#5e6ad2]/50"
                    autoFocus
                  />
                </div>
                {AGENTS
                  .filter(a => a.name.toLowerCase().includes(editOwner.toLowerCase()) || a.id.toLowerCase().includes(editOwner.toLowerCase()))
                  .map(a => (
                    <button
                      key={a.id}
                      onClick={() => { setEditOwner(a.id); setOwnerOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                        a.id === editOwner ? 'text-foreground bg-zinc-800/60' : 'text-zinc-400 hover:text-foreground hover:bg-zinc-800/40'
                      }`}
                    >
                      <span>{a.emoji}</span>
                      <span>{a.name}</span>
                      <span className="text-zinc-600 ml-auto font-mono text-[10px]">{a.id}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          <span className="w-px h-4 bg-[rgba(255,255,255,0.06)]" />

          {/* Edit / Save / Cancel */}
          {editing ? (
            <>
              <button
                onClick={cancelEdit}
                className="px-3 py-1 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!isDirty}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  isDirty
                    ? 'bg-[#5e6ad2] text-white hover:bg-[#6e7ae2] shadow-sm shadow-[#5e6ad2]/20'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                Save
              </button>
            </>
          ) : (
            <button
              onClick={enterEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 border border-[rgba(255,255,255,0.06)] transition-colors"
            >
              <Pencil className="size-3" />
              Edit
            </button>
          )}

          <span className="w-px h-4 bg-[rgba(255,255,255,0.06)]" />

          {/* Delete */}
          <button
            onClick={() => setDeleteDialogOpen(true)}
            className="p-1 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete project"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* ── Delete confirmation dialog ── */}
      {deleteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !deleting && setDeleteDialogOpen(false)} />
          <div className="relative bg-zinc-900 border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl w-[420px] p-6">
            <h3 className="text-sm font-semibold text-foreground mb-2">Delete project?</h3>
            <p className="text-[12px] text-zinc-400 mb-4">
              This will permanently delete <span className="text-zinc-200 font-medium">{project.title}</span> and all its checklist items.
            </p>

            {linkedTaskCount > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-zinc-800/60 border border-[rgba(255,255,255,0.06)]">
                <p className="text-[11px] text-zinc-300 mb-2">
                  This project has <span className="font-medium text-foreground">{linkedTaskCount}</span> linked board {linkedTaskCount === 1 ? 'task' : 'tasks'}. What should happen to {linkedTaskCount === 1 ? 'it' : 'them'}?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDelete(false)}
                    disabled={deleting}
                    className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-700/60 text-zinc-300 hover:text-foreground hover:bg-zinc-700 border border-[rgba(255,255,255,0.06)] transition-colors disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Keep tasks on board'}
                  </button>
                  <button
                    onClick={() => handleDelete(true)}
                    disabled={deleting}
                    className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20 transition-colors disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Delete tasks too'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteDialogOpen(false)}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              {linkedTaskCount === 0 && (
                <button
                  onClick={() => handleDelete(false)}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20 transition-colors disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Two-column body ── */}
      <div className="flex gap-6 pt-5 flex-1 min-h-0 overflow-hidden">

        {/* ── Main column ── */}
        <div className="flex-1 min-w-0 flex flex-col">

          {/* Scrollable content area */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ scrollbarGutter: 'stable' }}>
            {/* Title */}
            <label className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-1.5 block">Title</label>
            {editing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full text-xl font-semibold text-foreground bg-zinc-900/40 border border-[rgba(255,255,255,0.06)] rounded-lg outline-none px-4 py-2.5 placeholder:text-zinc-500 mb-5 tracking-tight focus:border-[#5e6ad2]/40 transition-colors"
                placeholder="Untitled project"
                autoFocus
              />
            ) : (
              <h1 className="text-xl font-semibold text-foreground tracking-tight mb-5">
                {project.title || 'Untitled project'}
              </h1>
            )}

            {/* Details (spec) */}
            <label className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-1.5 block">Details</label>
            <div className="mb-6">
              <ProjectEditor
                body={editBody}
                editing={editing}
                onChange={setEditBody}
              />
            </div>

          </div>

          {/* ── Brainstorm — pinned at bottom ── */}
          <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)] pt-3 pb-1 flex flex-col">
            <button
              onClick={() => setBrainstormOpen(!brainstormOpen)}
              className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-2"
            >
              <Sparkles className="size-3.5" />
              <span className="font-medium">Brainstorm</span>
              {brainstormMessages.length > 0 && (
                <span className="text-[10px] text-zinc-600 font-mono">{brainstormMessages.filter(m => m.role === 'agent').length} replies</span>
              )}
              <ChevronDown className={`size-3 transition-transform ${brainstormOpen ? 'rotate-180' : ''}`} />
            </button>

            {brainstormOpen && (
              <div className="flex flex-col">
                {/* Conversation history */}
                {brainstormMessages.length > 0 && (
                  <div className="max-h-[280px] overflow-y-auto mb-2 space-y-2 pr-1" style={{ scrollbarGutter: 'stable' }}>
                    {brainstormMessages.map((msg, i) => {
                      if (msg.role === 'user') {
                        return (
                          <div key={i} className="flex justify-end">
                            <div className="max-w-[85%] px-3 py-1.5 rounded-lg bg-[#5e6ad2]/15 border border-[#5e6ad2]/20 text-sm text-zinc-200 whitespace-pre-wrap">
                              {msg.content}
                            </div>
                          </div>
                        )
                      }
                      const agentInfo = AGENTS.find(a => a.id === msg.agent)
                      return (
                        <div key={i} className="flex gap-2">
                          <div className="shrink-0 text-xs pt-1">{agentInfo?.emoji || '🤖'}</div>
                          <div className="max-w-[90%] px-3 py-2 rounded-lg bg-zinc-900/60 border border-[rgba(255,255,255,0.04)] text-sm">
                            <MarkdownContent content={msg.content} />
                          </div>
                        </div>
                      )
                    })}
                    {agentLoading && (
                      <div className="flex gap-2">
                        <div className="shrink-0 text-xs pt-1">{AGENTS.find(a => a.id === brainstormAgent)?.emoji || '🤖'}</div>
                        <div className="px-3 py-2 rounded-lg bg-zinc-900/60 border border-[rgba(255,255,255,0.04)] text-sm text-zinc-500">
                          <Loader2 className="size-3.5 animate-spin inline-block" /> Thinking...
                        </div>
                      </div>
                    )}
                    <div ref={brainstormEndRef} />
                  </div>
                )}

                {/* Input row */}
                <div className="flex items-end gap-2">
                  <select
                    value={brainstormAgent}
                    onChange={(e) => setBrainstormAgent(e.target.value)}
                    className="text-[11px] bg-zinc-900/60 border border-[rgba(255,255,255,0.06)] rounded-lg px-2 py-2 text-zinc-300 focus:outline-none focus:border-[#5e6ad2]/40 cursor-pointer shrink-0 self-start"
                  >
                    {AGENTS.map(a => (
                      <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                    ))}
                  </select>
                  <textarea
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAgentAsk() } }}
                    placeholder="Ask about this project..."
                    rows={2}
                    className="flex-1 text-sm bg-zinc-900/60 border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-2 text-foreground placeholder:text-zinc-500 focus:outline-none focus:border-[#5e6ad2]/40 transition-colors resize-none"
                  />
                  <button
                    onClick={handleAgentAsk}
                    disabled={!agentPrompt.trim() || agentLoading}
                    className="px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed border border-[rgba(255,255,255,0.06)] self-start"
                  >
                    {agentLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div className="w-[346px] shrink-0 overflow-y-auto space-y-5 border-l border-[rgba(255,255,255,0.06)] pl-6" style={{ scrollbarGutter: 'stable' }}>

          {/* Progress */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Progress</h3>
              <span className="text-[11px] font-mono text-zinc-400 tabular-nums">{project.progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#5e6ad2] transition-all duration-500"
                style={{ width: `${project.progress}%` }}
              />
            </div>
          </div>

          {/* Checklist */}
          <div className="pt-4 border-t border-[rgba(255,255,255,0.06)]">
            <ProjectChecklist
              projectId={projectId}
              tasks={project.tasks}
              resolvedTasks={project.resolvedTasks}
              onToggle={toggleItem}
              onAdd={addItem}
              onRemove={removeItem}
              onPromote={promoteItem}
            />
          </div>

          {/* Assets */}
          <div className="pt-4 border-t border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Assets</h3>

              <button
                onClick={openAssetPicker}
                className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <Paperclip className="size-3" />
                Attach
              </button>
            </div>

            {project.resolvedAssets.length === 0 ? (
              <p className="text-[11px] text-zinc-600">No assets attached.</p>
            ) : (
              <div className="space-y-1.5">
                {project.resolvedAssets.map((asset) => (
                  <div
                    key={asset.path}
                    className={`group flex items-start gap-2.5 p-1.5 rounded-lg hover:bg-zinc-800/40 transition-colors ${asset.missing ? 'opacity-40' : ''}`}
                  >
                    <AssetThumb asset={asset} />
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-[11px] text-zinc-300 truncate leading-tight">{asset.label || asset.filename}</p>
                      {asset.description && (
                        <p className="text-[10px] text-zinc-600 truncate mt-0.5">{asset.description}</p>
                      )}
                      {asset.tags && asset.tags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {asset.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-zinc-800/60 text-zinc-500">{tag}</span>
                          ))}
                        </div>
                      )}
                      {asset.missing && <span className="text-[10px] text-amber-500/70">missing</span>}
                    </div>
                    <button
                      onClick={() => handleDetachAsset(asset.path)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all shrink-0 mt-1"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Asset picker */}
            {assetPickerOpen && (
              <div className="mt-2 border border-[rgba(255,255,255,0.08)] rounded-lg bg-zinc-900 overflow-hidden">
                <div className="px-2.5 py-2 border-b border-[rgba(255,255,255,0.06)]">
                  <div className="flex items-center gap-1.5 bg-zinc-800 rounded px-2 py-1">
                    <Search className="size-3 text-zinc-500 shrink-0" />
                    <input
                      type="text"
                      value={assetSearch}
                      onChange={(e) => setAssetSearch(e.target.value)}
                      placeholder="Search assets..."
                      className="flex-1 text-[11px] bg-transparent text-foreground placeholder:text-zinc-500 focus:outline-none"
                      autoFocus
                    />
                    {assetSearch && (
                      <button onClick={() => setAssetSearch('')} className="text-zinc-600 hover:text-zinc-400">
                        <X className="size-2.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {filteredPickerAssets.length === 0 ? (
                    <p className="text-[11px] text-zinc-600 p-3 text-center">
                      {availableAssets.length === 0 ? 'No assets available.' : 'No matches.'}
                    </p>
                  ) : (
                    filteredPickerAssets.map((asset) => (
                      <button
                        key={asset.path}
                        onClick={() => handleAttachAsset(asset.path)}
                        className="w-full text-left px-2.5 py-2 text-[11px] hover:bg-zinc-800/60 transition-colors flex items-center gap-2.5 border-b border-[rgba(255,255,255,0.04)] last:border-0"
                      >
                        <PickerThumb asset={asset} />
                        <div className="flex-1 min-w-0">
                          <span className="text-zinc-300 truncate block">{asset.filename}</span>
                          {asset.description && <span className="text-zinc-600 truncate block text-[10px]">{asset.description}</span>}
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <button
                  onClick={() => setAssetPickerOpen(false)}
                  className="w-full text-center py-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 border-t border-[rgba(255,255,255,0.06)]"
                >
                  Close
                </button>
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="pt-4 border-t border-[rgba(255,255,255,0.06)]">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Details</h3>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-zinc-600">Created</span>
                <span className="text-zinc-400">{new Date(project.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600">Updated</span>
                <span className="text-zinc-400">{new Date(project.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600">ID</span>
                <span className="text-zinc-500 font-mono">{project.id.slice(0, 8)}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
