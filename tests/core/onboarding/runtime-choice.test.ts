/**
 * decideRuntime (spec §2): one test per row of the decision table. Pure —
 * no mocks, no I/O.
 */
import { describe, expect, test } from 'bun:test'

import { decideRuntime, type RuntimeDecisionInput } from '../../../src/core/onboarding/runtime-choice'

const SUPPORTED = ['openclaw', 'pi'] as const
const base: RuntimeDecisionInput = { found: [], interactive: false, supported: SUPPORTED }
const decide = (over: Partial<RuntimeDecisionInput>) => decideRuntime({ ...base, ...over })

describe('decideRuntime', () => {
  describe('row 1: an unsupported name is refused', () => {
    test('from --runtime', () => {
      const decision = decide({ flag: 'bogus', found: ['pi'] })
      expect(decision).toMatchObject({ kind: 'refuse', code: 'invalid_runtime', found: ['pi'] })
      expect(decision.kind === 'refuse' && decision.message).toContain('--runtime bogus')
    })

    test('from BAKIN_RUNTIME_ADAPTER: no longer silently ignored', () => {
      const decision = decide({ env: 'bogus' })
      expect(decision).toMatchObject({ kind: 'refuse', code: 'invalid_runtime' })
      expect(decision.kind === 'refuse' && decision.message).toContain('BAKIN_RUNTIME_ADAPTER=bogus')
    })

    test('an invalid flag is refused even when everything else would have decided', () => {
      expect(decide({ flag: 'bogus', env: 'pi', stored: 'pi' })).toMatchObject({ kind: 'refuse', code: 'invalid_runtime' })
    })
  })

  describe('rows 2-3: the environment override', () => {
    test('row 2: used, never persisted, flag absent', () => {
      expect(decide({ env: 'pi' })).toEqual({ kind: 'use', adapter: 'pi', source: 'env', persist: false })
    })

    test('row 2: used when the flag names the same runtime', () => {
      expect(decide({ env: 'pi', flag: 'pi' })).toEqual({ kind: 'use', adapter: 'pi', source: 'env', persist: false })
    })

    test('row 2: it wins over a stored adapter without rewriting it', () => {
      expect(decide({ env: 'pi', stored: 'openclaw' })).toEqual({ kind: 'use', adapter: 'pi', source: 'env', persist: false })
    })

    test('row 3: a flag naming a different runtime is a conflict', () => {
      expect(decide({ env: 'pi', flag: 'openclaw' })).toMatchObject({ kind: 'refuse', code: 'runtime_conflict' })
    })
  })

  describe('rows 4-5: a home that already decided', () => {
    test('row 4: the stored adapter is used, flag absent', () => {
      expect(decide({ stored: 'openclaw', found: ['openclaw', 'pi'] })).toEqual({ kind: 'use', adapter: 'openclaw', source: 'existing', persist: false })
    })

    test('row 4: the stored adapter is used when the flag agrees', () => {
      expect(decide({ stored: 'pi', flag: 'pi' })).toEqual({ kind: 'use', adapter: 'pi', source: 'existing', persist: false })
    })

    test('row 4: it is used even when that runtime was not found (the runtime step reports it)', () => {
      expect(decide({ stored: 'openclaw', found: ['pi'], interactive: true })).toEqual({ kind: 'use', adapter: 'openclaw', source: 'existing', persist: false })
    })

    test('row 5: a different flag is refused and names the command that switches', () => {
      const decision = decide({ stored: 'pi', flag: 'openclaw' })
      expect(decision).toMatchObject({ kind: 'refuse', code: 'runtime_already_set' })
      expect(decision.kind === 'refuse' && decision.message).toContain('bakin runtime use openclaw')
    })
  })

  describe('row 6: an explicit choice for an undecided home', () => {
    test('the flag decides and is persisted, whatever was found', () => {
      expect(decide({ flag: 'pi', found: ['openclaw', 'pi'] })).toEqual({ kind: 'use', adapter: 'pi', source: 'flag', persist: true })
      expect(decide({ flag: 'openclaw', found: [] })).toEqual({ kind: 'use', adapter: 'openclaw', source: 'flag', persist: true })
    })
  })

  describe('row 7: nothing found', () => {
    test.each([true, false])('Pi by default, persisted (interactive=%s): there is nothing to ask about', (interactive) => {
      expect(decide({ interactive })).toEqual({ kind: 'use', adapter: 'pi', source: 'default', persist: true })
    })
  })

  describe('row 8: a person is here and something was found', () => {
    test('one found: every supported runtime is offered, the found one marked and preselected', () => {
      expect(decide({ interactive: true, found: ['pi'] })).toEqual({
        kind: 'ask',
        choices: [{ adapter: 'openclaw', found: false }, { adapter: 'pi', found: true }],
        preselected: 'pi',
      })
    })

    test('both found: the first in detection order is preselected', () => {
      expect(decide({ interactive: true, found: ['openclaw', 'pi'] })).toEqual({
        kind: 'ask',
        choices: [{ adapter: 'openclaw', found: true }, { adapter: 'pi', found: true }],
        preselected: 'openclaw',
      })
    })
  })

  describe('rows 9-10: a script', () => {
    test.each(['pi', 'openclaw'] as const)('row 9: exactly one found (%s) is used and persisted', (adapter) => {
      expect(decide({ found: [adapter] })).toEqual({ kind: 'use', adapter, source: 'detected', persist: true })
    })

    test('row 10: more than one found is refused and names --runtime', () => {
      const decision = decide({ found: ['openclaw', 'pi'] })
      expect(decision).toMatchObject({ kind: 'refuse', code: 'ambiguous_runtime', found: ['openclaw', 'pi'] })
      expect(decision.kind === 'refuse' && decision.message).toContain('--runtime')
    })
  })

  test('every refusal reports what was found, for the summary line', () => {
    for (const input of [{ flag: 'bogus' }, { env: 'pi', flag: 'openclaw' }, { stored: 'pi' as const, flag: 'openclaw' }, {}]) {
      const decision = decide({ ...input, found: ['openclaw', 'pi'] })
      expect(decision.kind).toBe('refuse')
      expect(decision.kind === 'refuse' && decision.found).toEqual(['openclaw', 'pi'])
    }
  })
})
