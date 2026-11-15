/**
 * Links inside rendered markdown: an app route navigates in-app (no full
 * reload), a server endpoint stays an ordinary link, an external URL opens
 * in a new tab.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render } from '@testing-library/react'
import '../../rtl-settle'
import * as realRouter from '../../../packages/sdk/src/navigation/router'

const push = mock((_to: string) => {})
mock.module('../../../packages/sdk/src/navigation/router', () => ({
  ...realRouter,
  useRouter: () => ({ push, replace: mock(), back: mock() }),
}))

import { MarkdownContent } from '@makinbakin/sdk/content'

beforeEach(() => push.mockClear())

describe('markdown links', () => {
  it('an app route navigates through the client router', () => {
    const { getByRole } = render(<MarkdownContent content="Open [the project](/projects/p-1) or [the task](/tasks?taskId=t-1)." />)
    const link = getByRole('link', { name: 'the project' })
    expect(link.getAttribute('href')).toBe('/projects/p-1')
    expect(link.getAttribute('target')).toBeNull()
    expect(fireEvent.click(link)).toBe(false) // default prevented: no document load
    expect(push).toHaveBeenCalledWith('/projects/p-1')

    fireEvent.click(getByRole('link', { name: 'the task' }))
    expect(push).toHaveBeenLastCalledWith('/tasks?taskId=t-1')
  })

  it('a server endpoint is an ordinary link, never a client route', () => {
    const { getByRole } = render(<MarkdownContent content="Download [the file](/api/assets/20261114-brief)." />)
    const link = getByRole('link', { name: 'the file' })
    expect(link.getAttribute('href')).toBe('/api/assets/20261114-brief')
    fireEvent.click(link)
    expect(push).not.toHaveBeenCalled()
  })

  it('an in-page anchor and an external URL are left to the browser', () => {
    const { getByRole } = render(<MarkdownContent content="See [below](#details) or [the docs](https://example.com/docs)." />)
    fireEvent.click(getByRole('link', { name: 'below' }))
    expect(push).not.toHaveBeenCalled()
    expect(getByRole('link', { name: 'the docs' }).getAttribute('target')).toBe('_blank')
  })
})
