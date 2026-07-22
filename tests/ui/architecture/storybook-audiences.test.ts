import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertPublicStoryBoundary,
  assertSafeStorybookOutput,
  canonicalStoryIndex,
  storyGlobsForAudience,
  validatePublicStoryBoundary,
} from '../../../scripts/ui/build-storybook'

const tempRoots: string[] = []

function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-storybook-audience-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'storybook/public'), { recursive: true })
  mkdirSync(join(root, 'storybook/fixtures'), { recursive: true })
  mkdirSync(join(root, 'packages/host/src'), { recursive: true })
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Storybook catalog audiences', () => {
  it('mechanically excludes internal stories from the public build', () => {
    expect(storyGlobsForAudience('public')).toEqual([
      '../storybook/public/**/*.stories.@(ts|tsx)',
    ])
    expect(storyGlobsForAudience('maintainer')).toEqual([
      '../storybook/public/**/*.stories.@(ts|tsx)',
      '../storybook/internal/**/*.stories.@(ts|tsx)',
    ])
  })

  it('accepts public stories whose complete local graph uses only public SDK paths', () => {
    const root = makeFixtureRoot()
    writeFileSync(join(root, 'storybook/public/button.stories.tsx'), [
      "import type { Meta } from '@storybook/react-vite'",
      "import { Button } from '@makinbakin/sdk/ui'",
      "import { label } from '../fixtures/labels'",
      'export default { title: label, component: Button, tags: [\'public\'] } satisfies Meta<typeof Button>',
    ].join('\n'))
    writeFileSync(join(root, 'storybook/fixtures/labels.ts'), "export const label = 'Foundation/Button'\n")

    expect(validatePublicStoryBoundary(root)).toEqual([])
  })

  it('fails on direct and transitive imports of Bakin internals', () => {
    const root = makeFixtureRoot()
    writeFileSync(join(root, 'storybook/public/direct.stories.tsx'), [
      "import { Button } from '@/components/ui/button'",
      "export default { title: 'Direct', component: Button, tags: ['public'] }",
    ].join('\n'))
    writeFileSync(join(root, 'storybook/public/transitive.stories.tsx'), [
      "import { fixture } from '../fixtures/private-fixture'",
      "export default { title: 'Transitive', tags: ['public'] }",
      'export const Default = { args: fixture }',
    ].join('\n'))
    writeFileSync(
      join(root, 'storybook/fixtures/private-fixture.ts'),
      "export { fixture } from '../../packages/host/src/private-fixture'\n",
    )
    writeFileSync(join(root, 'packages/host/src/private-fixture.ts'), 'export const fixture = {}\n')

    expect(validatePublicStoryBoundary(root)).toEqual([
      'storybook/fixtures/private-fixture.ts:1 public catalog cannot import ../../packages/host/src/private-fixture (resolves outside storybook/public and storybook/fixtures)',
      "storybook/public/direct.stories.tsx:1 public catalog cannot import @/components/ui/button; use @makinbakin/sdk/*",
    ])
  })

  it('requires explicit public tags and rejects the SDK internal entrypoint', () => {
    const root = makeFixtureRoot()
    writeFileSync(join(root, 'storybook/public/unsafe.stories.tsx'), [
      "import { getPluginRoutes } from '@makinbakin/sdk/internal'",
      "export default { title: 'Unsafe' }",
      'export const Default = { args: { getPluginRoutes } }',
    ].join('\n'))

    expect(validatePublicStoryBoundary(root)).toEqual([
      'storybook/public/unsafe.stories.tsx public story must declare the static tag public',
      'storybook/public/unsafe.stories.tsx:1 public catalog cannot import @makinbakin/sdk/internal; use a supported @makinbakin/sdk/* entrypoint',
    ])
    expect(() => assertPublicStoryBoundary(root)).toThrow('Public Storybook boundary failed')
  })

  it('reserves public stories for focused public SDK entrypoints', () => {
    const root = makeFixtureRoot()
    writeFileSync(join(root, 'storybook/public/focused.stories.tsx'), [
      "import * as Layout from '@makinbakin/sdk/layout'",
      "import * as Patterns from '@makinbakin/sdk/patterns'",
      "import * as Charts from '@makinbakin/sdk/charts'",
      "import * as Conversation from '@makinbakin/sdk/conversation'",
      "import * as Content from '@makinbakin/sdk/content'",
      "import * as Navigation from '@makinbakin/sdk/navigation'",
      "import * as TestingUi from '@makinbakin/sdk/testing/ui'",
      "export default { title: 'Focused', tags: ['public'] }",
      'export const Default = { args: { Layout, Patterns, Charts, Conversation, Content, Navigation, TestingUi } }',
    ].join('\n'))
    expect(validatePublicStoryBoundary(root)).toEqual([])

    writeFileSync(join(root, 'storybook/public/legacy.stories.tsx'), [
      "import { PluginHeader } from '@makinbakin/sdk/components'",
      "export default { title: 'Legacy', component: PluginHeader, tags: ['public'] }",
    ].join('\n'))
    expect(validatePublicStoryBoundary(root)).toEqual([
      'storybook/public/legacy.stories.tsx:1 public catalog cannot import @makinbakin/sdk/components; use a focused public SDK entrypoint',
    ])
  })

  it('does not mistake story args or nested objects for the meta public tag', () => {
    const root = makeFixtureRoot()
    writeFileSync(join(root, 'storybook/public/misleading.stories.tsx'), [
      "const args = { tags: ['public'] }",
      "const meta = { title: 'Misleading' }",
      'export default meta',
      'export const Default = { args }',
    ].join('\n'))

    expect(validatePublicStoryBoundary(root)).toEqual([
      'storybook/public/misleading.stories.tsx public story must declare the static tag public',
    ])
  })

  it('rejects computed imports and dangerous build output directories', () => {
    const root = makeFixtureRoot()
    writeFileSync(join(root, 'storybook/public/computed.stories.tsx'), [
      "const modulePath = '@/components/ui/button'",
      "export default { title: 'Computed', tags: ['public'] }",
      'export const Default = { load: () => import(modulePath) }',
    ].join('\n'))

    expect(validatePublicStoryBoundary(root)).toEqual([
      'storybook/public/computed.stories.tsx:3 public catalog cannot use a computed import or require specifier',
    ])
    expect(() => assertSafeStorybookOutput('/')).toThrow('Refusing unsafe Storybook output directory')
    expect(() => assertSafeStorybookOutput(root)).not.toThrow()
  })

  it('canonicalizes story indices independent of object insertion order', () => {
    const left = { v: 5, entries: { beta: { name: 'B', id: 'beta' }, alpha: { id: 'alpha', name: 'A' } } }
    const right = { entries: { alpha: { name: 'A', id: 'alpha' }, beta: { id: 'beta', name: 'B' } }, v: 5 }

    expect(canonicalStoryIndex(left)).toBe(canonicalStoryIndex(right))
  })
})
