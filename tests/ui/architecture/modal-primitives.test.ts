import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const PRIMITIVES = ['dialog', 'sheet'] as const

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

describe('modal primitive ownership', () => {
  it('owns dialog, sheet, and shared modal behavior in the private UI package', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')

    for (const primitive of PRIMITIVES) {
      expect(privateIndex).toContain(`from './primitives/${primitive}'`)
      const implementation = readRepoFile(`packages/ui/src/primitives/${primitive}.tsx`)
      expect(implementation).not.toContain("from '@/")
      expect(implementation).not.toContain('@makinbakin/sdk')
      expect(implementation).toContain("from './modal-context'")
    }

    expect(readRepoFile('packages/ui/src/primitives/modal-context.tsx')).toContain('ModalBusyProvider')
  })

  it('routes the public SDK and legacy app paths to one implementation', async () => {
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    const hostBridge = readRepoFile('packages/host/src/ui/modals.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    // #809: the src/components/ui shims are gone; the host bridge is the one legacy path.
    for (const primitive of PRIMITIVES) {
      expect(existsSync(join(REPO_ROOT, `src/components/ui/${primitive}.tsx`))).toBe(false)
    }

    const [privateUi, publicUi, hostBridgeModule] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../packages/host/src/ui/modals'),
    ])

    expect(publicUi.Dialog).toBe(privateUi.Dialog)
    expect(publicUi.DialogContent).toBe(privateUi.DialogContent)
    expect(publicUi.Sheet).toBe(privateUi.Sheet)
    expect(publicUi.SheetContent).toBe(privateUi.SheetContent)
    expect(hostBridgeModule.DialogTitle).toBe(privateUi.DialogTitle)
    expect(hostBridgeModule.SheetDescription).toBe(privateUi.SheetDescription)
  })

  it('keeps shared modal state private and keeps Drawer on canonical primitives', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    expect(privateIndex).not.toContain("from './primitives/modal-context'")
    expect(sdkSource).not.toContain('ModalBusyProvider')

    // #809: the Drawer is a kit pattern on the kit's own primitives, published
    // through the SDK ui entrypoint from @bakin/ui.
    const drawer = readRepoFile('packages/ui/src/patterns/drawer.tsx')
    expect(drawer).toContain("from '../primitives/sheet'")
    // The dirty-exit decision is the kit pattern, not a hand-built Dialog.
    expect(drawer).toContain('UnsavedChangesDialog')
    expect(drawer).toContain("from './unsaved-changes-dialog'")
    expect(drawer).not.toMatch(/from '@\/|from '@makinbakin\/sdk|from '@bakin\/core/)
    expect(drawer).not.toContain('<button')
    expect(sdkSource).toContain("export { Drawer } from '@bakin/ui'")
    expect(existsSync(join(REPO_ROOT, 'src/components/drawer.tsx'))).toBe(false)
  })
})
