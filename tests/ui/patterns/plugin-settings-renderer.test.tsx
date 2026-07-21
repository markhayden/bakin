// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { PluginSettingsRenderer } from '@makinbakin/sdk/patterns'
import type { PluginSettingsSchema } from '@makinbakin/sdk/types'

afterEach(cleanup)

const schema: PluginSettingsSchema = {
  fields: [
    { key: 'workspace', type: 'string', label: 'Workspace name', description: 'Visible to collaborators.', required: true },
    { key: 'leadHours', type: 'number', label: 'Preparation lead hours', default: 24 },
    { key: 'approval', type: 'boolean', label: 'Require approval', description: 'Pause before publishing.' },
    {
      key: 'assetRequirement',
      type: 'select',
      label: 'Asset requirement',
      options: [
        { value: 'optional', label: 'Optional' },
        { value: 'required', label: 'Required' },
      ],
      default: 'optional',
    },
    {
      key: 'contentTypes',
      type: 'list',
      label: 'Content types',
      description: 'Messaging-owned planning categories.',
      addLabel: 'Add content type',
      minItems: 1,
      maxItems: 2,
      uniqueField: 'id',
      itemShape: {
        id: { key: 'id', type: 'string', label: 'ID', required: true },
        label: { key: 'label', type: 'string', label: 'Label', required: true },
        workflowId: { key: 'workflowId', type: 'string', label: 'Workflow ID' },
        defaultAgent: { key: 'defaultAgent', type: 'string', label: 'Default agent' },
        prepLeadHours: { key: 'prepLeadHours', type: 'number', label: 'Prep lead hours', default: 0 },
        requiresApproval: { key: 'requiresApproval', type: 'boolean', label: 'Requires approval' },
        assetRequirement: {
          key: 'assetRequirement',
          type: 'select',
          label: 'Asset requirement',
          options: [{ value: 'none', label: 'None' }, { value: 'image', label: 'Image' }],
          default: 'none',
        },
      },
    },
  ],
}

const values = {
  workspace: 'Creator operations',
  leadHours: 24,
  approval: false,
  assetRequirement: 'optional',
  contentTypes: [{
    id: 'post',
    label: 'Post',
    workflowId: 'publish-post',
    defaultAgent: 'main',
    prepLeadHours: 12,
    requiresApproval: true,
    assetRequirement: 'image',
  }],
}

describe('focused PluginSettingsRenderer', () => {
  it('associates every scalar control with its schema label and exposes consumer feedback', () => {
    render(
      <PluginSettingsRenderer
        schema={schema}
        values={values}
        onSubmit={() => {}}
        feedback={{ tone: 'success', title: 'Messaging settings saved', description: 'New plans use these defaults.' }}
      />,
    )

    expect((screen.getByRole('textbox', { name: /workspace name/i }) as HTMLInputElement).value).toBe('Creator operations')
    expect((screen.getByRole('spinbutton', { name: /preparation lead hours/i }) as HTMLInputElement).value).toBe('24')
    expect(screen.getByRole('switch', { name: /require approval/i }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getAllByRole('combobox', { name: /asset requirement/i })).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toContain('Messaging settings saved')
  })

  it('submits all field types, supports list rows, and resets to supplied values', () => {
    const onSubmit = mock()
    render(<PluginSettingsRenderer schema={schema} values={values} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByRole('textbox', { name: /workspace name/i }), { target: { value: 'Publishing ops' } })
    fireEvent.click(screen.getByRole('switch', { name: /^require approval$/i }))
    fireEvent.click(screen.getByRole('button', { name: /add content type/i }))
    expect(screen.getAllByRole('group', { name: /content types row/i })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /add content type/i }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect((screen.getByRole('textbox', { name: /workspace name/i }) as HTMLInputElement).value).toBe('Creator operations')
    expect(screen.getAllByRole('group', { name: /content types row/i })).toHaveLength(1)

    fireEvent.change(screen.getByRole('textbox', { name: /workspace name/i }), { target: { value: 'Publishing ops' } })
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ workspace: 'Publishing ops' }))
  })

  it('blocks invalid submissions with durable field feedback and notifies the consumer', () => {
    const onSubmit = mock()
    const onValidationError = mock()
    render(
      <PluginSettingsRenderer
        schema={schema}
        values={{ ...values, contentTypes: [values.contentTypes[0], { ...values.contentTypes[0], label: '' }] }}
        onSubmit={onSubmit}
        onValidationError={onValidationError}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: /workspace name/i }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /workspace name/i }).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toMatch(/workspace name.*required/i)
    expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toMatch(/row 2.*label.*required/i)
    expect(onValidationError).toHaveBeenCalledWith(expect.stringMatching(/workspace name.*required/i))
  })

  it('enforces list minimum, unique values, disabled state, and visible busy state', () => {
    const { rerender } = render(
      <PluginSettingsRenderer schema={schema} values={values} onSubmit={() => {}} busy />,
    )
    expect(screen.getByRole('button', { name: /saving settings/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('form').getAttribute('aria-busy')).toBe('true')

    rerender(<PluginSettingsRenderer schema={schema} values={values} onSubmit={() => {}} disabled />)
    expect((screen.getByRole('textbox', { name: /workspace name/i }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /delete row 1 from content types/i }).hasAttribute('disabled')).toBe(true)
  })
})
