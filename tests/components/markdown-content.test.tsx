// @vitest-environment jsdom
/**
 * MarkdownContent — the single markdown renderer. Pins the T1.1 media/code
 * upgrades: syntax-highlighted fenced blocks with a language label + copy
 * button, lazy images with a click-to-lightbox overlay, video rendering for
 * video-extension URLs, safe external links, and the pre-existing bakin
 * marker + GFM behaviors.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure client rendering — content-dir mocks are belt-and-braces per the
// isolation rules (the components barrel transitively reaches app modules).
const testDir = join(tmpdir(), `bakin-test-markdown-content-${Date.now()}`)
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import '../rtl-settle'

import { MarkdownContent } from '@makinbakin/sdk/components'

const CODE_MD = '```typescript\nconst x: number = 1\n```'

describe('MarkdownContent code blocks', () => {
  it('syntax-highlights fenced code and shows a language label', async () => {
    const { container } = render(<MarkdownContent content={CODE_MD} />)
    const code = container.querySelector('pre code')
    expect(code).not.toBeNull()
    expect(code!.className).toContain('hljs')
    // highlight.js wraps tokens in hljs-* spans
    expect(container.querySelector('pre code span[class*="hljs-"]')).not.toBeNull()
    // language label visible in the block header
    expect(container.textContent).toContain('typescript')
  })

  it('copy button writes the code text to the clipboard', async () => {
    const writes: string[] = []
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: (t: string) => (writes.push(t), Promise.resolve()) },
      configurable: true,
    })
    const { container } = render(<MarkdownContent content={CODE_MD} />)
    const copy = container.querySelector('button[data-md-copy]')
    expect(copy).not.toBeNull()
    await act(async () => { fireEvent.click(copy!) })
    expect(writes).toEqual(['const x: number = 1'])
  })

  it('inline code gets no header chrome or copy button', async () => {
    const { container } = render(<MarkdownContent content={'use `bun test` here'} />)
    expect(container.querySelector('code')).not.toBeNull()
    expect(container.querySelector('button[data-md-copy]')).toBeNull()
  })
})

describe('MarkdownContent media', () => {
  it('renders images lazy and opens a lightbox on click', async () => {
    const { container } = render(
      <MarkdownContent content={'![a chart](/api/assets/a1/thumb)'} />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('loading')).toBe('lazy')
    expect(container.querySelector('[data-md-lightbox]')).toBeNull()

    fireEvent.click(img!)
    const lightbox = document.querySelector('[data-md-lightbox]')
    expect(lightbox).not.toBeNull()
    // full-size image inside the overlay
    expect(lightbox!.querySelector('img')?.getAttribute('src')).toBe('/api/assets/a1/thumb')

    fireEvent.click(lightbox!)
    expect(document.querySelector('[data-md-lightbox]')).toBeNull()
  })

  it('renders video-extension image URLs as a video element', async () => {
    const { container } = render(
      <MarkdownContent content={'![demo](/api/assets/a1/export/demo.mp4)'} />,
    )
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video!.getAttribute('src')).toBe('/api/assets/a1/export/demo.mp4')
    expect(video!.hasAttribute('controls')).toBe(true)
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('MarkdownContent links', () => {
  it('external links open in a new tab with noopener; internal links do not', async () => {
    const { container } = render(
      <MarkdownContent content={'[ext](https://example.com) and [int](/tasks)'} />,
    )
    const anchors = Array.from(container.querySelectorAll('a'))
    const ext = anchors.find((a) => a.getAttribute('href') === 'https://example.com')
    const int = anchors.find((a) => a.getAttribute('href') === '/tasks')
    expect(ext?.getAttribute('target')).toBe('_blank')
    expect(ext?.getAttribute('rel')).toContain('noopener')
    expect(ext?.getAttribute('rel')).toContain('noreferrer')
    expect(int?.getAttribute('target')).toBeNull()
  })
})

describe('MarkdownContent pre-existing behaviors', () => {
  it('still renders bakin marker blocks in the managed container', async () => {
    const { container } = render(
      <MarkdownContent
        content={'before\n<!-- bakin:tools:start -->\nmanaged body\n<!-- bakin:tools:end -->\nafter'}
      />,
    )
    const block = container.querySelector('[data-bakin-block="tools"]')
    expect(block).not.toBeNull()
    expect(block!.textContent).toContain('managed body')
  })

  it('still renders GFM tables', async () => {
    const { container } = render(
      <MarkdownContent content={'| a | b |\n| - | - |\n| 1 | 2 |'} />,
    )
    expect(container.querySelector('table')).not.toBeNull()
    cleanup()
  })
})
