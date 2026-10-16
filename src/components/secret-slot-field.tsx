/**
 * Write-only field for ONE declared secret slot (channel-readiness spec §4.4).
 *
 * Shows presence + source (Not set / Bakin store / Environment) and lets the
 * owner set or clear the stored value. The value is never rendered back.
 * An environment-sourced slot hides the input and explains precedence, so a
 * stale env var can never be mistaken for the stored one. Shared by the
 * Integrations & Keys tab and the Channels tab.
 *
 * Pattern: storybook/public/primitives/input-group.stories.tsx — LocalSubmitAction
 * (entry + one inline action, Enter submits) composed with
 * feedback/status-badge.stories.tsx — CanonicalUsage.
 */
import { useState } from 'react'
import { Inline, Stack } from '@makinbakin/sdk/layout'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { StatusBadge, type StatusBadgeVariant, type StatusTone } from '@makinbakin/sdk/patterns'
import { Button, InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, Text } from '@makinbakin/sdk/ui'

export interface SecretSlotRow {
  provider: string
  name: string
  label: string
  description: string
  envVar?: string
  injectEnv: boolean
  owner: { label: string; href: string }
  status: { present: boolean; source: 'env' | 'store' | null }
}

export interface SecretSlotFieldProps {
  slot: SecretSlotRow
  busy: boolean
  /** Render the owning settings surface as a link (Integrations & Keys lists every slot). */
  showOwner?: boolean
  /** Resolve true when the write succeeded (the draft is cleared). */
  onSet: (value: string) => Promise<boolean>
  onClear: () => Promise<boolean>
}

function badgeFor(status: SecretSlotRow['status']): { label: string; tone: StatusTone; variant: StatusBadgeVariant } {
  if (status.source === 'env') return { label: 'Environment', tone: 'accent', variant: 'solid' }
  if (status.source === 'store') return { label: 'Bakin store', tone: 'success', variant: 'solid' }
  return { label: 'Not set', tone: 'neutral', variant: 'solid' }
}

export function SecretSlotField({ slot, busy, showOwner = false, onSet, onClear }: SecretSlotFieldProps) {
  const [draft, setDraft] = useState('')
  const badge = badgeFor(slot.status)
  const fromEnv = slot.status.source === 'env'
  const stored = slot.status.source === 'store'
  const inputId = `secret-slot-${slot.provider}-${slot.name}`

  const submit = async () => {
    const value = draft.trim()
    if (!value || busy) return
    const ok = await onSet(value)
    if (ok) setDraft('')
  }

  return (
    <Stack gap="dense">
      <Inline align="center" justify="between">
        <Text as="span" weight="medium">{slot.label}</Text>
        <StatusBadge size="xs" tone={badge.tone} variant={badge.variant}>{badge.label}</StatusBadge>
      </Inline>
      <Text size="meta" tone="muted" as="p">
        {slot.description}
        {showOwner && (
          <>
            {' '}Managed in <PluginLink to={slot.owner.href}>{slot.owner.label}</PluginLink>.
          </>
        )}
      </Text>
      {fromEnv ? (
        <Text size="meta" tone="muted" as="p">
          This value is set by {slot.envVar} in the server environment; a stored value is ignored while the variable is set.
        </Text>
      ) : (
        <form aria-label={`Set ${slot.label}`} onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <Inline align="center">
            <InputGroup aria-label={`${slot.label} entry`} className="min-w-0 flex-1">
              <InputGroupInput
                id={inputId}
                type="password"
                autoComplete="off"
                aria-label={`${slot.label} value`}
                disabled={busy}
                placeholder={stored ? 'Replace stored value…' : 'Enter value…'}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton type="submit" size="xs" aria-label={`Set ${slot.label}`} disabled={busy || !draft.trim()}>
                  Set
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {stored && (
              <Button type="button" size="sm" variant="outline" aria-label={`Clear ${slot.label}`} disabled={busy} onClick={() => void onClear()}>
                Clear
              </Button>
            )}
          </Inline>
        </form>
      )}
    </Stack>
  )
}
