import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const PRIMITIVES = ['popover', 'dropdown-menu', 'tooltip', 'command'] as const

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

describe('anchored overlay primitive ownership', () => {
  it('owns every anchored overlay in the private UI package', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')
    for (const primitive of PRIMITIVES) {
      expect(privateIndex).toContain(`from './primitives/${primitive}'`)
      const implementation = readRepoFile(`packages/ui/src/primitives/${primitive}.tsx`)
      expect(implementation).not.toContain("from '@/")
      expect(implementation).not.toContain('@makinbakin/sdk')
      expect(implementation).not.toContain('lucide-react')
    }
  })

  it('shares the private option presentation without exporting its class contract', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    expect(readRepoFile('packages/ui/src/primitives/dropdown-menu.tsx')).toContain("from './option-list'")
    expect(readRepoFile('packages/ui/src/primitives/command.tsx')).toContain("from './option-list'")
    expect(privateIndex).not.toContain("from './primitives/option-list'")
    expect(sdkSource).not.toContain('optionItemClasses')
  })

  it('routes the SDK to one implementation; deleted legacy shims stay gone', async () => {
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    const hostBridge = readRepoFile('packages/host/src/ui/anchored-overlays.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    // P-final: the legacy shims were deleted with the frozen barrel, except
    // `tooltip`, which the host provider still reaches via `@/components/ui/tooltip`.
    for (const primitive of ['popover', 'dropdown-menu', 'command']) {
      expect(existsSync(join(REPO_ROOT, `src/components/ui/${primitive}.tsx`))).toBe(false)
    }
    expect(readRepoFile('src/components/ui/tooltip.tsx')).toContain("from '../../../packages/host/src/ui/anchored-overlays'")

    const [privateUi, publicUi, legacyTooltip] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../src/components/ui/tooltip'),
    ])
    expect(publicUi.PopoverContent).toBe(privateUi.PopoverContent)
    expect(publicUi.DropdownMenuItem).toBe(privateUi.DropdownMenuItem)
    expect(publicUi.TooltipContent).toBe(privateUi.TooltipContent)
    expect(publicUi.CommandItem).toBe(privateUi.CommandItem)
    expect(legacyTooltip.TooltipProvider).toBe(privateUi.TooltipProvider)
  })
})
