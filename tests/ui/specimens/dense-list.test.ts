import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

describe('dense list and data direction specimens', () => {
  it('approves Product Character with one contextual compact-professional density', () => {
    const metadata = JSON.parse(read('design-system/specimens/visual-direction-candidates.json')) as {
      status: string
      selectedDirection: string | null
      reviewRequired: boolean
      approvedAt: string
      decision: {
        canonicalDensity: {
          id: string
          mode: string
          denseContexts: string[]
          tokens: Record<string, string>
        }
        rejectedDefault: { id: string; reason: string }
      }
      directions: Array<{ id: string; typography: string; disposition: string; tokens: Record<string, string> }>
    }

    expect(metadata.status).toBe('approved')
    expect(metadata.selectedDirection).toBe('product-character')
    expect(metadata.reviewRequired).toBe(false)
    expect(metadata.approvedAt).toBe('2026-07-18')
    expect(metadata.decision.canonicalDensity).toMatchObject({
      id: 'compact-professional',
      mode: 'single-contextual',
      denseContexts: ['tables', 'repeated-rows', 'operational-data'],
      tokens: {
        itemGap: 'var(--bakin-layout-gap-dense)',
        rowMinHeight: 'var(--bakin-layout-size-row-dense)',
      },
    })
    expect(metadata.decision.rejectedDefault.id).toBe('operational-neutral')
    expect(metadata.decision.rejectedDefault.reason).toContain('global default')
    expect(metadata.directions.map((direction) => direction.id)).toEqual([
      'operational-neutral',
      'product-character',
    ])
    expect(metadata.directions.map((direction) => direction.disposition)).toEqual([
      'density-reference',
      'selected-default',
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
    expect(candidateUi).toContain('directionConfig.selectedDirection')
    expect(candidateUi).toContain('Selected default.')
    expect(candidateUi).toContain('Compact-density evidence only.')
    expect(candidateUi).not.toContain('Candidate, not selected.')
  })

  it('records the approved direction and rejected global alternative in maintained knowledge', () => {
    const knowledge = read('.claude/knowledge/design-system.md')
    const styleGuide = read('.claude/knowledge/style-guide.md')
    const sharedPatterns = read('.claude/knowledge/shared-ui-patterns.md')
    const uiPatterns = read('.claude/knowledge/ui-patterns.md')

    expect(knowledge).toContain('Approved visual direction (2026-07-18)')
    expect(knowledge).toContain('Product Character')
    expect(knowledge).toContain('Operational Neutral was rejected as the global default')
    expect(knowledge).toMatch(/not a\s+user-selectable density mode/)
    expect(styleGuide).toContain('Product Character is the approved default')
    expect(styleGuide).toContain('Space Grotesk')
    expect(styleGuide).toContain('JetBrains Mono')
    for (const legacyGuidance of [sharedPatterns, uiPatterns]) {
      expect(legacyGuidance).toContain('Visual-authoring status (2026-07-18)')
      expect(legacyGuidance).toContain('Product Character')
      expect(legacyGuidance).toContain('supersede')
    }
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

  it('keeps the operational header scannable when text is enlarged', () => {
    const story = read('storybook/internal/specimens/dense-list.stories.tsx')

    expect(story).toContain('bakin-dense-header__utility')
    expect(story).toContain('<h2>Coordinate active work</h2>')
    expect(story).toContain('Filters persist in the URL under the existing routing contract.')
    expect(story).toContain('className="bakin-dense-filter-bar"')
    expect(story).toContain('className="bakin-dense-filter-label">View</span>')
    expect(story).toContain('<Inline role="group" aria-label="Task filters">')
    expect(story).not.toContain('without losing operational context')
    expect(story).not.toContain('Search tasks and assets')
  })
})
