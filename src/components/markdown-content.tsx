'use client'

import ReactMarkdown from 'react-markdown'

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose-invert">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
