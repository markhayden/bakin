import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
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

  it('routes the public SDK to one implementation; deleted legacy shims stay gone', async () => {
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    const hostBridge = readRepoFile('packages/host/src/ui/selection.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    // P-final: the legacy `src/components/ui/*` selection shims were deleted
    // with the frozen barrel — reintroducing one is a regression.
    for (const primitive of PRIMITIVES) {
      expect(existsSync(join(REPO_ROOT, `src/components/ui/${primitive}.tsx`))).toBe(false)
    }

    const [privateUi, publicUi] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
    ])

    expect(publicUi.Checkbox).toBe(privateUi.Checkbox)
    expect(publicUi.Switch).toBe(privateUi.Switch)
    expect(publicUi.Select).toBe(privateUi.Select)
    expect(publicUi.SelectTrigger).toBe(privateUi.SelectTrigger)
    expect(publicUi.SelectContent).toBe(privateUi.SelectContent)
    expect(publicUi.SelectItem).toBe(privateUi.SelectItem)
  })

  it('keeps shared option presentation private', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    expect(privateIndex).not.toContain("from './primitives/option-list'")
    expect(sdkSource).not.toContain('optionItemClasses')
  })
})
