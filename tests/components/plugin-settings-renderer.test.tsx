// @vitest-environment jsdom
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { act, render, screen, fireEvent } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PluginSettingsSchema } from '@bakin/core/plugin-types'

const testDir = join(tmpdir(), `bakin-test-settings-renderer-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

const toastAdd = mock()
mock.module('@/hooks/use-toast', () => ({
  useToastStore: (selector: (s: { add: typeof toastAdd }) => unknown) => selector({ add: toastAdd }),
}))

import { PluginSettingsRenderer } from '@/components/plugin-settings-renderer'

const listSchema: PluginSettingsSchema = {
  fields: [
    {
      key: 'contentTypes',
      type: 'list',
      label: 'Content Types',
      description: 'Categories used across the content calendar.',
      addLabel: 'Add content type',
      minItems: 1,
      maxItems: 3,
      itemShape: {
        id:    { key: 'id',    type: 'string', label: 'ID',    required: true },
        label: { key: 'label', type: 'string', label: 'Label', required: true },
      },
    },
  ],
}

describe('PluginSettingsRenderer — list field', () => {
  beforeEach(() => {
    toastAdd.mockClear()
  })

  it('renders existing rows', () => {
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={listSchema}
        values={{ contentTypes: [{ id: 'post', label: 'Post' }, { id: 'video', label: 'Video' }] }}
        onSave={mock()}
      />
    )
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs.map(i => i.value)).toEqual(['post', 'Post', 'video', 'Video'])
  })

  it('adds an empty row when "Add" is clicked', () => {
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={listSchema}
        values={{ contentTypes: [{ id: 'post', label: 'Post' }] }}
        onSave={mock()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add content type/i }))
    expect(screen.getAllByRole('textbox')).toHaveLength(4)
  })

  it('disables "Add" at maxItems', () => {
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={listSchema}
        values={{ contentTypes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ] }}
        onSave={mock()}
      />
    )
    expect(screen.getByRole('button', { name: /add content type/i }).hasAttribute('disabled')).toBe(true)
  })

  it('deletes a row when trash button is clicked', () => {
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={listSchema}
        values={{ contentTypes: [
          { id: 'post', label: 'Post' },
          { id: 'video', label: 'Video' },
        ] }}
        onSave={mock()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /delete row 1/i }))
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs.map(i => i.value)).toEqual(['video', 'Video'])
  })

  it('disables delete at minItems', () => {
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={listSchema}
        values={{ contentTypes: [{ id: 'post', label: 'Post' }] }}
        onSave={mock()}
      />
    )
    expect(screen.getByRole('button', { name: /delete row 1/i }).hasAttribute('disabled')).toBe(true)
  })

  it('saves edited values through onSave', async () => {
    let finishSave: (() => void) | undefined
    const onSave = mock((_nextValues: Record<string, unknown>) => (
      new Promise<void>((resolve) => { finishSave = resolve })
    ))
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={listSchema}
        values={{ contentTypes: [{ id: 'post', label: 'Post' }] }}
        onSave={onSave}
      />
    )
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    fireEvent.change(inputs[1], { target: { value: 'Blog Post' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save$/i })) })
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toEqual({
      contentTypes: [{ id: 'post', label: 'Blog Post' }],
    })
    await act(async () => finishSave?.())
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /^save$/i }).hasAttribute('disabled')).toBe(false)
    })
  })

  it('blocks save with a toast when a required field is empty', async () => {
    const onSave = mock()
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={listSchema}
        values={{ contentTypes: [{ id: 'post', label: 'Post' }] }}
        onSave={onSave}
      />
    )
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    fireEvent.change(inputs[1], { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save$/i })) })
    expect(onSave).not.toHaveBeenCalled()
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: expect.stringMatching(/label.*required/i) })
    )
  })

  it('blocks save with a toast when uniqueField rows collide', async () => {
    const schema: PluginSettingsSchema = {
      fields: [
        { ...listSchema.fields[0] as Extract<PluginSettingsSchema['fields'][number], { type: 'list' }>, uniqueField: 'id' },
      ],
    }
    const onSave = mock()
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={schema}
        values={{ contentTypes: [
          { id: 'post',  label: 'Post' },
          { id: 'video', label: 'Video' },
        ] }}
        onSave={onSave}
      />
    )
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    // Collide row 2's id onto row 1's.
    fireEvent.change(inputs[2], { target: { value: 'post' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save$/i })) })
    expect(onSave).not.toHaveBeenCalled()
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: expect.stringMatching(/unique/i) })
    )
  })

  it('blocks save with a toast when below minItems', async () => {
    // Load stored values that already violate minItems (e.g. older state pre-rule-change),
    // then edit a field to dirty the form and trigger save validation.
    const schema: PluginSettingsSchema = {
      fields: [
        { ...listSchema.fields[0] as Extract<PluginSettingsSchema['fields'][number], { type: 'list' }>, minItems: 3 },
      ],
    }
    const onSave = mock()
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={schema}
        values={{ contentTypes: [
          { id: 'post',  label: 'Post' },
          { id: 'video', label: 'Video' },
        ] }}
        onSave={onSave}
      />
    )
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    fireEvent.change(inputs[1], { target: { value: 'Blog Post' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save$/i })) })
    expect(onSave).not.toHaveBeenCalled()
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: expect.stringMatching(/at least 3/i) })
    )
  })

  it('renders list-row sub-fields in a finite responsive container grid', () => {
    render(
      <PluginSettingsRenderer
        pluginId="messaging"
        schema={listSchema}
        values={{ contentTypes: [{ id: 'post', label: 'Post' }] }}
        onSave={mock()}
      />
    )
    const row = screen.getByTestId('list-row-contentTypes-0')
    const gridContainer = row.firstElementChild as HTMLElement | null
    expect(gridContainer).not.toBeNull()
    expect(gridContainer!.className).toContain('grid-cols-1')
    expect(gridContainer!.className).toContain('@md/settings-row:grid-cols-2')
    expect(gridContainer!.className).toContain('@2xl/settings-row:grid-cols-3')
    expect(gridContainer!.style.gridTemplateColumns).toBe('')
  })
})
