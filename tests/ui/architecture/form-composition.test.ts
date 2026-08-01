import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as PrivateUi from '@bakin/ui'
import * as PublicUi from '@makinbakin/sdk/ui'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')

describe('canonical form ownership', () => {
  it('owns field, fieldset, and form composition in the private presentation package', () => {
    const files = [
      'packages/ui/src/forms/field.tsx',
      'packages/ui/src/forms/fieldset.tsx',
      'packages/ui/src/forms/form.tsx',
      'packages/ui/src/forms/index.ts',
    ]

    for (const file of files) expect(existsSync(resolve(REPO_ROOT, file))).toBe(true)

    const source = files.map(read).join('\n')
    expect(source).not.toMatch(/from ['"]@\//)
    expect(source).not.toContain('@makinbakin/sdk')
    expect(source).not.toContain('react-hook-form')
    expect(source).not.toMatch(/src\/components/)
  })

  it('publishes one implementation through explicit SDK UI exports', () => {
    expect(PublicUi.Field).toBe(PrivateUi.Field)
    expect(PublicUi.FieldLabel).toBe(PrivateUi.FieldLabel)
    expect(PublicUi.FieldDescription).toBe(PrivateUi.FieldDescription)
    expect(PublicUi.FieldError).toBe(PrivateUi.FieldError)
    expect(PublicUi.FieldControl).toBe(PrivateUi.FieldControl)
    expect(PublicUi.Fieldset).toBe(PrivateUi.Fieldset)
    expect(PublicUi.Form).toBe(PrivateUi.Form)
    expect(PublicUi.FormActions).toBe(PrivateUi.FormActions)
    expect(PublicUi.SubmitButton).toBe(PrivateUi.SubmitButton)

    const sdkSource = read('packages/sdk/src/ui/index.ts')
    expect(sdkSource).not.toContain("export * from '@/components/ui/form'")
    expect(sdkSource).toContain('FieldDescription')
    expect(sdkSource).toContain('FormActions')
    expect(sdkSource).toContain("from '@bakin/ui'")
  })

  it('keeps form-library adapters presentation-free; the legacy shim stays deleted (P-final)', () => {
    expect(existsSync(resolve(REPO_ROOT, 'src/components/ui/form.tsx'))).toBe(false)

    const hostBridge = read('packages/host/src/ui/forms.ts')
    expect(hostBridge).toContain("from '@bakin/ui'")
    expect(hostBridge).not.toContain('react-hook-form')

    const manifest = read('package.json')
    expect(manifest).not.toContain('react-hook-form')
    expect(manifest).not.toContain('@hookform/resolvers')
  })
})
