import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
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

  it('routes the public SDK to one implementation; deleted legacy shims stay gone', async () => {
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    const hostBridge = readRepoFile('packages/host/src/ui/surface-content.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    // P-final: the legacy shims were deleted with the frozen barrel, except
    // `skeleton`, which host code still reaches via `@/components/ui/skeleton`.
    for (const primitive of ['avatar', 'card', 'separator', 'collapsible']) {
      expect(existsSync(join(REPO_ROOT, `src/components/ui/${primitive}.tsx`))).toBe(false)
    }
    const skeletonShim = readRepoFile('src/components/ui/skeleton.tsx')
    expect(skeletonShim).toContain("from '../../../packages/host/src/ui/surface-content'")
    expect(skeletonShim).not.toContain('@base-ui/react')

    const [privateUi, publicUi, legacySkeleton] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../src/components/ui/skeleton'),
    ])

    expect(publicUi.Avatar).toBe(privateUi.Avatar)
    expect(publicUi.Card).toBe(privateUi.Card)
    expect(publicUi.Separator).toBe(privateUi.Separator)
    expect(publicUi.Skeleton).toBe(privateUi.Skeleton)
    expect(publicUi.Collapsible).toBe(privateUi.Collapsible)
    expect(legacySkeleton.Skeleton).toBe(privateUi.Skeleton)
  })
})
