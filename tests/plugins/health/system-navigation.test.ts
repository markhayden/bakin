// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { focusSystemElement } from '../../../plugins/health/components/system-navigation'

const originalMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = originalMatchMedia
  document.body.replaceChildren()
})

function setReducedMotion(matches: boolean): void {
  window.matchMedia = mock(() => ({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: mock(),
    removeListener: mock(),
    addEventListener: mock(),
    removeEventListener: mock(),
    dispatchEvent: mock(() => false),
  })) as unknown as typeof window.matchMedia
}

describe('focusSystemElement', () => {
  it('focuses without a preliminary jump and smooth-scrolls to the requested edge', () => {
    setReducedMotion(false)
    const element = document.createElement('button')
    const scrollIntoView = mock()
    element.scrollIntoView = scrollIntoView
    document.body.append(element)

    focusSystemElement(element, { block: 'start' })

    expect(document.activeElement).toBe(element)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('uses an immediate scroll when reduced motion is requested', () => {
    setReducedMotion(true)
    const element = document.createElement('button')
    const scrollIntoView = mock()
    element.scrollIntoView = scrollIntoView
    document.body.append(element)

    focusSystemElement(element, { block: 'center' })

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
  })
})
