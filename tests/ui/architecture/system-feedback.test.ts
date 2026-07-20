import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as PrivateUi from '@bakin/ui'
import * as PublicUi from '@makinbakin/sdk/ui'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')

describe('canonical system-state and feedback ownership', () => {
  it('keeps the implementation inside the private presentation package', () => {
    const files = [
      'packages/ui/src/states/system-state.tsx',
      'packages/ui/src/states/banner.tsx',
      'packages/ui/src/states/toast.tsx',
      'packages/ui/src/states/index.ts',
    ]

    for (const file of files) expect(existsSync(resolve(REPO_ROOT, file))).toBe(true)

    const source = files.map(read).join('\n')
    expect(source).not.toMatch(/from ['"]@\//)
    expect(source).not.toContain('@makinbakin/sdk')
    expect(source).not.toMatch(/src\/components/)
    expect(source).not.toContain('useToastStore')
  })

  it('publishes one presentation implementation through the focused SDK entrypoint', () => {
    expect(PublicUi.SystemState).toBe(PrivateUi.SystemState)
    expect(PublicUi.Banner).toBe(PrivateUi.Banner)
    expect(PublicUi.Toast).toBe(PrivateUi.Toast)
    expect(PublicUi.ToastRegion).toBe(PrivateUi.ToastRegion)

    const sdkSource = read('packages/sdk/src/ui/index.ts')
    expect(sdkSource).toContain('SystemState')
    expect(sdkSource).toContain('ToastRegion')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(read('tests/ui/states/system-feedback.types.tsx')).toContain('A filtered no-results state must expose a reset action.')
  })

  it('keeps the shell toast lifecycle separate from the public presentation contract', () => {
    const toastStore = read('src/hooks/use-toast.ts')
    const hostToaster = read('packages/host/src/components/layout/toaster.tsx')
    const stateSource = read('packages/ui/src/states/toast.tsx')

    expect(toastStore).toContain('useToastStore')
    expect(hostToaster).toContain('useToastStore')
    expect(stateSource).not.toContain('setTimeout')
    expect(stateSource).not.toContain('createPortal')
  })
})
