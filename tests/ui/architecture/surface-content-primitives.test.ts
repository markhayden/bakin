import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const PRIMITIVES = ['avatar', 'card', 'separator', 'skeleton', 'collapsible'] as const

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

describe('surface and content primitive ownership', () => {
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
    const hostBridge = readRepoFile('packages/host/src/ui/surface-content.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    for (const primitive of PRIMITIVES) {
      const shim = readRepoFile(`src/components/ui/${primitive}.tsx`)
      expect(shim).toContain("from '../../../packages/host/src/ui/surface-content'")
      expect(shim).not.toContain('@base-ui/react')
    }

    const [privateUi, publicUi, legacyAvatar, legacyCard, legacySeparator, legacySkeleton, legacyCollapsible] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../src/components/ui/avatar'),
      import('../../../src/components/ui/card'),
      import('../../../src/components/ui/separator'),
      import('../../../src/components/ui/skeleton'),
      import('../../../src/components/ui/collapsible'),
    ])

    expect(publicUi.Avatar).toBe(privateUi.Avatar)
    expect(publicUi.Card).toBe(privateUi.Card)
    expect(publicUi.Separator).toBe(privateUi.Separator)
    expect(publicUi.Skeleton).toBe(privateUi.Skeleton)
    expect(publicUi.Collapsible).toBe(privateUi.Collapsible)
    expect(legacyAvatar.Avatar).toBe(privateUi.Avatar)
    expect(legacyCard.Card).toBe(privateUi.Card)
    expect(legacySeparator.Separator).toBe(privateUi.Separator)
    expect(legacySkeleton.Skeleton).toBe(privateUi.Skeleton)
    expect(legacyCollapsible.Collapsible).toBe(privateUi.Collapsible)
  })
})
