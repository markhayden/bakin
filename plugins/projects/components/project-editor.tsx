'use client'

import { MarkdownEditor } from "@bakin/sdk/components"

interface EditorProps {
  body: string
  editing: boolean
  onChange: (body: string) => void
}

export function ProjectEditor({ body, editing, onChange }: EditorProps) {
  return (
    <MarkdownEditor
      content={body}
      editing={editing}
      onChange={onChange}
      placeholder="Project details, goals, background..."
      format="markdown"
    />
  )
}
