'use client'

/**
 * Reusable view/edit tab for markdown workspace files.
 *
 * The host owns the draft and persistence state. MarkdownEditor owns the
 * supported edit/preview surface, while SaveBar owns retry and discard
 * presentation.
 */
import { useCallback, useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { MarkdownEditor } from '@makinbakin/sdk/content'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { SaveBar } from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'

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
  const [saveError, setSaveError] = useState<string | undefined>()
  const dirty = editing && draft !== content

  useEffect(() => {
    setContent(initialContent ?? '')
    setEditing(false)
    setDraft('')
    setSaveError(undefined)
  }, [initialContent, agentId, filename])

  const handleStartEdit = useCallback(() => {
    setDraft(content)
    setEditing(true)
    setSaveError(undefined)
  }, [content])

  const handleCancel = useCallback(() => {
    setEditing(false)
    setDraft('')
    setSaveError(undefined)
  }, [])

  const handleSave = useCallback(async () => {
    if (!dirty) return
    setSaving(true)
    setSaveError(undefined)
    try {
      const response = await fetch(`/api/plugins/team/${agentId}/files/${filename}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      if (!response.ok) {
        setSaveError(`${filename} could not be saved. Your draft is still available.`)
        return
      }
      setContent(draft)
      setEditing(false)
      setDraft('')
    } catch {
      setSaveError(`${filename} could not be saved. Your draft is still available.`)
    } finally {
      setSaving(false)
    }
  }, [agentId, filename, draft, dirty])

  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        if (dirty) void handleSave()
      }
      if (event.key === 'Escape' && !saving) handleCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, dirty, handleSave, handleCancel, saving])

  if (initialContent === null) {
    return (
      <SystemState
        kind="initial-empty"
        scope="page"
        headingLevel={3}
        title={`${filename} is not available`}
        description={`This file does not exist in this agent's workspace.`}
      />
    )
  }

  return (
    <Section spacing="compact" aria-labelledby="agent-markdown-heading">
      <Stack gap="dense">
        <div
          data-slot="markdown-file-header"
          className="flex min-w-0 flex-col gap-bakin-1 border-b border-bakin-border-subtle pb-bakin-4"
        >
          <div
            data-slot="markdown-file-title-row"
            className="flex min-w-0 items-center justify-between gap-bakin-3"
          >
            <h2 id="agent-markdown-heading" className="min-w-0 flex-1 truncate">{filename}</h2>
            {!editing ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleStartEdit}
                aria-label="Edit markdown"
              >
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            ) : null}
          </div>
          <p
            data-slot="markdown-file-description"
            className="m-0 text-bakin-text-muted"
          >
            {editing ? 'Editing this workspace file.' : 'Rendered from the current workspace file.'}
          </p>
        </div>

        <MarkdownEditor
          label={`${filename} content`}
          content={editing ? draft : content}
          mode={editing ? 'edit' : 'preview'}
          height="viewport"
          onChange={setDraft}
          className="pt-bakin-2"
          description={editing ? 'Use Command-S or Control-S to save. Escape cancels the draft.' : undefined}
        />
      </Stack>

      <SaveBar
        dirty={dirty}
        saving={saving}
        error={saveError}
        discardLabel="Cancel edit"
        onSave={() => void handleSave()}
        onDiscard={handleCancel}
      >
        {filename}
      </SaveBar>
    </Section>
  )
}
