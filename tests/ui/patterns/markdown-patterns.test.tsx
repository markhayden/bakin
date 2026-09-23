// @vitest-environment jsdom
import { describe, expect, it } from 'bun:test'
import { fireEvent, render, waitFor } from '@testing-library/react'

import { MarkdownContent, MarkdownEditor } from '@makinbakin/sdk/content'
import '../../rtl-settle'

const CODE = '```typescript\nconst ready: boolean = true\n```'

describe('focused markdown content', () => {
  it('resolves references across managed sections without splitting document context', () => {
    const { container, getByRole } = render(<MarkdownContent content={'[Outside][inside]\n\n<!-- bakin:plan:start -->\n[Inside][outside]\n\n[inside]: /projects/inside\n<!-- bakin:plan:end -->\n\n[outside]: /projects/outside'} />)
    expect(getByRole('link', { name: 'Outside' }).getAttribute('href')).toBe('/projects/inside')
    expect(getByRole('link', { name: 'Inside' }).getAttribute('href')).toBe('/projects/outside')
    expect(container.querySelector('[data-bakin-block="plan"]')).not.toBeNull()
  })

  it('treats marker text inside fenced code as literal code', () => {
    const { container } = render(<MarkdownContent content={'```html\n<!-- bakin:example:start -->\n<p>literal</p>\n<!-- bakin:example:end -->\n```'} />)
    expect(container.querySelector('[data-bakin-block]')).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('<!-- bakin:example:start -->')
  })

  it('keeps managed lists and tables in legal flow containers', () => {
    const { container } = render(<MarkdownContent content={'<!-- bakin:plan:start -->\n\n- first\n  - nested\n- second\n\n| name | state |\n| --- | --- |\n| project | ready |\n\n<!-- bakin:plan:end -->'} />)
    expect(container.querySelectorAll('[data-bakin-block] ul')).toHaveLength(2)
    expect(container.querySelector('[data-bakin-block] table')).not.toBeNull()
    expect(container.querySelector('p section, ul > section, table > section')).toBeNull()
  })

  it('renders GFM and copyable highlighted code with canonical chrome', async () => {
    const writes: string[] = []
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: (value: string) => (writes.push(value), Promise.resolve()) },
      configurable: true,
    })

    const { container, getByRole } = render(
      <MarkdownContent content={`${CODE}\n\n| state | owner |\n| - | - |\n| ready | release |`} />,
    )

    expect(container.querySelector('pre code')?.className).toContain('hljs')
    expect(container.querySelector('[data-md-table] table')).not.toBeNull()
    const copy = getByRole('button', { name: 'Copy code' })
    fireEvent.click(copy)
    expect(writes).toEqual(['const ready: boolean = true'])
    await waitFor(() => expect(copy.getAttribute('aria-label')).toBe('Copy code complete'))
  })

  it('keeps external links safe and delegates internal navigation when supplied', () => {
    const { container } = render(
      <MarkdownContent
        content="[external](https://example.com) [protocol relative](//example.com/docs) [task](/tasks/42) [unsafe](javascript:alert(1))"
        renderInternalLink={({ href, children }) => (
          <a href={href} data-plugin-link="">{children}</a>
        )}
      />,
    )

    const external = container.querySelector('a[href="https://example.com"]')
    expect(external?.getAttribute('target')).toBe('_blank')
    expect(external?.getAttribute('rel')).toContain('noopener')
    expect(container.querySelector('a[href="//example.com/docs"]')?.getAttribute('target')).toBe('_blank')
    expect(container.querySelector('[data-plugin-link][href="/tasks/42"]')).not.toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it('opens image media through a named keyboard-operable dialog', () => {
    const { getByRole } = render(
      <MarkdownContent content="![Release chart](/api/assets/release-chart/thumb)" />,
    )

    fireEvent.click(getByRole('button', { name: 'Open Release chart preview' }))
    expect(getByRole('dialog', { name: 'Release chart preview' })).not.toBeNull()
    expect(getByRole('button', { name: 'Close image preview' })).not.toBeNull()
  })

  it('renders template-placeholder image URLs as text, never as doomed requests', () => {
    // Agent-authored markdown carries placeholders like <assetId>; angle
    // brackets are never valid in a URL and the request 404s with console
    // noise (2026-09-21 finding). The reference stays legible as code.
    const { container, queryByRole, getByText } = render(
      <MarkdownContent content="![Taco](/api/assets/<assetId>)" />,
    )

    expect(container.querySelector('img')).toBeNull()
    expect(queryByRole('button', { name: /preview/i })).toBeNull()
    expect(getByText(/<assetId>/)).not.toBeNull()
  })
})

describe('focused markdown editor', () => {
  it('requires a visible integration label and uses semantic height choices', () => {
    const changes: string[] = []
    const { getByRole } = render(
      <MarkdownEditor
        label="Release notes"
        content="Initial"
        mode="edit"
        height="compact"
        onChange={(content) => changes.push(content)}
      />,
    )

    const editor = getByRole('textbox', { name: 'Release notes' })
    expect(editor.className).toContain('min-h-40')
    fireEvent.change(editor, { target: { value: 'Updated' } })
    expect(changes).toEqual(['Updated'])
  })

  it('normalizes the legacy viewport minimum to a named semantic height', () => {
    const { container, getByRole } = render(
      <MarkdownEditor
        content="Legacy document"
        editing
        minHeight="70vh"
        onChange={() => {}}
      />,
    )

    expect(getByRole('textbox', { name: 'Markdown content' }).className).toContain('bakin-markdown-editor-viewport')
    expect(container.querySelector('[style]')).toBeNull()
  })

  it('formats exact JSON in preview mode and explains empty content', () => {
    const preview = render(
      <MarkdownEditor
        label="Configuration"
        content='{"enabled":true}'
        mode="preview"
        format="json"
        onChange={() => {}}
      />,
    )
    expect(preview.container.textContent).toContain('"enabled": true')

    preview.unmount()
    const empty = render(
      <MarkdownEditor
        label="Configuration"
        content=""
        mode="preview"
        onChange={() => {}}
        placeholder="No configuration recorded"
      />,
    )
    expect(empty.container.textContent).toContain('No configuration recorded')
  })
})
