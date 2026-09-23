import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'
import { Grid } from '@makinbakin/sdk/layout'
import { Combobox, ComboboxControl, ComboboxInput, ComboboxTrigger, ComboboxClear, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty, ComboboxStatus, ComboboxGroup, ComboboxLabel, ComboboxValue, ComboboxChips, ComboboxChip, ComboboxChipRemove, Field, FieldLabel, FieldError, Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose, Button } from '@makinbakin/sdk/ui'
import { CompactSelectionExample, AsyncSelectionExample } from '../../support/combobox-examples'
import { StoryStage, StorySection } from '../../support'

const meta = {
  title: 'Components/Primitives/Combobox',
  component: Combobox,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Combobox searches a predefined catalog and commits selected values. Query text is not a form value. Use Select for bounded choices without editable search. The control owns sm/md/lg sizes and outlined/filled/ghost appearances; Field owns labels and validation. Multiple values use removable chips or a compact summary with an editable query. Callers own async requests and pass filter={null} for server-filtered results.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled', 'validation', 'overflow', 'empty', 'loading', 'error'],
  },
} satisfies Meta<typeof Combobox>
export default meta
type Story = StoryObj<typeof meta>

type CanonicalArgs = { size: 'sm' | 'md' | 'lg'; variant: 'outlined' | 'filled' | 'ghost'; disabled: boolean }
export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { size: 'md', variant: 'outlined', disabled: false },
  argTypes: { size: { control: 'select', options: ['sm', 'md', 'lg'] }, variant: { control: 'select', options: ['outlined', 'filled', 'ghost'] }, disabled: { control: 'boolean' } },
  render: (args: CanonicalArgs) => <Field name="runtime"><FieldLabel>Execution runtime</FieldLabel>
    <Combobox items={['Pi', 'OpenClaw', 'Managed runtime']} disabled={args.disabled}>
      <ComboboxControl size={args.size} variant={args.variant}>
        <ComboboxInput placeholder="Search runtimes" /><ComboboxClear aria-label="Clear runtime" /><ComboboxTrigger aria-label="Show runtimes" />
      </ComboboxControl>
      <ComboboxContent><ComboboxEmpty>No matching runtimes.</ComboboxEmpty><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>
  </Field>,
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole('combobox', { name: 'Execution runtime' })
    if (args.disabled) { await expect(input).toBeDisabled(); return }
    await userEvent.type(input, 'Open')
    const page = within(document.body)
    await expect(page.findByRole('option', { name: 'OpenClaw' })).resolves.toBeVisible()
    await expect(page.queryByRole('option', { name: 'Pi' })).not.toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(input).toHaveValue('OpenClaw')
    await waitFor(() => expect(page.queryByRole('listbox')).not.toBeInTheDocument())
  },
} satisfies StoryObj<CanonicalArgs>

export const MultipleSelection = {
  render: () => <StoryStage eyebrow="Searchable selection" title="Selected runtimes" description="Chips wrap with the query. Remove buttons retain an explicit accessible name.">
    <Field name="runtimes"><FieldLabel>Allowed runtimes</FieldLabel>
      <Combobox multiple items={['Pi', 'OpenClaw', 'Managed runtime']} defaultValue={['Pi', 'OpenClaw']}>
        <ComboboxControl variant="filled"><ComboboxChips><ComboboxValue>{(values: string[]) => values.map(value => <ComboboxChip key={value}><span>{value}</span><ComboboxChipRemove aria-label={`Remove ${value}`} /></ComboboxChip>)}</ComboboxValue><ComboboxInput placeholder="Add runtime" /></ComboboxChips><ComboboxClear aria-label="Clear runtimes" /><ComboboxTrigger aria-label="Show runtimes" /></ComboboxControl>
        <ComboboxContent><ComboboxEmpty>No matching runtimes.</ComboboxEmpty><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent>
        <ComboboxStatus><ComboboxValue>{(values: string[]) => `${values.length} runtimes selected.`}</ComboboxValue></ComboboxStatus>
      </Combobox>
    </Field>
  </StoryStage>,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Pi' }))
    await expect(canvas.queryByRole('button', { name: 'Remove Pi' })).not.toBeInTheDocument()
    await expect(canvas.getByRole('combobox', { name: 'Allowed runtimes' })).toHaveFocus()
    await expect(canvas.getByRole('status')).toHaveTextContent('1 runtimes selected.')
    canvas.getByRole('combobox', { name: 'Allowed runtimes' }).blur()
  },
} satisfies Story

