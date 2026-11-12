/**
 * onboard:rig argument parsing: which home the rig builds, and that
 * everything after `--` reaches `bakin onboard` untouched.
 */
import { describe, expect, test } from 'bun:test'

import { parseRigArgs } from '../../scripts/onboard-rig'

describe('onboard:rig arguments', () => {
  test('defaults: nothing set up, nothing stored, network denied, home removed afterwards', () => {
    expect(parseRigArgs([])).toEqual({ runtime: 'none', auth: 'none', stored: null, keep: false, network: false, home: null, onboardArgs: [] })
  })

  test('everything after -- goes to bakin onboard, including flags the rig also has', () => {
    const options = parseRigArgs(['--runtime', 'both', '--', '--runtime', 'pi', '--yes', '--json'])
    expect(options.runtime).toBe('both')
    expect(options.onboardArgs).toEqual(['--runtime', 'pi', '--yes', '--json'])
  })

  test('reads every rig option', () => {
    expect(parseRigArgs(['--runtime', 'pi', '--auth', 'copy', '--stored', 'pi', '--keep', '--network', '--home', '/tmp/kept']))
      .toEqual({ runtime: 'pi', auth: 'copy', stored: 'pi', keep: true, network: true, home: '/tmp/kept', onboardArgs: [] })
  })

  test.each([
    [['--runtime', 'bogus']],
    [['--auth', 'real']],
    [['--runtime']],
    [['--unknown']],
  ])('refuses %p instead of guessing', (argv) => {
    const exit = process.exit
    const error = console.error
    let code: number | undefined
    console.error = () => {}
    process.exit = ((value?: number) => { code = value; throw new Error('exit') }) as typeof process.exit
    try {
      expect(() => parseRigArgs(argv)).toThrow('exit')
    } finally {
      process.exit = exit
      console.error = error
    }
    expect(code).toBe(1)
  })
})
