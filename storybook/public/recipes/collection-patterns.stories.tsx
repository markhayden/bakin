import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CollectionComparison } from '../../support/collection-records'
import { CollectionRowBehaviors } from '../../support/collection-rows'
import { CollectionMedia } from '../../support/collection-media'

const meta = {
  title: 'Recipes/Collection patterns',
  component: CollectionComparison,
  tags: ['public'],
  args: { showActions: true, onAction: fn<(action: string, title: string) => void>() },
  argTypes: { showActions: { control: 'boolean' }, onAction: { control: false } },
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'DataTable is the default for record collections, with one column model for wide and narrow layouts. Choose cards when meaningful previews earn the space; use separated rows for compact supporting lists or a specific interaction need. These examples compare existing patterns without changing their runtime prop defaults.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'non-color'],
  },
} satisfies Meta<typeof CollectionComparison>

export default meta
type Story = StoryObj<typeof meta>

export const SameRecords = {
  render: (args) => <CollectionComparison {...args} />,
  play: async ({ canvas, args }) => {
    args.onAction.mockClear()
    const rows = canvas.getByRole('list', { name: 'Projects as standard rows' })
    const cards = canvas.getByRole('list', { name: 'Projects as cards' })
    const table = canvas.getByRole('table', { name: 'Projects as a comparison table' })
    await expect(within(rows).getAllByRole('listitem')).toHaveLength(3)
    await expect(within(cards).getAllByRole('listitem')).toHaveLength(3)
    for (const surface of [rows, cards, table]) {
      await expect(within(surface).getByText('Spring menu launch', { exact: true })).toBeVisible()
      await expect(within(surface).getByText('40% complete', { exact: true })).toBeVisible()
      if (args.showActions) {
        const trigger = within(surface).getByRole('button', { name: 'More actions for Spring menu launch' })
        trigger.focus()
        await userEvent.keyboard('{Enter}')
        const page = within(document.body)
        const menu = await page.findByRole('menu', { name: 'More actions for Spring menu launch' })
        await expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveAttribute('data-variant', 'danger')
        await userEvent.click(within(menu).getByRole('menuitem', { name: 'Duplicate' }))
        await waitFor(() => expect(menu).not.toBeInTheDocument())
        await expect(args.onAction).toHaveBeenLastCalledWith('duplicate', 'Spring menu launch')
        await waitFor(() => expect(trigger).toHaveFocus())
      } else {
        await expect(within(surface).queryByRole('button', { name: 'More actions for Spring menu launch' })).not.toBeInTheDocument()
      }
    }
  },
} satisfies Story

export const RowBehaviors = {
  render: (args) => <CollectionRowBehaviors {...args} />,
  play: async ({ canvas, canvasElement, args }) => {
    delete canvasElement.dataset.storyReady
    const list = canvas.getByRole('list', { name: 'Planning projects' })
    const completed = canvas.getByRole('list', { name: 'Completed projects' })
    const firstGroup = list.closest('[data-slot=list-row-group]')!
    const nextGroup = completed.closest('[data-slot=list-row-group]')!
    await expect(getComputedStyle(firstGroup).marginTop).toBe('0px')
    await expect(getComputedStyle(nextGroup).marginTop).toBe(getComputedStyle(firstGroup).rowGap)
    for (const name of ['Planning projects', 'Completed projects']) {
      const heading = canvas.getByRole('heading', { level: 3, name })
      const groupList = canvas.getByRole('list', { name })
      await expect(heading.getBoundingClientRect().left).toBe(groupList.getBoundingClientRect().left)
      await expect(heading.getBoundingClientRect().right).toBe(groupList.getBoundingClientRect().right)
      await expect(parseFloat(getComputedStyle(heading).borderLeftWidth)).toBeGreaterThan(0)
      await expect(getComputedStyle(heading).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    }
    for (const groupList of [list, completed]) {
      await expect(getComputedStyle(groupList).borderTopWidth).toBe('0px')
      await expect(getComputedStyle(groupList).borderBottomWidth).toBe('0px')
    }
    const planningRows = within(list).getAllByRole('listitem')
    await expect(parseFloat(getComputedStyle(planningRows[0]).borderBottomWidth)).toBeGreaterThan(0)
    const select = within(list).getByRole('button', { name: 'Select Spring menu launch' })
    const row = select.closest('[data-slot="list-row"]')!
    if (args.showActions) {
      const trigger = within(list).getByRole('button', { name: 'More actions for Spring menu launch' })
      await userEvent.click(trigger)
      const menu = await within(document.body).findByRole('menu', { name: 'More actions for Spring menu launch' })
      // Pointer opening transfers focus asynchronously; Escape must target the menu.
      await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true))
      await expect(row).not.toHaveAttribute('data-selected')
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(menu).not.toBeInTheDocument())
      await waitFor(() => expect(trigger).toHaveFocus())
    }
    for (const action of within(row as HTMLElement).getAllByRole('button')) {
      await expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right)
    }
    await userEvent.click(within(list).getByRole('button', { name: 'Pin Spring menu launch' }))
    await expect(select.closest('[data-slot="list-row"]')).not.toHaveAttribute('data-selected')
    await expect(within(list).getByRole('button', { name: 'Unpin Spring menu launch' })).toHaveAttribute('aria-pressed', 'true')
    select.focus()
    await userEvent.keyboard('{Enter}')
    await expect(select.closest('[data-slot="list-row"]')).toHaveAttribute('data-selected')
    const details = within(list).getByRole('button', { name: 'Details for Spring menu launch' })
    const pinned = within(list).getByRole('button', { name: 'Unpin Spring menu launch' })
    // Disclosure defaults must not turn a compact row action into a full-height control.
    await expect(details.getBoundingClientRect().height).toBe(pinned.getBoundingClientRect().height)
    await expect(pinned).toHaveAttribute('data-size', 'xs')
    await expect(details).toHaveAttribute('data-size', 'xs')
    await expect(details.querySelector('.lucide-chevron-down')).toBeVisible()
    await expect(details.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(details)
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await expect(details.querySelector('.lucide-chevron-up')).toBeVisible()
    await expect(within(list).getByText('Coordinate photography, seasonal recipes, and the launch brief.')).toBeVisible()
    await userEvent.click(details)
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(details.querySelector('.lucide-chevron-down')).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Completed projects' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
    canvasElement.dataset.storyReady = 'true'
  },
} satisfies Story

export const PreviewCards = {
  render: () => <CollectionMedia />,
  play: async ({ canvas }) => {
    const gallery = canvas.getByRole('list', { name: 'Brand identity previews' })
    await expect(within(gallery).getAllByRole('listitem')).toHaveLength(2)
    await expect(within(gallery).getByRole('img', { name: 'Daybreak Studio monogram' })).toBeVisible()
    await expect(within(gallery).getByRole('img', { name: 'Field Notes monogram' })).toBeVisible()
  },
} satisfies Story
