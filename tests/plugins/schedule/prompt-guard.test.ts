import { describe, it, expect } from 'bun:test'
import { checkSchedulePrompt } from '@bakin/schedule/lib/prompt-guard'

describe('schedule/prompt-guard', () => {
  it('flags a no-split instruction near the transport limit', () => {
    const w = checkSchedulePrompt('Post the update. Keep it under 1900 chars and do not split into multiple messages.')
    expect(w).toHaveLength(1)
    expect(w[0].code).toBe('transport-danger-zone')
  })

  it('flags "send as one message" regardless of an explicit cap', () => {
    const w = checkSchedulePrompt('Summarize the release and send it all in one message.')
    expect(w.some(x => x.code === 'transport-danger-zone')).toBe(true)
  })

  it('does not flag the safe chunking pattern', () => {
    const w = checkSchedulePrompt('Keep each chunk under 900 chars, split deliberately, read back, and delete bad duplicates.')
    expect(w).toEqual([])
  })

  it('flags a very high char cap even without a no-split instruction', () => {
    const w = checkSchedulePrompt('Write a digest up to 1900 characters.')
    expect(w.some(x => x.code === 'high-char-cap')).toBe(true)
  })

  it('returns nothing for an empty or undefined prompt', () => {
    expect(checkSchedulePrompt(undefined)).toEqual([])
    expect(checkSchedulePrompt('')).toEqual([])
  })

  it('does not flag a modest cap with splitting allowed', () => {
    expect(checkSchedulePrompt('Keep messages under 800 chars.')).toEqual([])
  })
})
