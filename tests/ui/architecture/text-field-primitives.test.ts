import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const PRIMITIVES = ['label', 'input', 'textarea', 'input-group'] as const

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

describe('text-field primitive ownership', () => {
  it('owns each implementation in the private UI package', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')

    for (const primitive of PRIMITIVES) {
      expect(privateIndex).toContain(`from './primitives/${primitive}'`)
      const implementation = readRepoFile(`packages/ui/src/primitives/${primitive}.tsx`)
      expect(implementation).not.toContain("from '@/")
      expect(implementation).not.toContain('@makinbakin/sdk')
    }
  })

  it('routes the public SDK and legacy app paths to one implementation', async () => {
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    const hostBridge = readRepoFile('packages/host/src/ui/text-fields.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    for (const primitive of PRIMITIVES) {
      const shim = readRepoFile(`src/components/ui/${primitive}.tsx`)
      expect(shim).toContain("from '../../../packages/host/src/ui/text-fields'")
      expect(shim).not.toContain('@base-ui/react')
    }

    const [privateUi, publicUi, legacyLabel, legacyInput, legacyTextarea, legacyInputGroup] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../src/components/ui/label'),
      import('../../../src/components/ui/input'),
      import('../../../src/components/ui/textarea'),
      import('../../../src/components/ui/input-group'),
    ])

    expect(publicUi.Label).toBe(privateUi.Label)
    expect(publicUi.Input).toBe(privateUi.Input)
    expect(publicUi.Textarea).toBe(privateUi.Textarea)
    expect(publicUi.InputGroup).toBe(privateUi.InputGroup)
    expect(legacyLabel.Label).toBe(privateUi.Label)
    expect(legacyInput.Input).toBe(privateUi.Input)
    expect(legacyTextarea.Textarea).toBe(privateUi.Textarea)
    expect(legacyInputGroup.InputGroup).toBe(privateUi.InputGroup)
  })
})
