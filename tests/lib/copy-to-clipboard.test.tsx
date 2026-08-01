// @vitest-environment jsdom
/**
 * copyToClipboard — the tailnet copy bug (2026-07-25): Bakin is served
 * over plain HTTP, where `navigator.clipboard` is UNDEFINED and the old
 * `navigator.clipboard?.writeText(...)` pattern silently no-opped every
 * copy button. The helper must fall back to execCommand('copy') and
 * report honestly whether a copy happened.
 */
import { describe, expect, it, mock, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-copy-clipboard-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { act, fireEvent, render } from '@testing-library/react'
import '../rtl-settle'

import { copyToClipboard } from '../../src/lib/copy-to-clipboard'
import { CopyButton } from '@makinbakin/sdk/conversation'
import { waitUntil } from '../helpers/wait'

type NavigatorWithClipboard = Navigator & { clipboard?: unknown }

const originalClipboard = (navigator as NavigatorWithClipboard).clipboard
const originalExec = document.execCommand

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true })
  document.execCommand = originalExec
})

describe('copyToClipboard', () => {
  it('falls back to execCommand when navigator.clipboard is undefined (plain-HTTP tailnet)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const copied: { value: string | null } = { value: null }
    document.execCommand = ((command: string) => {
      if (command !== 'copy') return false
      copied.value = (document.activeElement as HTMLTextAreaElement | null)?.value ?? null
      return true
    }) as typeof document.execCommand

    await expect(copyToClipboard('how about in california')).resolves.toBe(true)
    expect(copied.value).toBe('how about in california')
    // The off-screen textarea is cleaned up.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('prefers the async Clipboard API when present', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => { written.push(t) } },
      configurable: true,
    })
    await expect(copyToClipboard('secure context')).resolves.toBe(true)
    expect(written).toEqual(['secure context'])
  })

  it('reports false when no path can copy — UIs must not flash a false success check', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = (() => false) as typeof document.execCommand
    await expect(copyToClipboard('nope')).resolves.toBe(false)
  })
})

describe('CopyButton over the fallback path', () => {
  it('copies and shows the success check with navigator.clipboard undefined', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const copied: { value: string | null } = { value: null }
    document.execCommand = ((command: string) => {
      if (command !== 'copy') return false
      copied.value = (document.activeElement as HTMLTextAreaElement | null)?.value ?? null
      return true
    }) as typeof document.execCommand

    const { container, findByLabelText } = render(<CopyButton text="and also oregon" label="Copy message" />)
    await act(async () => { fireEvent.click(await findByLabelText('Copy message')) })
    // The check icon appears only on a REAL copy.
    await waitUntil(() => copied.value === 'and also oregon',
      { label: 'the clipboard write to complete' })
    expect(copied.value).toBe('and also oregon')
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
