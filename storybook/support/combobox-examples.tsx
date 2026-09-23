import { useEffect, useState } from 'react'
import { Stack } from '@makinbakin/sdk/layout'
import { Button, Combobox, ComboboxChip, ComboboxChipRemove, ComboboxChips, ComboboxClear, ComboboxContent, ComboboxControl, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxStatus, ComboboxTrigger, ComboboxValue, Field, FieldDescription, FieldError, FieldLabel, Spinner } from '@makinbakin/sdk/ui'

export type RuntimeOption = { id: string; label: string; description: string }
export const runtimeOptions: RuntimeOption[] = [
  { id: 'pi', label: 'Pi', description: 'Local agent runtime' },
  { id: 'claw', label: 'OpenClaw', description: 'Gateway-managed runtime' },
  { id: 'hosted', label: 'Managed production runtime with a long descriptive name', description: 'Hosted production service' },
]
const label = (item: RuntimeOption) => item.label
const value = (item: RuntimeOption) => item.id
const equal = (a: RuntimeOption, b: RuntimeOption) => a.id === b.id

export function CompactSelectionExample() {
  const [selected, setSelected] = useState<RuntimeOption[]>([{ ...runtimeOptions[0] }, { ...runtimeOptions[1] }])
  const [compact, setCompact] = useState(false)
  const [submitted, setSubmitted] = useState('Not submitted')
  return <Stack gap="section">
    <Button variant="ghost" aria-pressed={compact} aria-label={compact ? 'Show chips' : 'Show compact summary'} onClick={() => setCompact(current => !current)}>{compact ? 'Chip view' : 'Compact view'}</Button>
    <form onReset={() => setSelected([{ ...runtimeOptions[0] }, { ...runtimeOptions[1] }])} onSubmit={event => { event.preventDefault(); setSubmitted(new FormData(event.currentTarget).getAll('runtimes').join(', ')) }}>
      <Field><FieldLabel>Object runtimes</FieldLabel><FieldDescription>Stable IDs are submitted, even when selected objects have a different identity.</FieldDescription>
        <Combobox multiple name="runtimes" items={runtimeOptions} value={selected} onValueChange={setSelected} itemToStringLabel={label} itemToStringValue={value} isItemEqualToValue={equal}>
          <ComboboxControl variant="filled">
            {compact ? <><span className="min-w-0 flex-1 truncate pl-bakin-3"><ComboboxValue>{(values: RuntimeOption[]) => values.length ? `${values[0].label}${values.length > 1 ? ` +${values.length - 1} more` : ''}` : 'No runtimes'}</ComboboxValue></span><ComboboxInput placeholder="Search" /></> :
              <ComboboxChips><ComboboxValue>{(values: RuntimeOption[]) => values.map(item => <ComboboxChip key={item.id}><span className="min-w-0 break-words">{item.label}</span><ComboboxChipRemove aria-label={`Remove ${item.label}`} /></ComboboxChip>)}</ComboboxValue><ComboboxInput placeholder="Add runtime" /></ComboboxChips>}
            <ComboboxClear aria-label="Clear object runtimes" /><ComboboxTrigger aria-label="Show object runtimes" />
          </ComboboxControl>
          <ComboboxContent><ComboboxEmpty>No matching runtimes.</ComboboxEmpty><ComboboxList>{(item: RuntimeOption) => <ComboboxItem key={item.id} value={item}><span>{item.label}</span><span className="block text-bakin-text-muted">{item.description}</span></ComboboxItem>}</ComboboxList></ComboboxContent>
          <ComboboxStatus>{selected.length ? `Selected: ${selected.map(item => item.label).join(', ')}` : 'No runtimes selected.'}</ComboboxStatus>
        </Combobox>
      </Field>
      <Button type="submit">Submit runtimes</Button><Button type="reset" variant="ghost" aria-label="Reset object runtimes">Reset choices</Button>
    </form><output aria-label="Submitted runtime IDs">{submitted}</output>
  </Stack>
}

/** Local fixture only: callers replace this with their own request/cancellation. */
async function searchCatalog(query: string, attempt: number): Promise<RuntimeOption[]> {
  await new Promise(resolve => setTimeout(resolve, query === 'slow' ? 350 : 80))
  if (query === 'error' && attempt === 0) throw new Error('Catalog unavailable')
  if (query === 'slow') return [runtimeOptions[0]]
  if (query === 'fast') return [runtimeOptions[1]]
  if (query === 'error') return runtimeOptions
  return runtimeOptions.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
}

export function AsyncSelectionExample() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<RuntimeOption | null>(runtimeOptions[0])
  const [items, setItems] = useState<RuntimeOption[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let current = true
    setPhase('loading')
    setItems([])
    void searchCatalog(query, attempt).then(results => {
      if (!current) return
      setItems(results)
      setPhase('ready')
    }, () => { if (current) setPhase('error') })
    // A late result from an old query must not replace the current catalog.
    return () => { current = false }
  }, [query, attempt])

  return <Stack gap="section">
    <Field invalid={unavailable} name="asyncRuntime"><FieldLabel>Remote runtime</FieldLabel>
      <FieldDescription>Try “slow” then “fast”, “error” to retry, or a query with no matches.</FieldDescription>
      <Combobox items={items} filter={null} value={selected} onValueChange={next => { setSelected(next); if (!next || next.id !== selected?.id) setUnavailable(false) }} inputValue={query} onInputValueChange={(next, details) => { if (details.reason === 'none') return; setQuery(next); setAttempt(0) }} itemToStringLabel={label} itemToStringValue={value} isItemEqualToValue={equal}>
        <ComboboxControl><ComboboxInput aria-busy={phase === 'loading'} placeholder="Search remote runtimes" /><span className="grid size-bakin-4 shrink-0 place-items-center">{phase === 'loading' ? <Spinner /> : null}</span><ComboboxClear aria-label="Clear remote runtime" /><ComboboxTrigger aria-label="Show remote runtimes" /></ComboboxControl>
        <ComboboxContent>
          <ComboboxEmpty>{phase === 'ready' ? 'No matching remote runtimes.' : null}</ComboboxEmpty>
          <ComboboxList>{(item: RuntimeOption) => <ComboboxItem key={item.id} value={item}><span>{item.label}</span><span className="block text-bakin-text-muted">{item.description}</span></ComboboxItem>}</ComboboxList>
        </ComboboxContent>
        <ComboboxStatus>{phase === 'loading' ? 'Loading runtimes…' : phase === 'error' ? 'Unable to load runtimes. Retry the search.' : items.length ? `${items.length} runtimes available.` : 'No matching remote runtimes.'}</ComboboxStatus>
      </Combobox>
      {phase === 'error' ? <Button variant="ghost" onClick={() => setAttempt(current => current + 1)}>Retry runtime search</Button> : null}
      <p>Selected runtime: {selected?.label ?? 'None'}{unavailable ? ' (unavailable)' : ''}</p>
      {unavailable ? <FieldError match>This runtime is no longer available. Clear it or choose another runtime.</FieldError> : null}
    </Field>
    <Button variant="ghost" disabled={!selected || unavailable} onClick={() => setUnavailable(true)} aria-label="Mark selected runtime unavailable">Mark unavailable</Button>
  </Stack>
}
