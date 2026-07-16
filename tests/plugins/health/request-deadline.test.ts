import { describe, expect, it } from 'bun:test'
import { withDeadline } from '../../../plugins/health/lib/request-deadline'

describe('withDeadline', () => {
  it('rejects with the caller error and invokes timeout cleanup', async () => {
    let cleanedUp = false
    const never = new Promise<void>(() => {})

    await expect(withDeadline(never, 1, {
      onTimeout: () => { cleanedUp = true },
      timeoutError: () => new Error('custom deadline'),
    })).rejects.toThrow('custom deadline')
    expect(cleanedUp).toBe(true)
  })

  it('leaves intentionally unbounded work alone', async () => {
    await expect(withDeadline(Promise.resolve('ready'), 0)).resolves.toBe('ready')
  })
})
