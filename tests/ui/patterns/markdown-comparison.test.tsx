import { describe, expect, it } from 'bun:test'
import { render } from '@testing-library/react'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { compareMarkdownBlocks, parseMarkdown } from '../../../packages/sdk/src/content/markdown-comparison'
import '../../rtl-settle'

describe('whole-document Markdown comparison', () => {
  it('annotates only affected references and preserves managed-section context and safe HTML', () => {
    const before = '[Stable][stable]\n\n<!-- bakin:plan:start -->\n\n[Changed][target]\n\n<!-- bakin:plan:end -->\n\n[stable]: /stable\n[target]: /old\n\n<script>alert(1)</script>'
    const { container, getByRole } = render(<MarkdownContent content={before.replace('/old', '/new')} compareTo={before} />)
    expect(container.querySelectorAll('[data-md-changed-block]')).toHaveLength(1)
    expect(getByRole('link', { name: 'Stable' }).getAttribute('href')).toBe('/stable')
    expect(container.querySelector('[data-bakin-block] a')?.getAttribute('href')).toBe('/new')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('[data-md-removed-blocks]')).toBeNull()
  })

  it('marks changed blocks while preserving list, table, code and reference semantics', () => {
    const before = '# Plan\n\n- old\n  - nested\n\n| Name |\n| --- |\n| old |\n\n```ts\nold()\n```\n\n[Link][target]\n\n[target]: /old'
    const after = before.replaceAll('old', 'new')
    const { container, getByRole } = render(<MarkdownContent content={after} compareTo={before} />)
    expect(container.querySelectorAll('[data-md-changed-block]')).toHaveLength(4)
    expect(container.querySelectorAll('ul')).toHaveLength(2)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelector('pre code')?.textContent).toContain('new()')
    expect(getByRole('link', { name: 'Link' }).getAttribute('href')).toBe('/new')
    expect(container.querySelector('ul > div, table > div, p > div')).toBeNull()
  })

  it('positions deletion markers at the beginning, middle, end and empty document', () => {
    const view = render(<MarkdownContent content={'Keep\n\nEnd'} compareTo={'Removed start\n\nKeep\n\nRemoved middle\n\nEnd\n\nRemoved end'} />)
    expect(view.container.querySelectorAll('[data-md-removed-blocks]')).toHaveLength(3)
    expect(view.container.querySelectorAll('[data-md-changed-block]')).toHaveLength(0)
    view.rerender(<MarkdownContent content="" compareTo="Only removed" />)
    expect(view.container.textContent).toContain('1 block removed')
  })

  it('leaves identical documents unannotated and handles moves conservatively', () => {
    const same = compareMarkdownBlocks(parseMarkdown('One\n\nTwo'), parseMarkdown('One\n\nTwo'))
    expect(same.available).toBe(true)
    expect(same.changed.size).toBe(0)
    const moved = compareMarkdownBlocks(parseMarkdown('One\n\nTwo'), parseMarkdown('Two\n\nOne'))
    expect(moved.changed.size).toBe(1)
    expect([...moved.removedBefore.values()]).toEqual([1])
  })

  it('bounds comparison work and reports unavailable without losing current content', () => {
    const before = Array.from({ length: 1100 }, (_, i) => `Previous ${i}`).join('\n\n')
    const after = Array.from({ length: 1100 }, (_, i) => `Current ${i}`).join('\n\n')
    const result = compareMarkdownBlocks(parseMarkdown(before), parseMarkdown(after))
    expect(result.available).toBe(false)
    expect(result.steps).toBeLessThanOrEqual(1_000_000)
    const { container, getByRole } = render(<MarkdownContent content={after} compareTo={before} />)
    expect(getByRole('status').textContent).toContain('Comparison unavailable')
    expect(container.textContent).toContain('Current 1099')
    expect(container.querySelectorAll('[data-md-changed-block]')).toHaveLength(0)
  })
})
