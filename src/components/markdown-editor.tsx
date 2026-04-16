'use client'

import { MarkdownContent } from '@/components/markdown-content'
import { Textarea } from '@/components/ui/textarea'

interface MarkdownEditorProps {
  content: string
  editing: boolean
  onChange: (content: string) => void
  placeholder?: string
  format?: 'markdown' | 'yaml' | 'json' | 'text'
  minHeight?: string
  className?: string
}

export function MarkdownEditor({
  content,
  editing,
  onChange,
  placeholder = 'No content',
  format = 'markdown',
  minHeight = '320px',
  className,
}: MarkdownEditorProps) {
  if (editing) {
    return (
      <Textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full font-mono text-sm leading-relaxed bg-zinc-900/40 border border-[rgba(255,255,255,0.06)] rounded-lg p-4 text-foreground placeholder:text-zinc-500 focus:outline-none focus:border-[#5e6ad2]/40 resize-y transition-colors ${className ?? ''}`}
        style={{ minHeight }}
        placeholder={placeholder}
      />
    )
  }

  if (!content) {
    return <p className="text-sm text-zinc-600 italic">{placeholder}</p>
  }

  if (format === 'markdown') {
    return (
      <div className={className}>
        <MarkdownContent content={content} />
      </div>
    )
  }

  let displayContent = content
  if (format === 'json') {
    try {
      displayContent = JSON.stringify(JSON.parse(content), null, 2)
    } catch { /* show as-is */ }
  }

  return (
    <pre className={`bg-zinc-900 rounded-lg p-4 text-sm text-zinc-300 overflow-auto font-mono ${format === 'text' ? 'whitespace-pre-wrap' : ''} ${className ?? ''}`}>
      {displayContent}
    </pre>
  )
}
