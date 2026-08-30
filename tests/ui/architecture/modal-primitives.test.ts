import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
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

    for (const primitive of PRIMITIVES) {
      const shim = readRepoFile(`src/components/ui/${primitive}.tsx`)
      expect(shim).toContain("from '../../../packages/host/src/ui/modals'")
      expect(shim).not.toContain('@base-ui/react')
    }

    const [privateUi, publicUi, legacyDialog, legacySheet] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../src/components/ui/dialog'),
      import('../../../src/components/ui/sheet'),
    ])

    expect(publicUi.Dialog).toBe(privateUi.Dialog)
    expect(publicUi.DialogContent).toBe(privateUi.DialogContent)
    expect(publicUi.Sheet).toBe(privateUi.Sheet)
    expect(publicUi.SheetContent).toBe(privateUi.SheetContent)
    expect(legacyDialog.DialogTitle).toBe(privateUi.DialogTitle)
    expect(legacySheet.SheetDescription).toBe(privateUi.SheetDescription)
  })

  it('keeps shared modal state private and keeps Drawer on canonical primitives', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    expect(privateIndex).not.toContain("from './primitives/modal-context'")
    expect(sdkSource).not.toContain('ModalBusyProvider')

    const drawer = readRepoFile('src/components/drawer.tsx')
    expect(drawer).toContain("from '@/components/ui/sheet'")
    // The dirty-exit decision is the kit pattern, not a hand-built Dialog.
    expect(drawer).toContain('UnsavedChangesDialog')
    expect(drawer).toContain("from '@/components/ui/dialog'")
    expect(drawer).not.toMatch(/from '@bakin\/ui/)
    expect(drawer).not.toContain('<button')
  })
})
