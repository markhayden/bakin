import { useRef, useState } from 'react'
import { Stack } from '@makinbakin/sdk/layout'
import { CopyButton } from '@makinbakin/sdk/patterns'
import { Field, FieldControl, FieldDescription, FieldLabel, Form, InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText, InputGroupTextarea, Spinner, SubmitButton } from '@makinbakin/sdk/ui'

export function TextEntryRecipes() {
  const [query, setQuery] = useState('Launch checklist')
  const queryRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [visible, setVisible] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState('')
  const inFlight = useRef(false)
  const [checking, setChecking] = useState(false)

  return <Stack gap="section">
    <Field name="search"><FieldLabel>Search notes</FieldLabel>
      <InputGroup variant="filled">
        <InputGroupAddon><InputGroupText><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor"><circle cx="7" cy="7" r="4" /><path d="m10 10 4 4" /></svg></InputGroupText></InputGroupAddon>
        <InputGroupInput ref={queryRef} value={query} onChange={event => setQuery(event.target.value)} />
        <InputGroupAddon align="inline-end"><InputGroupButton disabled={!query} aria-label="Clear search notes" onClick={() => { setQuery(''); queryRef.current?.focus() }}>Clear</InputGroupButton></InputGroupAddon>
      </InputGroup>
    </Field>
    <Field name="password"><FieldLabel>Password</FieldLabel>
      <InputGroup>
        <InputGroupInput ref={passwordRef} type={visible ? 'text' : 'password'} autoComplete="current-password" defaultValue="a-demo-password" />
        <InputGroupAddon align="inline-end"><InputGroupButton aria-label={visible ? 'Hide password' : 'Show password'} onMouseDown={event => event.preventDefault()} onClick={() => {
          const input = passwordRef.current
          const start = input?.selectionStart ?? 0
          const end = input?.selectionEnd ?? start
          setVisible(value => !value)
          requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start, end) })
        }}>{visible ? 'Hide' : 'Show'}</InputGroupButton></InputGroupAddon>
      </InputGroup>
    </Field>
    <Field name="timeout"><FieldLabel>Timeout</FieldLabel><FieldDescription>Duration in seconds.</FieldDescription>
      <InputGroup size="sm"><InputGroupInput inputMode="numeric" defaultValue="30" /><InputGroupAddon align="inline-end"><InputGroupText aria-hidden="true">seconds</InputGroupText></InputGroupAddon></InputGroup>
    </Field>
    <Field name="repository"><FieldLabel>Repository</FieldLabel>
      <InputGroup size="lg"><InputGroupInput defaultValue="makinbakin/reference-plugin" />
        <InputGroupAddon align="inline-end"><InputGroupButton disabled={checking} onClick={async () => { setChecking(true); await new Promise(resolve => setTimeout(resolve, 300)); setChecking(false) }}>Check</InputGroupButton><Spinner aria-hidden="true" className={checking ? undefined : 'invisible'} /></InputGroupAddon>
      </InputGroup><span role="status">{checking ? 'Checking repository…' : 'Ready to check.'}</span>
    </Field>
    <Field name="reference"><FieldLabel>Read-only reference</FieldLabel>
      <InputGroup><InputGroupInput readOnly defaultValue="plugin://reference" /><InputGroupAddon align="inline-end"><CopyButton text="plugin://reference" label="Copy reference" /></InputGroupAddon></InputGroup>
    </Field>
    <Field name="disabled"><FieldLabel>Disabled reference</FieldLabel><InputGroup><InputGroupInput disabled defaultValue="Not available" /><InputGroupAddon align="inline-end"><InputGroupButton disabled>Copy</InputGroupButton></InputGroupAddon></InputGroup></Field>
    <Form busy={busy} aria-label="Add counted note" onFormSubmit={async () => {
      if (inFlight.current || !note.trim()) return
      inFlight.current = true
      const value = note.trim()
      setBusy(true)
      try { await new Promise(resolve => setTimeout(resolve, 300)); setSubmitted(value) }
      finally { inFlight.current = false; setBusy(false) }
    }}>
      <Field name="note"><FieldLabel>Counted note</FieldLabel><FieldDescription>Maximum 120 UTF-16 code units, matching the browser's maxLength.</FieldDescription>
        <InputGroup variant="filled"><FieldControl render={<InputGroupTextarea autoSize minRows={3} maxRows={5} maxLength={120} value={note} onChange={event => setNote(event.target.value)} />} />
          <InputGroupAddon align="block-end"><InputGroupText>{note.length}/120</InputGroupText><SubmitButton size="xs" busyLabel="Adding note" disabled={!note.trim()}>Add counted note</SubmitButton></InputGroupAddon>
        </InputGroup>
      </Field><span role="status">{submitted ? `Added: ${submitted}` : 'No counted note added.'}</span>
    </Form>
  </Stack>
}
