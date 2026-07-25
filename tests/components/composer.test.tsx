// @vitest-environment jsdom
/**
 * Kit Composer (T3.3) — keyboard matrix (Enter/Shift+Enter/Esc, IME guard),
 * typing-never-blocked-while-busy, stop button, per-thread draft
 * persistence, ↑/↓ input history, attachment affordance gating, char
 * counter, autofocus.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-composer-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { cleanup, fireEvent, render } from '@testing-library/react'
import '../rtl-settle'

import { Composer } from '@makinbakin/sdk/components'

const getTextarea = (container: HTMLElement) => container.querySelector('textarea')!

beforeEach(() => {
  localStorage.clear()
})

describe('Composer send keys', () => {
  it('Enter sends trimmed content and clears; Shift+Enter does not send', () => {
    const sent: string[] = []
    const { container } = render(<Composer storageKey="t1" onSend={(c) => { sent.push(c) }} />)
    const ta = getTextarea(container)
    fireEvent.change(ta, { target: { value: '  hello world  ' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(sent).toEqual([])
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(sent).toEqual(['hello world'])
    expect(ta.value).toBe('')
  })

  it('Enter during IME composition does not send', () => {
    const sent: string[] = []
    const { container } = render(<Composer storageKey="t2" onSend={(c) => { sent.push(c) }} />)
    const ta = getTextarea(container)
    fireEvent.change(ta, { target: { value: 'こんにちは' } })
    fireEvent.compositionStart(ta)
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(sent).toEqual([])
    fireEvent.compositionEnd(ta)
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(sent).toEqual(['こんにちは'])
  })
})

describe('Composer while busy (streaming)', () => {
  it('typing stays enabled, Enter is held, stop button shows and Esc aborts', () => {
    const sent: string[] = []
    const aborted: string[] = []
    const { container } = render(
      <Composer storageKey="t3" onSend={(c) => { sent.push(c) }} busy onAbort={() => aborted.push('x')} />,
    )
    const ta = getTextarea(container)
    expect(ta.disabled).toBe(false)
    fireEvent.change(ta, { target: { value: 'queued thought' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(sent).toEqual([])
    expect(ta.value).toBe('queued thought') // draft kept, not lost
    expect(container.querySelector('button[data-composer-stop]')).not.toBeNull()
    expect(container.querySelector('button[data-composer-send]')).toBeNull()
    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(aborted).toEqual(['x'])
    fireEvent.click(container.querySelector('button[data-composer-stop]')!)
    expect(aborted).toEqual(['x', 'x'])
  })
})

describe('Composer drafts', () => {
  it('persists the draft per storageKey and restores it on remount; send clears it', () => {
    const first = render(<Composer storageKey="draft-a" onSend={() => {}} />)
    fireEvent.change(getTextarea(first.container), { target: { value: 'work in progress' } })
    cleanup()

    const second = render(<Composer storageKey="draft-a" onSend={() => {}} />)
    const ta = getTextarea(second.container)
    expect(ta.value).toBe('work in progress')
    fireEvent.keyDown(ta, { key: 'Enter' })
    cleanup()

    const third = render(<Composer storageKey="draft-a" onSend={() => {}} />)
    expect(getTextarea(third.container).value).toBe('')
  })
})

describe('Composer history', () => {
  it('ArrowUp/ArrowDown step through sent messages shell-style', () => {
    const { container } = render(<Composer storageKey="hist-a" onSend={() => {}} />)
    const ta = getTextarea(container)
    fireEvent.change(ta, { target: { value: 'one' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    fireEvent.change(ta, { target: { value: 'two' } })
    fireEvent.keyDown(ta, { key: 'Enter' })

    // empty textarea: up steps back through history
    fireEvent.keyDown(ta, { key: 'ArrowUp' })
    expect(ta.value).toBe('two')
    ta.setSelectionRange(0, 0)
    fireEvent.keyDown(ta, { key: 'ArrowUp' })
    expect(ta.value).toBe('one')
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(ta.value).toBe('two')
    fireEvent.keyDown(ta, { key: 'ArrowDown' })
    expect(ta.value).toBe('')
  })
})

describe('Composer attachments', () => {
  it('renders the paperclip when enabled, thumbnails with remove, and add via file input', () => {
    const added: string[] = []
    const removed: string[] = []
    const { container } = render(
      <Composer
        storageKey="att-a"
        onSend={() => {}}
        attachments={{
          enabled: true,
          items: [{ id: 'a1', name: 'shot.png', previewUrl: 'blob:preview' }],
          onAdd: (files) => added.push(...files.map((f) => f.name)),
          onRemove: (id) => removed.push(id),
        }}
      />,
    )
    expect(container.querySelector('[data-composer-attach]')).not.toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:preview')
    fireEvent.click(container.querySelector('[data-composer-attach-remove]')!)
    expect(removed).toEqual(['a1'])

    const input = container.querySelector('input[type="file"]')!
    const file = new File(['x'], 'pasted.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(added).toEqual(['pasted.png'])
  })

  it('shows a disabled affordance with the honest reason when unsupported', () => {
    const { container } = render(
      <Composer
        storageKey="att-b"
        onSend={() => {}}
        attachments={{ enabled: false, disabledReason: "main's model can't see images", items: [], onAdd: () => {}, onRemove: () => {} }}
      />,
    )
    const attach = container.querySelector('[data-composer-attach]')
    expect(attach).not.toBeNull()
    expect(attach!.getAttribute('title')).toContain("can't see images")
    expect((attach as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Composer queueMode (#732)', () => {
  it('busy + text: the button morphs to queue-send; Enter queues and clears; empty morphs instantly back to Stop', () => {
    const sent: string[] = []
    const { container } = render(
      <Composer storageKey="qm1" onSend={(c) => { sent.push(c) }} busy queueMode onAbort={() => {}} />,
    )
    const ta = getTextarea(container)
    // Empty while busy → Stop visible, no queue button.
    expect(container.querySelector('[data-composer-stop]')).not.toBeNull()
    expect(container.querySelector('[data-composer-queue]')).toBeNull()

    fireEvent.change(ta, { target: { value: 'a correction' } })
    // Text present → queue-send replaces Stop (single morphing button, D4).
    expect(container.querySelector('[data-composer-queue]')).not.toBeNull()
    expect(container.querySelector('[data-composer-stop]')).toBeNull()

    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(sent).toEqual(['a correction'])
    expect(ta.value).toBe('')
    // The steering sequence depends on the INSTANT morph-back to Stop.
    expect(container.querySelector('[data-composer-stop]')).not.toBeNull()
    expect(container.querySelector('[data-composer-queue]')).toBeNull()
  })

  it('queue-send button click queues; Esc still aborts with text present', () => {
    const sent: string[] = []
    const aborted: string[] = []
    const { container } = render(
      <Composer storageKey="qm2" onSend={(c) => { sent.push(c) }} busy queueMode onAbort={() => aborted.push('x')} />,
    )
    const ta = getTextarea(container)
    fireEvent.change(ta, { target: { value: 'follow-up' } })
    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(aborted).toEqual(['x'])
    fireEvent.click(container.querySelector('[data-composer-queue]')!)
    expect(sent).toEqual(['follow-up'])
  })

  it('helper copy is honest in every busy mode', () => {
    // Queue surface, empty composer.
    const q = render(<Composer storageKey="qm3" onSend={() => {}} busy queueMode onAbort={() => {}} />)
    expect(q.container.textContent).toContain('type to queue a follow-up')
    fireEvent.change(getTextarea(q.container), { target: { value: 'x' } })
    expect(q.container.textContent).toContain('Enter queues your message')
    cleanup()

    // Strict surface: no false "send waits" claim.
    const s = render(<Composer storageKey="qm4" onSend={() => {}} busy onAbort={() => {}} />)
    expect(s.container.textContent).toContain('wait for the reply to finish, or stop it')
    expect(s.container.textContent).not.toContain('send waits')
    cleanup()
  })

  it('busy without onAbort renders a disabled sending spinner, never a dead Stop', () => {
    const { container } = render(<Composer storageKey="qm5" onSend={() => {}} busy />)
    expect(container.querySelector('[data-composer-stop]')).toBeNull()
    const spinner = container.querySelector('[data-composer-sending]')
    expect(spinner).not.toBeNull()
    expect((spinner as HTMLButtonElement).disabled).toBe(true)
    expect(container.textContent).toContain('Sending…')
  })

  it('idle queueMode behaves exactly like a normal composer', () => {
    const sent: string[] = []
    const { container } = render(<Composer storageKey="qm6" onSend={(c) => { sent.push(c) }} queueMode />)
    const ta = getTextarea(container)
    fireEvent.change(ta, { target: { value: 'normal send' } })
    expect(container.querySelector('[data-composer-send]')).not.toBeNull()
    expect(container.querySelector('[data-composer-queue]')).toBeNull()
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(sent).toEqual(['normal send'])
  })
})

describe('Composer char counter + autofocus', () => {
  it('shows the counter near the cap and autofocuses on mount', () => {
    const { container } = render(<Composer storageKey="cap-a" onSend={() => {}} maxLength={100} />)
    const ta = getTextarea(container)
    expect(document.activeElement).toBe(ta)
    expect(container.querySelector('[data-composer-count]')).toBeNull()
    fireEvent.change(ta, { target: { value: 'x'.repeat(85) } })
    expect(container.querySelector('[data-composer-count]')?.textContent).toContain('85')
    cleanup()
  })
})
