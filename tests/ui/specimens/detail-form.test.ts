import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

describe('detail and form direction specimens', () => {
  it('adds owned field, action-bar, and overlay prototypes to the candidate API', () => {
    const candidateUi = read('storybook/internal/specimens/candidate-ui.tsx')

    for (const api of ['TextField', 'TextAreaField', 'SelectField', 'CheckboxField', 'FormActions', 'Overlay']) {
      expect(candidateUi).toContain(`export function ${api}`)
    }
    for (const state of ['aria-invalid', 'aria-describedby', 'required', 'readOnly', 'disabled']) {
      expect(candidateUi).toContain(state)
    }
    expect(candidateUi).toContain("role=\"dialog\"")
    expect(candidateUi).toContain('aria-modal="true"')
    expect(candidateUi).toContain('closeRef.current?.focus()')
    expect(candidateUi).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })

  it('covers realistic detail, form, validation, save, discard, destructive, and narrow states', () => {
    const story = read('storybook/internal/specimens/detail-form.stories.tsx')

    expect(story).toContain("tags: ['internal']")
    for (const exportName of ['SideBySide', 'FieldStates', 'OverlayWorkflow', 'TextAt200Percent']) {
      expect(story).toContain(`export const ${exportName}`)
    }
    for (const api of ['PageShell', 'Stack', 'Inline', 'Grid', 'Section', 'TextField', 'TextAreaField', 'SelectField', 'CheckboxField', 'FormActions', 'Overlay', 'SystemState']) {
      expect(story).toMatch(new RegExp(`<${api}(?:\\s|>)`))
    }
    expect(story).not.toMatch(/<(?:input|select|textarea)\b/)
    for (const fixture of [
      'Acme Labs creator operations',
      'brand:acme-labs-creator-operations',
      'Marketing operations and campaign delivery',
      'project:spring-launch-2026',
      'Delete brand workspace',
    ]) {
      expect(story).toContain(fixture)
    }
    for (const state of ['required', 'optional', 'readOnly', 'disabled', 'loading', 'submitting', 'validation']) {
      expect(story).toContain(state)
    }
    expect(story).toContain('setDirty(true)')
    expect(story).toContain('setDeleteOpen(true)')
    expect(story).toContain("<style>{'html { font-size: 200%; }'}</style>")
    for (const coverage of ['desktop', 'mobile-320', 'text-200', 'focus-order', 'validation', 'overlay', 'destructive']) {
      expect(story).toContain(`'${coverage}'`)
    }
  })
})
