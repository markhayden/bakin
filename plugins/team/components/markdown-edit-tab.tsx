'use client'

/**
 * Reusable view/edit tab for markdown workspace files.
 *
 * Default state: rendered markdown (read mode). Pencil button in the
 * top-right corner toggles to a textarea (edit mode). Save (green check)
 * or Cancel (X) replace the pencil while editing. Cmd+S triggers save.
 *
 * Mirrors the Assets-detail edit pattern so the agent-detail tabs feel
 * consistent with the rest of the app.
 *
 * Used by Soul / Rules / Tools tabs (writes to
 * /api/plugins/team/:agentId/files/:filename via the existing endpoint).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { MarkdownContent } from '@bakin/sdk/components'

export interface MarkdownEditTabProps {
  agentId: string
  filename: string
  initialContent: string | null
}

export function MarkdownEditTab({ agentId, filename, initialContent }: MarkdownEditTabProps) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(initialContent ?? '')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const dirty = editing && draft !== content
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setContent(initialContent ?? '')
    setEditing(false)
    setDraft('')
    setSavedAt(null)
  }, [initialContent, agentId, filename])

  const handleStartEdit = useCallback(() => {
    setDraft(content)
    setEditing(true)
    setSavedAt(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [content])

  const handleCancel = useCallback(() => {
    setEditing(false)
    setDraft('')
  }, [])

  const handleSave = useCallback(async () => {
    if (!dirty) return
    setSaving(true)
    try {
      const res = await fetch(`/api/plugins/team/${agentId}/files/${filename}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      if (res.ok) {
        setContent(draft)
        setEditing(false)
        setDraft('')
        setSavedAt(Date.now())
        setTimeout(() => setSavedAt(null), 2000)
      }
    } finally {
      setSaving(false)
    }
  }, [agentId, filename, draft, dirty])

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty) handleSave()
      }
      if (e.key === 'Escape') handleCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, dirty, handleSave, handleCancel])

  if (initialContent === null) {
    return (
      <div className="text-sm text-muted-foreground py-12 text-center">
        <code className="font-mono">{filename}</code> does not exist in this agent&apos;s workspace.
      </div>
    )
  }

  return (
    <div className="relative w-full">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
        {savedAt && !editing && (
          <span className="text-xs text-green-400 mr-1">saved</span>
        )}
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="size-8 rounded-full bg-green-600/90 hover:bg-green-500 text-white flex items-center justify-center transition-colors shadow-lg backdrop-blur-sm disabled:opacity-50"
              title="Save (Cmd+S)"
              aria-label="Save changes"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="size-8 rounded-full bg-zinc-700/90 hover:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors shadow-lg backdrop-blur-sm disabled:opacity-50"
              title="Cancel (Esc)"
              aria-label="Cancel edit"
            >
              <X className="size-4" />
            </button>
          </>
        ) : (
          <button
            onClick={handleStartEdit}
            className="size-8 rounded-full bg-zinc-700/90 hover:bg-zinc-600 text-zinc-300 hover:text-white flex items-center justify-center transition-colors shadow-lg backdrop-blur-sm"
            title="Edit content"
            aria-label="Edit markdown"
          >
            <Pencil className="size-4" />
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[calc(100vh-260px)] bg-muted/30 border border-border rounded-lg p-6 pr-14 text-sm font-mono leading-relaxed text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary"
        />
      ) : (
        <div className="w-full min-h-[calc(100vh-260px)] pr-14 overflow-auto">
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  )
}
