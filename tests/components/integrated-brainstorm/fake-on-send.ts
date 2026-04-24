import { mock } from 'bun:test'
import type { BrainstormOnSend, SendContext } from '@/components/integrated-brainstorm'

interface Pending {
  signal: AbortSignal
  onToken: (text: string) => void
  onCustom?: (name: string, data: unknown) => void
  resolve: (result: { content: string }) => void
  reject: (err: unknown) => void
}

export interface FakeOnSend {
  /** The onSend function to pass to <IntegratedBrainstorm>. */
  onSend: BrainstormOnSend
  /** Capture of every send() call. */
  calls: Array<{ prompt: string; historyLength: number }>
  /** Feed a token into the in-flight stream. */
  emitToken: (text: string) => void
  /** Forward a domain event to the caller. */
  emitCustom: (name: string, data: unknown) => void
  /** Resolve the in-flight stream with final content. */
  resolve: (content?: string) => void
  /** Reject the in-flight stream. */
  reject: (err: unknown) => void
  /** True while a send is in flight. */
  isPending: () => boolean
  /** AbortSignal of the current request. */
  getSignal: () => AbortSignal | null
}

export function createFakeOnSend(): FakeOnSend {
  let pending: Pending | null = null
  const calls: FakeOnSend['calls'] = []

  const onSend: BrainstormOnSend = mock(async (prompt, history, ctx: SendContext) => {
    calls.push({ prompt, historyLength: history.length })
    return new Promise<{ content: string }>((resolve, reject) => {
      pending = {
        signal: ctx.signal,
        onToken: ctx.onToken,
        onCustom: ctx.onCustom,
        resolve,
        reject,
      }
      ctx.signal.addEventListener('abort', () => {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
        pending = null
      })
    })
  }) as BrainstormOnSend

  return {
    onSend,
    calls,
    emitToken: (text) => {
      if (!pending) throw new Error('No pending send')
      pending.onToken(text)
    },
    emitCustom: (name, data) => {
      if (!pending) throw new Error('No pending send')
      pending.onCustom?.(name, data)
    },
    resolve: (content = '') => {
      if (!pending) throw new Error('No pending send')
      pending.resolve({ content })
      pending = null
    },
    reject: (err) => {
      if (!pending) throw new Error('No pending send')
      pending.reject(err)
      pending = null
    },
    isPending: () => pending !== null,
    getSignal: () => pending?.signal ?? null,
  }
}
