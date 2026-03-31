'use client'

/**
 * Controlled spec editor — parent owns read/edit mode.
 * In read mode: renders markdown. In edit mode: renders a textarea.
 */
import { MarkdownContent } from '@/components/markdown-content'

interface EditorProps {
  body: string
  editing: boolean
  onChange: (body: string) => void
}

export function ProjectEditor({ body, editing, onChange }: EditorProps) {
  if (editing) {
    return (
      <textarea
        value={body}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[320px] text-sm font-mono leading-relaxed bg-zinc-900/40 border border-[rgba(255,255,255,0.06)] rounded-lg p-4 text-foreground placeholder:text-zinc-500 focus:outline-none focus:border-[#5e6ad2]/40 resize-y transition-colors"
        placeholder="Project details, goals, background..."
      />
    )
  }

  return (
    <div className="min-h-[80px]">
      {body ? (
        <MarkdownContent content={body} />
      ) : (
        <p className="text-sm text-zinc-600 italic">No details yet. Click Edit to start writing.</p>
      )}
    </div>
  )
}
