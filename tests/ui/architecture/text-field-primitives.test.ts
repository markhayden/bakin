import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
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

  it('routes the public SDK to one implementation; deleted legacy shims stay gone', async () => {
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    const hostBridge = readRepoFile('packages/host/src/ui/text-fields.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    // P-final: the legacy `src/components/ui/*` text-field shims were deleted
    // with the frozen barrel — reintroducing one is a regression, except the
    // `input` shim which host code still reaches via `@/components/ui/input`.
    for (const primitive of ['label', 'textarea', 'input-group']) {
      expect(existsSync(join(REPO_ROOT, `src/components/ui/${primitive}.tsx`))).toBe(false)
    }
    const inputShim = readRepoFile('src/components/ui/input.tsx')
    expect(inputShim).toContain("from '../../../packages/host/src/ui/text-fields'")
    expect(inputShim).not.toContain('@base-ui/react')

    const [privateUi, publicUi, legacyInput] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../src/components/ui/input'),
    ])

    expect(publicUi.Label).toBe(privateUi.Label)
    expect(publicUi.Input).toBe(privateUi.Input)
    expect(publicUi.Textarea).toBe(privateUi.Textarea)
    expect(publicUi.InputGroup).toBe(privateUi.InputGroup)
    expect(legacyInput.Input).toBe(privateUi.Input)
  })
})
