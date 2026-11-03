/**
 * ONE copy table (spec A15): every automation block reason has user-facing
 * words; internal codes never reach a rendered string.
 */
import { describe, expect, it } from 'bun:test'
import { AUTOMATION_BLOCK_REASONS, automationBlockCopy, type AutomationBlockReason } from '../../../packages/core/src/health/copy'
import { MUTATION_REFUSAL_REASONS } from '../../../packages/core/src/health/authorize-mutation'

describe('automationBlockCopy', () => {
  it('covers every refusal reason of the gate and every auto-apply block reason', () => {
    for (const reason of MUTATION_REFUSAL_REASONS) expect(AUTOMATION_BLOCK_REASONS).toContain(reason)
    for (const reason of AUTOMATION_BLOCK_REASONS) {
      const copy = automationBlockCopy(reason)
      expect(copy.title.length).toBeGreaterThan(8)
      expect(copy.title).not.toContain(reason) // no raw code in rendered words
      expect(copy.title).not.toMatch(/[a-z]+-[a-z]+/) // no kebab-case identifiers
    }
  })

  it('names the thing the user must do, in the adopted wording', () => {
    expect(automationBlockCopy('consent-unreviewed').title).toBe('Your approval is needed before automatic updates')
    expect(automationBlockCopy('consent-delta', { permissions: 2, bins: 1 }).title).toBe('This update needs additional access')
    expect(automationBlockCopy('consent-delta', { permissions: 2, bins: 1 }).detail).toBe('Asks for 2 new permissions and 1 new binary.')
    expect(automationBlockCopy('declined').title).toBe('Automatic changes are off for this tool')
    expect(automationBlockCopy('untrusted-source').title).toBe('Updates from this source need your approval')
    expect(automationBlockCopy('hub-skill').title).toBe('Review this skill update before installing')
    expect(automationBlockCopy('operator-only', { consequence: 'Deletes 12 files' }).title).toBe('Deletes 12 files')
    expect(automationBlockCopy('quarantined', { failedOn: 'Tuesday' }).title).toBe('This version failed here on Tuesday; automatic retries are paused')
    expect(automationBlockCopy('turn-in-flight', { agent: 'Main', task: 'Index receipts' }).title).toBe('Waiting for Main’s “Index receipts” to finish')
    expect(automationBlockCopy('restart-pending').title).toBe('Update ready — waiting to restart')
    expect(automationBlockCopy('preflight-failed').title).toBe('Update paused: these installed tools need attention')
    expect(automationBlockCopy('disabled').title).toBe('Automatic updates are off')
    expect(automationBlockCopy('skipped').title).toBe('This version is hidden')
  })

  it('every reason is a member of the exported union at the type level', () => {
    const r: AutomationBlockReason = 'disabled'
    expect(AUTOMATION_BLOCK_REASONS.includes(r)).toBe(true)
  })
})
