'use client'

import { useMemo, useRef, useState } from 'react'
import { Badge, Button, Input } from '@makinbakin/sdk/ui'
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
      <div className="flex flex-wrap items-center gap-bakin-1 rounded-bakin-control border border-bakin-border-subtle bg-transparent px-bakin-2 py-bakin-1">
        {value.map(tag => (
          <Badge key={tag} tone="neutral" variant="soft" className="gap-bakin-1 pr-bakin-1 text-bakin-typography-size-meta font-bakin-typography-weight-regular" data-testid={`tag-chip-${tag}`}>
            {tag}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => remove(tag)}
              aria-label={`Remove tag ${tag}`}
              className="size-auto min-h-0 min-w-0 rounded-bakin-pill p-bakin-1"
            >
              <X className="size-bakin-3" />
            </Button>
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
          className="h-6 min-w-24 flex-1 border-0 bg-transparent p-0 text-bakin-typography-size-body shadow-none focus-visible:ring-0"
          data-testid="tag-input-field"
        />
      </div>
      {focused && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-bakin-1 max-h-48 overflow-auto rounded-bakin-control border border-bakin-border-subtle bg-bakin-surface-default py-bakin-1 shadow-bakin-elevation-overlay" data-testid="tag-suggestions">
          {matches.map(s => (
            <Button
              key={s}
              type="button"
              variant="ghost"
              size="inline"
              onMouseDown={(e) => { e.preventDefault(); add(s) }}
              className="w-full rounded-none px-bakin-2 py-bakin-1 font-bakin-typography-weight-regular"
              data-testid={`tag-suggestion-${s}`}
            >
              {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
