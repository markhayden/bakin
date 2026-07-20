import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
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

  it('routes SDK and legacy paths to one implementation', async () => {
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    const hostBridge = readRepoFile('packages/host/src/ui/anchored-overlays.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    for (const primitive of PRIMITIVES) {
      const shim = readRepoFile(`src/components/ui/${primitive}.tsx`)
      expect(shim).toContain("from '../../../packages/host/src/ui/anchored-overlays'")
    }

    const [privateUi, publicUi, legacyPopover, legacyMenu] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../src/components/ui/popover'),
      import('../../../src/components/ui/dropdown-menu'),
    ])
    expect(publicUi.PopoverContent).toBe(privateUi.PopoverContent)
    expect(publicUi.DropdownMenuItem).toBe(privateUi.DropdownMenuItem)
    expect(publicUi.TooltipContent).toBe(privateUi.TooltipContent)
    expect(publicUi.CommandItem).toBe(privateUi.CommandItem)
    expect(legacyPopover.Popover).toBe(privateUi.Popover)
    expect(legacyMenu.DropdownMenuContent).toBe(privateUi.DropdownMenuContent)
  })
})