const groups = [{ label: 'Local', items: ['Pi', 'OpenClaw'] }, { label: 'Hosted', items: ['Managed runtime', 'Unavailable runtime'] }]
export const GroupedOptions = {
  render: () => <StoryStage eyebrow="Catalog" title="Grouped choices" description="Group labels organize choices; every option retains a primary text label.">
    <Field><FieldLabel>Grouped runtime</FieldLabel><Combobox items={groups}>
      <ComboboxControl><ComboboxInput /><ComboboxTrigger /></ComboboxControl>
      <ComboboxContent><ComboboxEmpty>No matching runtimes.</ComboboxEmpty><ComboboxList>{(group: typeof groups[number]) => <ComboboxGroup key={group.label} items={group.items}><ComboboxLabel>{group.label}</ComboboxLabel>{group.items.map(item => <ComboboxItem key={item} value={item} disabled={item === 'Unavailable runtime'}>{item}</ComboboxItem>)}</ComboboxGroup>}</ComboboxList></ComboboxContent>
    </Combobox></Field>
  </StoryStage>,
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox', { name: 'Grouped runtime' }), 'Pi')
    await expect(within(document.body).findByRole('option', { name: 'Pi' })).resolves.toBeVisible()
    await expect(within(document.body).queryByRole('option', { name: 'OpenClaw' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
  },
} satisfies Story

export const SizesAndVariants = {
  render: () => <StoryStage eyebrow="Shared appearance" title="Combobox sizes and variants" description="The shell grows for chips while its minimum height matches other form controls.">
    {(['sm', 'md', 'lg'] as const).map(size => <StorySection key={size} title={size}><Grid layout="split" gap="section">{(['outlined', 'filled', 'ghost'] as const).map(variant => <Field key={variant}><FieldLabel>{variant} {size}</FieldLabel><Combobox items={['Pi', 'OpenClaw']}><ComboboxControl size={size} variant={variant}><ComboboxInput /><ComboboxTrigger /></ComboboxControl><ComboboxContent><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox></Field>)}</Grid></StorySection>)}
  </StoryStage>,
  play: async ({ canvas }) => {
    for (const [size, height] of [['sm', 32], ['md', 36], ['lg', 44]] as const) for (const variant of ['outlined', 'filled', 'ghost']) {
      const shell = canvas.getByRole('combobox', { name: `${variant} ${size}` }).closest('[data-slot=combobox-control]')!
      await expect(shell.getBoundingClientRect().height).toBe(height)
    }
  },
} satisfies Story

export const OverlayFixture = {
  render: () => <Dialog><DialogTrigger render={<Button />}>Configure runtime</DialogTrigger><DialogContent><DialogTitle>Runtime configuration</DialogTitle>
    <Field><FieldLabel>Dialog runtimes</FieldLabel><Combobox multiple items={['Pi', 'OpenClaw', 'Managed runtime with a deliberately long label for narrow windows']} defaultValue={['Pi']}>
      <ComboboxControl><ComboboxChips><ComboboxValue>{(values: string[]) => values.map(value => <ComboboxChip key={value}><span>{value}</span><ComboboxChipRemove aria-label={`Remove ${value}`} /></ComboboxChip>)}</ComboboxValue><ComboboxInput /></ComboboxChips><ComboboxTrigger /></ComboboxControl>
      <ComboboxContent><ComboboxEmpty>No runtimes found.</ComboboxEmpty><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox></Field><DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
  </DialogContent></Dialog>,
} satisfies Story

export const CompactAndObjectValues = {
  render: () => <StoryStage eyebrow="Multiple choice" title="Chips or compact summary" description="Switch presentation without changing selected values; the query stays editable in both modes."><CompactSelectionExample /></StoryStage>,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Show compact summary' }))
    await expect(canvas.getByText('Pi +1 more')).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: 'Object runtimes' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Submit runtimes' }))
    await expect(canvas.getByLabelText('Submitted runtime IDs')).toHaveTextContent('pi, claw')
    await userEvent.click(canvas.getByRole('button', { name: 'Clear object runtimes' }))
    await expect(canvas.getByText('No runtimes selected.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Reset object runtimes' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Show chips' }))
    await expect(canvas.getByRole('button', { name: 'Remove Pi' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Remove OpenClaw' })).toBeVisible()
  },
} satisfies Story

export const AsyncAndUnavailable = {
  render: () => <StoryStage eyebrow="Caller-owned requests" title="Async catalog states" description="Loading, no matches and request failures stay distinct. An absent result never erases a selected value."><AsyncSelectionExample /></StoryStage>,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('combobox', { name: 'Remote runtime' })
    await userEvent.type(input, 'error')
    const page = within(document.body)
    await expect(page.findByRole('button', { name: 'Retry runtime search' })).resolves.toBeVisible()
    await expect(page.queryByText('No matching remote runtimes.')).not.toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Retry runtime search' }))
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('3 runtimes available.'))
    await userEvent.click(input)
    ;(input as HTMLInputElement).select()
    await userEvent.type(input, 'no-matches', { skipClick: true })
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('No matching remote runtimes.'))
    await expect(canvas.getByText('Selected runtime: Pi')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(canvas.getByRole('button', { name: 'Mark selected runtime unavailable' }))
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(input).toHaveAccessibleDescription(/This runtime is no longer available/)
    await userEvent.click(input)
    ;(input as HTMLInputElement).select()
    await userEvent.type(input, 'OpenClaw', { skipClick: true })
    await userEvent.click(await page.findByRole('option', { name: /OpenClaw/ }))
    await expect(input).not.toHaveAttribute('aria-invalid', 'true')
    await expect(canvas.getByText('Selected runtime: OpenClaw')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Mark selected runtime unavailable' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Clear remote runtime' }))
    await expect(input).not.toHaveAttribute('aria-invalid', 'true')
    await expect(canvas.getByText('Selected runtime: None')).toBeVisible()
  },
} satisfies Story

export const AsyncFixture = { render: () => <AsyncSelectionExample /> } satisfies Story

export const ControlStates = {
  render: () => <StoryStage eyebrow="Field state" title="Combobox states" description="Readonly preserves inspection; disabled prevents interaction; invalid state explains recovery."><Grid layout="split" gap="section">
    {(['outlined', 'filled', 'ghost'] as const).flatMap(variant => ['readonly', 'disabled', 'invalid'].map(state => <Field key={`${variant}-${state}`} invalid={state === 'invalid'} disabled={state === 'disabled'}>
      <FieldLabel>{variant} {state}</FieldLabel><Combobox items={['Pi', 'OpenClaw']} defaultValue={state === 'invalid' ? null : 'Pi'} readOnly={state === 'readonly'} disabled={state === 'disabled'} required={state === 'invalid'}>
        <ComboboxControl variant={variant}><ComboboxInput /><ComboboxClear /><ComboboxTrigger /></ComboboxControl><ComboboxContent><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent>
      </Combobox>{state === 'invalid' ? <FieldError match>Choose an installed runtime.</FieldError> : null}
    </Field>))}
  </Grid></StoryStage>,
  play: async ({ canvas }) => {
    for (const variant of ['outlined', 'filled', 'ghost']) {
      await expect(canvas.getByRole('combobox', { name: `${variant} readonly` })).toHaveAttribute('readonly')
      await expect(canvas.getByRole('combobox', { name: `${variant} disabled` })).toBeDisabled()
      await expect(canvas.getByRole('combobox', { name: `${variant} invalid` })).toHaveAccessibleDescription('Choose an installed runtime.')
      for (const state of ['readonly', 'disabled', 'invalid']) {
        const shell = canvas.getByRole('combobox', { name: `${variant} ${state}` }).closest('[data-slot=combobox-control]')!
        await expect(shell.getBoundingClientRect().height).toBe(36)
      }
    }
  },
} satisfies Story
