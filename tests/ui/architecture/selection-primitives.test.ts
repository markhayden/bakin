import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const PRIMITIVES = ['checkbox', 'switch', 'select'] as const

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

describe('selection primitive ownership', () => {
  it('owns each implementation and shared option presentation in the private UI package', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')

    for (const primitive of PRIMITIVES) {
      expect(privateIndex).toContain(`from './primitives/${primitive}'`)
      const implementation = readRepoFile(`packages/ui/src/primitives/${primitive}.tsx`)
      expect(implementation).not.toContain("from '@/")
      expect(implementation).not.toContain('@makinbakin/sdk')
    }

    const select = readRepoFile('packages/ui/src/primitives/select.tsx')
    expect(select).toContain("from './option-list'")
    expect(readRepoFile('packages/ui/src/primitives/option-list.ts')).toContain('optionItemClasses')
  })

  it('routes the public SDK and legacy app paths to one implementation', async () => {
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    const hostBridge = readRepoFile('packages/host/src/ui/selection.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    for (const primitive of PRIMITIVES) {
      const shim = readRepoFile(`src/components/ui/${primitive}.tsx`)
      expect(shim).toContain("from '../../../packages/host/src/ui/selection'")
      expect(shim).not.toContain('@base-ui/react')
    }

    const [privateUi, publicUi, legacyCheckbox, legacySwitch, legacySelect] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../src/components/ui/checkbox'),
      import('../../../src/components/ui/switch'),
      import('../../../src/components/ui/select'),
    ])

    expect(publicUi.Checkbox).toBe(privateUi.Checkbox)
    expect(publicUi.Switch).toBe(privateUi.Switch)
    expect(publicUi.Select).toBe(privateUi.Select)
    expect(publicUi.SelectTrigger).toBe(privateUi.SelectTrigger)
    expect(legacyCheckbox.Checkbox).toBe(privateUi.Checkbox)
    expect(legacySwitch.Switch).toBe(privateUi.Switch)
    expect(legacySelect.SelectContent).toBe(privateUi.SelectContent)
    expect(legacySelect.SelectItem).toBe(privateUi.SelectItem)
  })

  it('keeps shared option presentation private', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    expect(privateIndex).not.toContain("from './primitives/option-list'")
    expect(sdkSource).not.toContain('optionItemClasses')
  })
})
