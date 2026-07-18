import { describe, expect, it } from 'bun:test'

import { assertExpectedFailure } from '../../../scripts/ui/expected-failure'

describe('seeded UI failure verification', () => {
  it('rejects a seeded defect that unexpectedly passes', () => {
    expect(() => assertExpectedFailure({
      label: 'Storybook focus',
      exitCode: 0,
      output: '',
      expectedSignature: 'toHaveFocus',
    })).toThrow('Storybook focus teeth test unexpectedly passed')
  })

  it('rejects an unrelated infrastructure failure', () => {
    expect(() => assertExpectedFailure({
      label: 'Storybook focus',
      exitCode: 1,
      output: 'browser launch timed out',
      expectedSignature: 'toHaveFocus',
    })).toThrow('did not report its expected toHaveFocus failure')
  })

  it('accepts only the expected failing assertion', () => {
    expect(() => assertExpectedFailure({
      label: 'Storybook focus',
      exitCode: 1,
      output: 'AssertionError: expected element toHaveFocus',
      expectedSignature: 'toHaveFocus',
    })).not.toThrow()
  })
})
