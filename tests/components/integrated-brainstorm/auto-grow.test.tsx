// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { useState } from 'react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-grow-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'pixel',
  tryGetMainAgentId: () => 'pixel',
  getMainAgentName: () => 'Pixel',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

const MOCK_AGENTS = [{ id: 'pixel', name: 'Pixel', headshot: undefined }]
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => MOCK_AGENTS,
  useAgentIds: () => MOCK_AGENTS.map((a) => a.id),
  useAgent: (id: string) => MOCK_AGENTS.find((a) => a.id === id),
  useAgentColor: () => '#5e6ad2',
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      agentMap: Object.fromEntries(MOCK_AGENTS.map((a) => [a.id, a])),
      agents: MOCK_AGENTS,
      displaySettings: {},
    }),
}))

import { IntegratedBrainstorm } from '@/components/integrated-brainstorm'
import type { BrainstormMessage } from '@/components/integrated-brainstorm'
import { createFakeOnSend } from './fake-on-send'

function Harness({ fake, maxInputHeight }: { fake: ReturnType<typeof createFakeOnSend>; maxInputHeight?: number }) {
  const [messages, setMessages] = useState<BrainstormMessage[]>([])
  return (
    <IntegratedBrainstorm
      messages={messages}
      onMessagesChange={setMessages}
      onSend={fake.onSend}
      agentId="pixel"
      maxInputHeight={maxInputHeight}
    />
  )
}

/**
 * jsdom does not compute scrollHeight from content. To test that our
 * hook honors scrollHeight with a cap, we stub the property on the
 * HTMLTextAreaElement prototype for the duration of each test.
 */
function stubScrollHeight(getter: () => number): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: getter,
  })
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
  }
}

describe('IntegratedBrainstorm — textarea auto-grow', () => {
  it('sets an inline height derived from scrollHeight on mount', () => {
    const restore = stubScrollHeight(() => 60)
    try {
      const fake = createFakeOnSend()
      render(<Harness fake={fake} />)
      const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
      expect(ta.style.height).toBe('60px')
    } finally {
      restore()
    }
  })

  it('grows up to maxInputHeight as content gets taller', () => {
    let fakeHeight = 60
    const restore = stubScrollHeight(() => fakeHeight)
    try {
      const fake = createFakeOnSend()
      render(<Harness fake={fake} maxInputHeight={200} />)
      const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
      expect(ta.style.height).toBe('60px')
      fakeHeight = 140
      act(() => {
        fireEvent.change(ta, { target: { value: 'line\nline\nline\nline\nline\nline' } })
      })
      expect(ta.style.height).toBe('140px')
    } finally {
      restore()
    }
  })

  it('caps at maxInputHeight and flips overflowY to auto', () => {
    let fakeHeight = 60
    const restore = stubScrollHeight(() => fakeHeight)
    try {
      const fake = createFakeOnSend()
      render(<Harness fake={fake} maxInputHeight={200} />)
      const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
      fakeHeight = 400
      act(() => {
        fireEvent.change(ta, { target: { value: 'many lines here' } })
      })
      expect(ta.style.height).toBe('200px')
      expect(ta.style.overflowY).toBe('auto')
    } finally {
      restore()
    }
  })

  it('overflowY is hidden when content fits within cap', () => {
    const restore = stubScrollHeight(() => 60)
    try {
      const fake = createFakeOnSend()
      render(<Harness fake={fake} maxInputHeight={200} />)
      const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
      expect(ta.style.overflowY).toBe('hidden')
    } finally {
      restore()
    }
  })

  it('shrinks back toward initial when input is cleared', () => {
    let fakeHeight = 60
    const restore = stubScrollHeight(() => fakeHeight)
    try {
      const fake = createFakeOnSend()
      render(<Harness fake={fake} />)
      const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
      fakeHeight = 160
      act(() => {
        fireEvent.change(ta, { target: { value: 'a\nb\nc\nd\ne\nf' } })
      })
      expect(ta.style.height).toBe('160px')
      fakeHeight = 60
      act(() => {
        fireEvent.change(ta, { target: { value: '' } })
      })
      expect(ta.style.height).toBe('60px')
    } finally {
      restore()
    }
  })

  it('textarea has no native resize grip (resize-none class)', () => {
    const restore = stubScrollHeight(() => 60)
    try {
      const fake = createFakeOnSend()
      render(<Harness fake={fake} />)
      const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
      expect(ta.className).toContain('resize-none')
      expect(ta.className).not.toMatch(/\bresize-y\b/)
      expect(ta.className).not.toMatch(/\bresize-x\b/)
      expect(ta.className).not.toMatch(/\bresize\b(?!-none)/)
    } finally {
      restore()
    }
  })

  it('defaults maxInputHeight to 200 when not provided', () => {
    let fakeHeight = 60
    const restore = stubScrollHeight(() => fakeHeight)
    try {
      const fake = createFakeOnSend()
      render(<Harness fake={fake} />)
      const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
      fakeHeight = 500
      act(() => {
        fireEvent.change(ta, { target: { value: 'many' } })
      })
      expect(ta.style.height).toBe('200px')
    } finally {
      restore()
    }
  })
})
