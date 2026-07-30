/**
 * Kit-growth gate (storybook-refit T1.4, decision D9).
 *
 * Pure scanner over temp fixture roots — imports only the checker script,
 * no app modules, no content-dir reachable.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  checkKitGrowth,
  collectUndemonstrated,
  generateKitGrowth,
  supportedComponentExports,
} from '../../../scripts/ui/kit-growth'

const tempRoots: string[] = []

function makeRoot(values: string[], frozenValues: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-kit-growth-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'storybook/public'), { recursive: true })
  mkdirSync(join(root, 'storybook/support'), { recursive: true })
  mkdirSync(join(root, 'design-system'), { recursive: true })
  writeFileSync(join(root, 'design-system/public-api.json'), JSON.stringify({
    entrypoints: [
      { specifier: '@makinbakin/sdk/ui', status: 'supported-prerelease', values },
      { specifier: '@makinbakin/sdk/components', status: 'migration-only-frozen', values: frozenValues },
    ],
  }))
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('kit-growth gate', () => {
  it('scopes to component-shaped exports of supported entrypoints only', () => {
    const root = makeRoot(['Button', 'buttonVariants', 'CHART_MAX_SERIES', 'useThing'], ['LegacyThing'])
    expect([...supportedComponentExports(root).keys()]).toEqual(['Button'])
  })

  it('a story import demonstrates the export; absence fails in absolute mode', () => {
    const root = makeRoot(['Button', 'Badge'])
    writeFileSync(join(root, 'storybook/public/button.stories.tsx'), [
      "import { Button } from '@makinbakin/sdk/ui'",
      "export default { title: 'Primitives/Button', tags: ['public'] }",
    ].join('\n'))

    expect(collectUndemonstrated(root)).toEqual(['@makinbakin/sdk/ui :: Badge'])
    const errors = checkKitGrowth(root)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('Badge')
    expect(errors[0]).toContain('absolute mode')
  })

  it('grandfathers recorded gaps but fails a NEW undemonstrated export', () => {
    const root = makeRoot(['Button', 'Badge'])
    writeFileSync(join(root, 'storybook/public/button.stories.tsx'), [
      "import { Button } from '@makinbakin/sdk/ui'",
      "export default { title: 'Primitives/Button', tags: ['public'] }",
    ].join('\n'))
    generateKitGrowth(root)
    expect(checkKitGrowth(root)).toEqual([])

    // Seed a brand-new export without a story — the gate must bite.
    writeFileSync(join(root, 'design-system/public-api.json'), JSON.stringify({
      entrypoints: [
        { specifier: '@makinbakin/sdk/ui', status: 'supported-prerelease', values: ['Button', 'Badge', 'Carousel'] },
      ],
    }))
    const errors = checkKitGrowth(root)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('Carousel')
  })

  it('renamed imports still demonstrate the original export name', () => {
    const root = makeRoot(['Button'])
    writeFileSync(join(root, 'storybook/support/index.tsx'), [
      "import { Button as ActionButton } from '@makinbakin/sdk/ui'",
      'export const stage = ActionButton',
    ].join('\n'))
    expect(collectUndemonstrated(root)).toEqual([])
  })
})
