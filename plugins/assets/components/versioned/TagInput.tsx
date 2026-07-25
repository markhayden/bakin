'use client'

import { useMemo, useRef, useState } from 'react'
import { Badge, Input } from '@makinbakin/sdk/ui'
import { X } from 'lucide-react'
import { normalizeTag } from '../../lib/tags'

/**
 * Tag chip editor: badges with remove, a text input that suggests existing
 * tags while typing, Enter/comma adds freeform. Normalization mirrors the
 * server's normalizeTags (which remains the authority on save).
 */
export function TagInput({ value, onChange, suggestions = [], placeholder = 'Add tag…', ariaLabel = 'Tags' }: {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  placeholder?: string
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const matches = useMemo(() => {
    const n = normalizeTag(draft)
    return suggestions
      .filter(s => !value.includes(s) && (n === '' || s.includes(n)))
      .slice(0, 8)
  }, [draft, suggestions, value])

  const add = (raw: string) => {
    const tag = normalizeTag(raw)
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
    inputRef.current?.focus()
  }
  const remove = (tag: string) => onChange(value.filter(t => t !== tag))

  return (
    <div className="relative" data-testid="tag-input">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1.5">
        {value.map(tag => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs font-normal" data-testid={`tag-chip-${tag}`}>
            {tag}
            <button onClick={() => remove(tag)} aria-label={`Remove tag ${tag}`} className="rounded-full p-0.5 hover:bg-muted">
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <Input
          ref={inputRef}
          aria-label={ariaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150) /* allow suggestion click */}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              remove(value[value.length - 1])
            }
          }}
          placeholder={value.length === 0 ? placeholder : ''}
          className="h-6 min-w-24 flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          data-testid="tag-input-field"
        />
      </div>
      {focused && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-popover py-1 shadow-md" data-testid="tag-suggestions">
          {matches.map(s => (
            <button
              key={s}
              onMouseDown={(e) => { e.preventDefault(); add(s) }}
              className="block w-full px-2.5 py-1 text-left text-sm text-popover-foreground hover:bg-accent"
              data-testid={`tag-suggestion-${s}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
