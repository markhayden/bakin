// @vitest-environment jsdom
import { afterEach, expect, it, mock } from 'bun:test'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '../rtl-settle'

let initialQuery = ''
mock.module('@makinbakin/sdk/navigation', () => ({
  useQueryState: (_key: string, fallback: string) => useState(initialQuery || fallback),
}))
import { RuntimeTable } from '../../packages/host/src/components/runtime/runtime-table'

afterEach(() => { cleanup(); initialQuery = '' })
const rows = [{ id: 'unknown', value: null }, { id: 'ten', value: 10 }, { id: 'two', value: 2 }]
function Fixture() {
  return <RuntimeTable label="Runtime values" queryKey="sort" rows={rows} rowKey={row => row.id}
    columns={[{ key: 'value', header: 'Value', sortable: true, sortValue: row => row.value, narrow: 'primary', cell: row => row.id }]} />
}
function identities(role: 'table' | 'list') {
  return [...screen.getByRole(role, { name: 'Runtime values' }).querySelectorAll(role === 'table' ? 'tbody tr' : ':scope > li')]
    .map(row => row.textContent)
}
it('falls back for invalid query state and sorts numeric values with unknowns last at both widths', async () => {
  initialQuery = 'invalid'
  await act(async () => { render(<Fixture />) })
  expect(identities('table')).toEqual(['two', 'ten', 'unknown'])
  expect(identities('list')).toEqual(['two', 'ten', 'unknown'])
  await act(async () => { fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Value' })) })
  expect(identities('table')).toEqual(['ten', 'two', 'unknown'])
  expect(identities('list')).toEqual(['ten', 'two', 'unknown'])
  expect(screen.getByRole('combobox', { name: 'Sort runtime values' }).textContent).toContain('Value: descending')
})
it('restores a valid descending query', async () => {
  initialQuery = 'value:desc'
  await act(async () => { render(<Fixture />) })
  expect(identities('table')).toEqual(['ten', 'two', 'unknown'])
  expect(identities('list')).toEqual(['ten', 'two', 'unknown'])
})
