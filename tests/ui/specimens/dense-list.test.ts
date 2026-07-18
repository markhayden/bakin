import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

describe('dense list and data direction specimens', () => {
  it('defines two provisional visual directions through candidate tokens', () => {
    const metadata = JSON.parse(read('design-system/specimens/visual-direction-candidates.json')) as {
      status: string
      selectedDirection: string | null
      reviewRequired: boolean
      directions: Array<{ id: string; typography: string; tokens: Record<string, string> }>
    }

    expect(metadata.status).toBe('candidate')
    expect(metadata.selectedDirection).toBeNull()
    expect(metadata.reviewRequired).toBe(true)
    expect(metadata.directions.map((direction) => direction.id)).toEqual([
      'operational-neutral',
      'product-character',
    ])
    for (const direction of metadata.directions) {
      expect(direction.typography).toBe(direction.id)
      expect(Object.keys(direction.tokens)).toEqual(expect.arrayContaining([
        'fontSans',
        'fontMono',
        'pageGap',
        'sectionGap',
        'itemGap',
        'surfaceRadius',
        'controlRadius',
        'pageTitleSize',
        'bodySize',
        'metaSize',
        'controlHeight',
        'rowMinHeight',
        'overlayShadow',
      ]))
    }
  })

  it('prototypes the proposed public composition vocabulary without raw palette values', () => {
    const candidateUi = read('storybook/internal/specimens/candidate-ui.tsx')

    for (const api of [
      'PageShell',
      'Stack',
      'Inline',
      'Grid',
      'Section',
      'BoundedOverflow',
      'Action',
      'Status',
      'SystemState',
    ]) {
      expect(candidateUi).toContain(`export function ${api}`)
    }
    expect(candidateUi).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    expect(candidateUi).toContain('var(--bakin-color-canvas-default)')
    expect(candidateUi).toContain('var(--bakin-color-focus-ring)')
    expect(candidateUi).toContain('visual-direction-candidates.json')
  })

  it('covers realistic dense content, state recovery, interaction, and reflow', () => {
    const story = read('storybook/internal/specimens/dense-list.stories.tsx')

    expect(story).toContain("tags: ['internal']")
    for (const exportName of ['SideBySide', 'SystemStates', 'TextAt200Percent']) {
      expect(story).toContain(`export const ${exportName}`)
    }
    for (const api of ['PageShell', 'Stack', 'Inline', 'Grid', 'Section', 'BoundedOverflow', 'Action', 'Status', 'SystemState']) {
      expect(story).toMatch(new RegExp(`<${api}(?:\\s|>)`))
    }
    for (const fixture of [
      '42 active tasks',
      'Assemble launch cut for social channels',
      'asset:campaign/spring-hero-final-v18.webp',
      'Search index enrichment queue',
      'agent:patch:explicit:sess-01JZ9T4P6KE7',
    ]) {
      expect(story).toContain(fixture)
    }
    for (const state of ['loading', 'initial-empty', 'filtered-no-results', 'error', 'permission-denied', 'success']) {
      expect(story).toContain(`kind="${state}"`)
    }
    expect(story).toContain('aria-pressed={activeFilter === filter}')
    expect(story).toContain("<style>{'html { font-size: 200%; }'}</style>")
    for (const coverage of ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'system-states']) {
      expect(story).toContain(`'${coverage}'`)
    }
    expect(story).not.toContain('NestedCard')
  })
})
