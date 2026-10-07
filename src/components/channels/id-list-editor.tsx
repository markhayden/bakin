/**
 * Editor for a list of arbitrary ids (Discord guild / user snowflakes):
 * text entry + Add, removable rows. First-time setup must accept ids that
 * have never been discovered, so this is NOT a Combobox (that selects from
 * a predefined catalog).
 *
 * It lives INSIDE the bridge-settings Form, so it owns no <form> of its
 * own (nested forms are invalid and a nested submit would bubble into the
 * outer save): Enter in the entry adds the id and is swallowed there.
 *
 * Patterns: storybook/public/primitives/input-group.stories.tsx —
 * LocalSubmitAction (entry + inline action) composed with
 * lists/list-rows.stories.tsx — InteractiveRows (rows with their own
 * labeled control).
 */
import { useState, type KeyboardEvent } from 'react'
import { Inline, Stack } from '@makinbakin/sdk/layout'
import { ListRow, ListRows } from '@makinbakin/sdk/patterns'
import { Button, InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, Text } from '@makinbakin/sdk/ui'

export interface IdListEditorProps {
  /** Accessible name for the list and the entry. */
  label: string
  /** Stable id for the entry control (deep links focus it). */
  inputId: string
  values: string[]
  onChange(next: string[]): void
  placeholder?: string
  disabled?: boolean
  emptyText?: string
}

export function normalizeIdEntry(raw: string): string {
  return raw.trim()
}

export function IdListEditor({ label, inputId, values, onChange, placeholder, disabled = false, emptyText = 'None yet.' }: IdListEditorProps) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const id = normalizeIdEntry(draft)
    if (!id || disabled) return
    if (!values.includes(id)) onChange([...values, id])
    setDraft('')
  }
  const remove = (id: string) => onChange(values.filter((value) => value !== id))
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    add()
  }

  return (
    <Stack gap="dense">
      <InputGroup aria-label={`${label} entry`}>
        <InputGroupInput
          id={inputId}
          aria-label={`${label} to add`}
          value={draft}
          disabled={disabled}
          placeholder={placeholder ?? 'Paste an ID…'}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="button" size="xs" aria-label={`Add ${label}`} disabled={disabled || !normalizeIdEntry(draft)} onClick={add}>
            Add
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {values.length === 0 ? (
        <Text size="meta" tone="muted" as="p">{emptyText}</Text>
      ) : (
        <ListRows aria-label={label} variant="separated">
          {values.map((id) => (
            <ListRow key={id}>
              <Inline align="center" justify="between" gap="dense">
                <Text size="body" mono className="min-w-0 break-all">{id}</Text>
                <Button type="button" variant="ghost" size="xs" aria-label={`Remove ${id}`} disabled={disabled} onClick={() => remove(id)}>
                  Remove
                </Button>
              </Inline>
            </ListRow>
          ))}
        </ListRows>
      )}
    </Stack>
  )
}
