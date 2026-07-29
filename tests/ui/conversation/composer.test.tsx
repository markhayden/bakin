// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'

import {
  Composer,
  type ComposerAttachmentItem,
} from '@makinbakin/sdk/conversation'
import '../../rtl-settle'

const textarea = (container: HTMLElement) => container.querySelector('textarea')!

beforeEach(() => {
  cleanup()
  localStorage.clear()
})

describe('focused conversation composer', () => {
  it('sends trimmed text on Enter while preserving newline and IME input', () => {
    const sent: string[] = []
    const { container } = render(<Composer storageKey="send" onSend={(value) => { sent.push(value) }} />)
    const input = textarea(container)

    fireEvent.change(input, { target: { value: '  release note  ' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(sent).toEqual([])

    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sent).toEqual([])
    fireEvent.compositionEnd(input)

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sent).toEqual(['release note'])
    expect(input.value).toBe('')
  })

  it('keeps typing live while busy and only presents stop as an action when abort exists', () => {
    const aborted: string[] = []
    const active = render(
      <Composer storageKey="busy" onSend={() => {}} busy onAbort={() => aborted.push('stop')} />,
    )
    const input = textarea(active.container)
    expect(input.disabled).toBe(false)
    fireEvent.change(input, { target: { value: 'queued follow-up' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('queued follow-up')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(aborted).toEqual(['stop'])
    fireEvent.click(active.getByRole('button', { name: 'Stop the reply' }))
    expect(aborted).toEqual(['stop', 'stop'])
    cleanup()

    const passive = render(<Composer storageKey="busy-passive" onSend={() => {}} busy />)
    expect(passive.queryByRole('button', { name: 'Stop the reply' })).toBeNull()
    const sending = passive.getByRole('button', { name: 'Reply in progress' }) as HTMLButtonElement
    expect(sending.disabled).toBe(true)
    expect(passive.container.textContent).toContain('Sending…')
  })

  it('restores per-thread drafts and walks sent history without losing the pending draft', () => {
    const first = render(<Composer storageKey="history" onSend={() => {}} />)
    const input = textarea(first.container)
    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'second' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'working draft' } })
    input.setSelectionRange(0, 0)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('second')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.value).toBe('working draft')
    cleanup()

    const restored = render(<Composer storageKey="history" onSend={() => {}} />)
    expect(textarea(restored.container).value).toBe('working draft')
  })

  it('filters selected, pasted, and dropped files through the declared attachment types', () => {
    const added: string[] = []
    const removed: string[] = []
    const items: ComposerAttachmentItem[] = [
      { id: 'upload', name: 'uploading.png', status: 'uploading' },
      { id: 'ready', name: 'ready.png', previewUrl: 'blob:ready', status: 'ready' },
      { id: 'error', name: 'failed.png', status: 'error', errorMessage: 'Upload failed' },
    ]
    const { container, getByRole } = render(
      <Composer
        storageKey="attachments"
        onSend={() => {}}
        attachments={{
          enabled: true,
          acceptedTypes: ['image/*'],
          items,
          onAdd: (files) => added.push(...files.map((file) => file.name)),
          onRemove: (id) => removed.push(id),
        }}
      />,
    )

    expect(getByRole('status', { name: 'Uploading uploading.png' })).not.toBeNull()
    expect(getByRole('alert').textContent).toContain('Upload failed')
    fireEvent.click(getByRole('button', { name: 'Remove ready.png' }))
    expect(removed).toEqual(['ready'])

    const image = new File(['image'], 'reference.png', { type: 'image/png' })
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [image, text] } })
    fireEvent.paste(textarea(container), { clipboardData: { files: [image, text] } })
    fireEvent.drop(container.querySelector('[data-composer-root]')!, { dataTransfer: { files: [image, text] } })
    expect(added).toEqual(['reference.png', 'reference.png', 'reference.png'])
  })

  it('explains unavailable attachments and never renders an inert stop control', () => {
    const { getByRole } = render(
      <Composer
        storageKey="unsupported"
        onSend={() => {}}
        attachments={{
          enabled: false,
          disabledReason: 'This model cannot inspect images.',
          items: [],
          onAdd: () => {},
          onRemove: () => {},
        }}
      />,
    )
    const add = getByRole('button', { name: 'Add images' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(add.getAttribute('title')).toBe('This model cannot inspect images.')
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true)
  })

  it('persists keyboard resizing and exposes the character limit before send', () => {
    const { container, getByRole } = render(
      <Composer storageKey="sizing" onSend={() => {}} minHeight={88} maxHeight={160} maxLength={10} />,
    )
    const handle = getByRole('separator', { name: 'Resize message input' })
    expect(handle.getAttribute('aria-valuenow')).toBe('88')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(handle.getAttribute('aria-valuenow')).toBe('104')
    expect(localStorage.getItem('bakin-vresize:composer:sizing')).toBe('104')

    fireEvent.change(textarea(container), { target: { value: '123456789' } })
    expect(container.querySelector('[data-composer-count]')?.textContent).toContain('9 / 10')
  })
})
