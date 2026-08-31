/**
 * Story-compliance gate + ratchet (storybook-refit T1.3).
 *
 * Pure scanner over temp fixture roots — imports only the checker script,
 * no app modules, no content-dir reachable.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  checkStoryCompliance,
  collectStoryCompliance,
  generateStoryCompliance,
  storyTitleSlug,
} from '../../../scripts/ui/story-compliance'

const tempRoots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-story-compliance-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'storybook/public'), { recursive: true })
  mkdirSync(join(root, 'tests/ui/visual'), { recursive: true })
  mkdirSync(join(root, 'design-system'), { recursive: true })
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const COMPLIANT_STORY = `
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Button } from '@makinbakin/sdk/ui'

const meta = {
  title: 'Primitives/Button',
  tags: ['public'],
  parameters: {
    bakinCoverage: ['desktop', 'mobile-320'],
    docs: { description: { component: 'One action, one button.' } },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  render: () => <Button variant="primary">Continue</Button>,
  argTypes: { variant: { control: 'select', options: ['primary', 'secondary'] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeVisible()
  },
} satisfies Story
`

function writeStory(root: string, relativePath: string, contents: string): void {
  const path = join(root, 'storybook/public', relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

function writeVisualSpec(root: string, titles: string[]): void {
  const body = titles
    .map((title) => `await page.goto('/iframe.html?id=${storyTitleSlug(title)}--canonical-usage&viewMode=story')`)
    .join('\n')
  writeFileSync(join(root, 'tests/ui/visual/entries.visual.ts'), body)
}

describe('story compliance scanner', () => {
  it('accepts a fully compliant entry', () => {
    const root = makeRoot()
    writeStory(root, 'primitives/button.stories.tsx', COMPLIANT_STORY)
    writeVisualSpec(root, ['Primitives/Button'])
    expect(collectStoryCompliance(root)).toEqual([
      { path: 'storybook/public/primitives/button.stories.tsx', title: 'Primitives/Button', missing: [] },
    ])
  })

  it('reports every missing requirement on a bare entry', () => {
    const root = makeRoot()
    writeStory(root, 'bare.stories.tsx', `
import { Badge } from '@makinbakin/sdk/ui'
export default { title: 'Primitives/Badge', tags: ['public'] }
export const Overview = { render: () => <Badge>New</Badge> }
`)
    const [entry] = collectStoryCompliance(root)
    expect(entry!.missing).toEqual([
      'canonical-usage',
      'coverage-axes',
      'docs-description',
      'play-assertion',
      'visual-baseline',
    ])
  })

  it('fails canonical-usage when the story renders non-SDK scaffolding', () => {
    const root = makeRoot()
    writeStory(root, 'staged.stories.tsx', COMPLIANT_STORY.replace(
      'render: () => <Button variant="primary">Continue</Button>',
      'render: () => <StoryStage eyebrow="x" title="y" description="z"><Button>Continue</Button></StoryStage>',
    ).replace(
      "import { Button } from '@makinbakin/sdk/ui'",
      "import { Button } from '@makinbakin/sdk/ui'\nimport { StoryStage } from '../support'",
    ))
    writeVisualSpec(root, ['Primitives/Button'])
    const [entry] = collectStoryCompliance(root)
    expect(entry!.missing).toEqual(['canonical-usage'])
  })

  it('exempts Recipes entries from canonical-usage only', () => {
    const root = makeRoot()
    writeStory(root, 'recipes/list-page.stories.tsx', `
import { expect } from 'storybook/test'
import { Button } from '@makinbakin/sdk/ui'
function Scene() { return <Button>Go</Button> }
export default {
  title: 'Recipes/List page with drawer detail',
  tags: ['public'],
  parameters: {
    bakinCoverage: ['desktop'],
    docs: { description: { component: 'Assembly proof.' } },
  },
}
export const Assembled = {
  render: () => <Scene />,
  play: async () => { await expect(true).toBe(true) },
}
`)
    writeVisualSpec(root, ['Recipes/List page with drawer detail'])
    const [entry] = collectStoryCompliance(root)
    expect(entry!.missing).toEqual([])
  })

  it('accepts args-only CanonicalUsage when the meta component is SDK-imported', () => {
    const root = makeRoot()
    writeStory(root, 'args-only.stories.tsx', `
import { expect } from 'storybook/test'
import { Button } from '@makinbakin/sdk/ui'
export default {
  title: 'Primitives/Button',
  component: Button,
  tags: ['public'],
  parameters: {
    bakinCoverage: ['desktop'],
    docs: { description: { component: 'Args-driven.' } },
  },
}
export const CanonicalUsage = {
  args: { children: 'Continue' },
  argTypes: { children: { control: 'text' } },
  play: async () => { await expect(true).toBe(true) },
}
`)
    writeVisualSpec(root, ['Primitives/Button'])
    const [entry] = collectStoryCompliance(root)
    expect(entry!.missing).toEqual([])
  })

  it('reports interactive-controls when CanonicalUsage has no argTypes anywhere', () => {
    const root = makeRoot()
    writeStory(root, 'uncontrolled.stories.tsx', COMPLIANT_STORY.replace(
      "  argTypes: { variant: { control: 'select', options: ['primary', 'secondary'] } },\n",
      '',
    ))
    writeVisualSpec(root, ['Primitives/Button'])
    const [entry] = collectStoryCompliance(root)
    expect(entry!.missing).toEqual(['interactive-controls'])
  })

  it('accepts meta-level argTypes for interactive-controls', () => {
    const root = makeRoot()
    writeStory(root, 'meta-controls.stories.tsx', COMPLIANT_STORY.replace(
      "  argTypes: { variant: { control: 'select', options: ['primary', 'secondary'] } },\n",
      '',
    ).replace(
      "  tags: ['public'],",
      "  tags: ['public'],\n  argTypes: { variant: { control: 'select', options: ['primary', 'secondary'] } },",
    ))
    writeVisualSpec(root, ['Primitives/Button'])
    const [entry] = collectStoryCompliance(root)
    expect(entry!.missing).toEqual([])
  })
})

describe('story compliance ratchet', () => {
  it('grandfathers recorded gaps, fails fresh ones, absolute without a baseline', () => {
    const root = makeRoot()
    writeStory(root, 'bare.stories.tsx', `
export default { title: 'Primitives/Badge', tags: ['public'] }
export const Overview = {}
`)

    // Absolute mode: no baseline file → every gap is an error.
    const absolute = checkStoryCompliance(root)
    expect(absolute.length).toBeGreaterThan(0)
    expect(absolute[0]).toContain('absolute mode')

    // Recorded baseline grandfathers the same gaps.
    generateStoryCompliance(root)
    expect(checkStoryCompliance(root)).toEqual([])

    // A fresh gap on a NEW file still fails.
    writeStory(root, 'fresh.stories.tsx', `
export default { title: 'Primitives/Fresh', tags: ['public'] }
export const Overview = {}
`)
    const errors = checkStoryCompliance(root)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every((error) => error.includes('fresh.stories.tsx'))).toBe(true)
  })

  it('a fixed entry keeps passing without regeneration (reductions are free)', () => {
    const root = makeRoot()
    writeStory(root, 'button.stories.tsx', `
export default { title: 'Primitives/Button', tags: ['public'] }
export const Overview = {}
`)
    generateStoryCompliance(root)
    writeStory(root, 'button.stories.tsx', COMPLIANT_STORY)
    writeVisualSpec(root, ['Primitives/Button'])
    expect(checkStoryCompliance(root)).toEqual([])
  })
})
