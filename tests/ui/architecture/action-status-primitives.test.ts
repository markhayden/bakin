import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const PRIMITIVES = ['alert', 'badge', 'button', 'progress'] as const

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

describe('action and status primitive ownership', () => {
  it('owns each implementation in the private UI package', () => {
    const privateIndex = readRepoFile('packages/ui/src/index.ts')
    const hostStyles = readRepoFile('packages/host/src/globals.css')

    for (const primitive of PRIMITIVES) {
      expect(privateIndex).toContain(`from './primitives/${primitive}'`)
      const implementation = readRepoFile(`packages/ui/src/primitives/${primitive}.tsx`)
      expect(implementation).not.toContain("from '@/")
      expect(implementation).not.toContain('@makinbakin/sdk')
    }
    expect(hostStyles).toContain('@source "../../ui/src/**/*.{ts,tsx}";')
  })

  it('routes the supported SDK contract to one implementation; deleted legacy shims stay gone', async () => {
    const sdkSource = readRepoFile('packages/sdk/src/ui/index.ts')
    const hostBridge = readRepoFile('packages/host/src/ui/action-status.ts')
    expect(sdkSource).toContain("from '@bakin/ui'")
    expect(hostBridge).toContain("from '@bakin/ui'")

    // P-final: the `alert` and `progress` shims were deleted with the frozen
    // barrel; `badge` and `button` remain only as host-internal bridges.
    for (const primitive of ['alert', 'progress']) {
      expect(existsSync(join(REPO_ROOT, `src/components/ui/${primitive}.tsx`))).toBe(false)
    }
    for (const primitive of ['badge', 'button']) {
      expect(existsSync(join(REPO_ROOT, `src/components/ui/${primitive}.tsx`))).toBe(false) // #809
    }

    const [privateUi, publicUi, hostBridgeModule] = await Promise.all([
      import('@bakin/ui'),
      import('@makinbakin/sdk/ui'),
      import('../../../packages/host/src/ui/action-status'),
    ])

    expect(publicUi.Button).toBe(privateUi.Button)
    expect(publicUi.Badge).toBe(privateUi.Badge)
    expect(publicUi.Alert).toBe(privateUi.Alert)
    expect(publicUi.Progress).toBe(privateUi.Progress)
    expect(hostBridgeModule.Button).toBe(privateUi.Button)
    expect(hostBridgeModule.Badge).toBe(privateUi.Badge)
  })
})
