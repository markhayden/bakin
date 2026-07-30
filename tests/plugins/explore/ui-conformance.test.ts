import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../../..')

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('Explore UI conformance', () => {
  it('composes detail drawers from the focused public SDK contracts', () => {
    const contents = source('plugins/explore/components/detail-drawer.tsx')

    expect(contents).not.toContain('@makinbakin/sdk/components')
    expect(contents).toContain("from '@makinbakin/sdk/navigation'")
    expect(contents).toContain("from '@makinbakin/sdk/ui'")
    expect(contents).toContain('<DrawerSection')
  })

  it('uses canonical form controls and keeps package-source logic inside Explore', () => {
    const contents = source('plugins/explore/components/install-dialog.tsx')

    expect(contents).not.toContain('../../../src/')
    expect(contents).not.toMatch(/<select\b/)
    expect(contents).not.toMatch(/<input\s+type="checkbox"/)
    expect(contents).toContain('<Form')
    expect(contents).toContain('<Field')
    expect(contents).toContain('<Checkbox')
    expect(contents).toContain('<Select')
    expect(contents).toContain('<Alert')
    expect(contents).toMatch(/<Dialog[^>]*busy=/)
  })

  it('uses canonical attention feedback and blocks dismissal while consent commits', () => {
    const contents = source('plugins/explore/components/consent-dialog.tsx')

    expect(contents).toMatch(/<Dialog[^>]*busy=/)
    expect(contents).toContain('<Alert')
    expect(contents).toContain('tone="attention"')
    expect(contents).not.toMatch(/amber-\d+/)
  })
})
