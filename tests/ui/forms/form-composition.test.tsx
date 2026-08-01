// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'

import {
  Checkbox,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Fieldset,
  FieldsetDescription,
  FieldsetLegend,
  Form,
  FormActions,
  Input,
  SubmitButton,
  Textarea,
} from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('Field public contract', () => {
  it('mechanically associates the label, description, and error with the real control', async () => {
    render(
      <Field invalid name="projectName">
        <FieldLabel requirement="required">Project name</FieldLabel>
        <FieldDescription>Shown to everyone in the workspace.</FieldDescription>
        <Input required defaultValue="" />
        <FieldError match>Use at least three characters.</FieldError>
      </Field>,
    )

    const input = screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement
    await waitFor(() => {
      const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? []
      expect(describedBy).toContain(screen.getByText('Shown to everyone in the workspace.').id)
      expect(describedBy).toContain(screen.getByText('Use at least three characters.').id)
    })
    expect(input.required).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Required').getAttribute('aria-hidden')).toBe('true')

    const label = screen.getByText('Project name').closest('label') as HTMLLabelElement
    expect(label.htmlFor).toBe(input.id)
  })

  it('associates a native textarea through FieldControl without changing its presentation owner', async () => {
    render(
      <Field name="notes">
        <FieldLabel requirement="optional">Operational notes</FieldLabel>
        <FieldControl render={<Textarea rows={4} />} />
        <FieldDescription>Markdown is supported.</FieldDescription>
      </Field>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Operational notes' })
    expect(textarea.getAttribute('data-slot')).toBe('textarea')
    expect(textarea.className).toContain('resize-y')
    await waitFor(() => expect(textarea.getAttribute('aria-describedby')).toBe(screen.getByText('Markdown is supported.').id))
    expect(screen.getByText('Optional').getAttribute('aria-hidden')).toBe('true')
  })

  it('supports async validation without moving presentation into a form library', async () => {
    const validate = mock(async (value: unknown) => (
      String(value).startsWith('plugin-') ? null : 'Use a plugin- prefix.'
    ))

    render(
      <Form validationMode="onBlur">
        <Field name="slug" validate={validate}>
          <FieldLabel>Plugin slug</FieldLabel>
          <Input defaultValue="workflow" />
          <FieldError />
        </Field>
      </Form>,
    )

    fireEvent.blur(screen.getByRole('textbox', { name: 'Plugin slug' }))
    expect(await screen.findByText('Use a plugin- prefix.')).toBeTruthy()
    expect(validate).toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Plugin slug' }).getAttribute('aria-invalid')).toBe('true')
  })
})

describe('Fieldset public contract', () => {
  it('associates its legend and description and propagates its disabled state', async () => {
    render(
      <Fieldset disabled>
        <FieldsetLegend>Notifications</FieldsetLegend>
        <FieldsetDescription>Choose how operators are notified.</FieldsetDescription>
        <FieldGroup>
          <Field orientation="horizontal" name="emailAlerts">
            <Checkbox defaultChecked />
            <FieldLabel>Email alerts</FieldLabel>
          </Field>
        </FieldGroup>
      </Fieldset>,
    )

    const group = screen.getByRole('group', { name: 'Notifications' })
    await waitFor(() => expect(group.getAttribute('aria-describedby')).toBe(screen.getByText('Choose how operators are notified.').id))
    expect(group.getAttribute('data-disabled')).not.toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Email alerts' }).getAttribute('data-disabled')).not.toBeNull()
  })
})

describe('Form submission composition', () => {
  it('submits named values and gives busy actions one duplicate-safe source of truth', async () => {
    const submitted: Array<{ projectName: string }> = []
    const onFormSubmit = mock((values: { projectName: string }) => {
      submitted.push(values)
    })
    const { rerender } = render(
      <Form<{ projectName: string }> aria-label="Project settings" onFormSubmit={onFormSubmit}>
        <Field name="projectName">
          <FieldLabel>Project name</FieldLabel>
          <Input defaultValue="Bakin" />
        </Field>
        <FormActions>
          <SubmitButton>Save changes</SubmitButton>
        </FormActions>
      </Form>,
    )

    fireEvent.submit(screen.getByRole('form', { name: 'Project settings' }))
    await waitFor(() => expect(onFormSubmit).toHaveBeenCalled())
    expect(submitted[0]).toEqual({ projectName: 'Bakin' })

    rerender(
      <Form busy aria-busy="false" aria-label="Project settings">
        <FormActions align="between">
          <button type="button">Cancel</button>
          <SubmitButton busy={false} busyLabel="Saving changes">Save changes</SubmitButton>
        </FormActions>
      </Form>,
    )

    const form = screen.getByRole('form', { name: 'Project settings' })
    const submit = screen.getByRole('button', { name: 'Saving changes' }) as HTMLButtonElement
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(submit.disabled).toBe(true)
    expect(submit.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Cancel').closest('[data-slot="form-actions"]')?.getAttribute('data-align')).toBe('between')
  })
})
