/**
 * Chat composer — textarea with Enter-to-send (Shift+Enter for newline).
 */
import { useState, type KeyboardEvent } from 'react'
import { SendHorizontal } from 'lucide-react'

export function Composer(props: { disabled: boolean; onSend: (content: string) => void }) {
  const { disabled, onSend } = props
  const [draft, setDraft] = useState('')

  const submit = () => {
    const content = draft.trim()
    if (!content || disabled) return
    setDraft('')
    onSend(content)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={disabled ? 'Agent is replying…' : 'Message the agent (Enter to send)'}
        rows={Math.min(6, Math.max(1, draft.split('\n').length))}
        className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !draft.trim()}
        className="rounded-md border p-2 text-muted-foreground hover:bg-accent disabled:opacity-40"
        aria-label="Send message"
      >
        <SendHorizontal className="size-4" />
      </button>
    </div>
  )
}
