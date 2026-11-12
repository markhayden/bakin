/**
 * chooseRuntime: `bakin onboard`'s first step, against real (throwaway)
 * homes. It gathers the facts, runs the decision table, asks when told to,
 * and writes nothing.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(tmpdir(), `bakin-test-onboard-runtime-${Date.now()}-${randomUUID()}`)
// The adapters and the content dir read these when first asked.
process.env.BAKIN_HOME = join(root, 'bakin')
process.env.PI_HOME = join(root, 'pi')
process.env.OPENCLAW_HOME = join(root, 'openclaw')

mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { OnboardingCancelledError } from '../../src/core/cli/onboarding-interactive'
import { chooseRuntime, readRuntimeFlag } from '../../src/cli/onboard-runtime'

const settingsFile = join(root, 'bakin', 'settings.json')
const never = async (): Promise<string> => { throw new Error('the operator must not be asked') }

function piInstalled(): void { mkdirSync(join(root, 'pi', 'agent'), { recursive: true }) }
function openClawInstalled(): void {
  mkdirSync(join(root, 'openclaw'), { recursive: true })
  writeFileSync(join(root, 'openclaw', 'openclaw.json'), '{}')
}
function settings(content: string): void {
  mkdirSync(join(root, 'bakin'), { recursive: true })
  writeFileSync(settingsFile, content)
}

const savedEnv = process.env.BAKIN_RUNTIME_ADAPTER
beforeEach(() => {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  resetPiHome()
  delete process.env.BAKIN_RUNTIME_ADAPTER
})
afterAll(() => {
  if (savedEnv === undefined) delete process.env.BAKIN_RUNTIME_ADAPTER
  else process.env.BAKIN_RUNTIME_ADAPTER = savedEnv
  rmSync(root, { recursive: true, force: true })
})

describe('readRuntimeFlag', () => {
  test('reads both spellings and tells absent from empty', () => {
    expect(readRuntimeFlag(['onboard', '--runtime', 'pi'])).toBe('pi')
    expect(readRuntimeFlag(['onboard', '--runtime=openclaw', '--json'])).toBe('openclaw')
    expect(readRuntimeFlag(['onboard', '--json'])).toBeUndefined()
    // A flag with no value is a name nobody supports, not "no flag".
    expect(readRuntimeFlag(['onboard', '--runtime', '--json'])).toBe('')
    expect(readRuntimeFlag(['onboard', '--runtime'])).toBe('')
  })
})

describe('chooseRuntime', () => {
  test('nothing set up, nothing stored: Pi by default, to be kept, and nothing is written', async () => {
    const chosen = await chooseRuntime({ flag: undefined, interactive: true, promptRuntimeChoice: never })
    expect(chosen).toEqual({ kind: 'use', adapter: 'pi', source: 'default', persist: true, found: [] })
    expect(readdirSync(root)).toEqual([])
  })

  test('a scripted run with one runtime set up uses it', async () => {
    piInstalled()
    expect(await chooseRuntime({ flag: undefined, interactive: false, promptRuntimeChoice: never }))
      .toEqual({ kind: 'use', adapter: 'pi', source: 'detected', persist: true, found: ['pi'] })
  })

  test('a scripted run with both set up is refused, and --runtime resolves it', async () => {
    piInstalled()
    openClawInstalled()
    expect(await chooseRuntime({ flag: undefined, interactive: false, promptRuntimeChoice: never }))
      .toMatchObject({ kind: 'refused', code: 'ambiguous_runtime', found: ['openclaw', 'pi'] })
    expect(await chooseRuntime({ flag: 'pi', interactive: false, promptRuntimeChoice: never }))
      .toEqual({ kind: 'use', adapter: 'pi', source: 'flag', persist: true, found: ['openclaw', 'pi'] })
  })

  test('a person is asked, with every supported runtime offered and the found ones marked', async () => {
    piInstalled()
    let offered: unknown
    let preselected: unknown
    const chosen = await chooseRuntime({
      flag: undefined,
      interactive: true,
      promptRuntimeChoice: async (options, first) => {
        offered = options
        preselected = first
        return 'openclaw'
      },
    })
    expect(offered).toEqual([
      { adapter: 'openclaw', found: false, label: 'OpenClaw', summary: expect.any(String) },
      { adapter: 'pi', found: true, label: 'Pi', summary: expect.any(String) },
    ])
    expect(preselected).toBe('pi')
    // What the person picked, even though it was not the one found.
    expect(chosen).toEqual({ kind: 'use', adapter: 'openclaw', source: 'asked', persist: true, found: ['pi'] })
  })

  test('leaving the question with Ctrl-C is a cancellation', async () => {
    piInstalled()
    const chosen = await chooseRuntime({ flag: undefined, interactive: true, promptRuntimeChoice: async () => { throw new OnboardingCancelledError() } })
    expect(chosen.kind).toBe('cancelled')
  })

  test('a stored runtime is used as is and is never asked about', async () => {
    piInstalled()
    openClawInstalled()
    settings(JSON.stringify({ runtime: { adapter: 'openclaw' } }))
    expect(await chooseRuntime({ flag: undefined, interactive: true, promptRuntimeChoice: never }))
      .toEqual({ kind: 'use', adapter: 'openclaw', source: 'existing', persist: false, found: ['openclaw', 'pi'] })
    expect(await chooseRuntime({ flag: 'pi', interactive: true, promptRuntimeChoice: never }))
      .toMatchObject({ kind: 'refused', code: 'runtime_already_set' })
  })

  test('the environment override is used and not kept; an unsupported one is refused', async () => {
    process.env.BAKIN_RUNTIME_ADAPTER = 'pi'
    expect(await chooseRuntime({ flag: undefined, interactive: false, promptRuntimeChoice: never }))
      .toEqual({ kind: 'use', adapter: 'pi', source: 'env', persist: false, found: [] })
    process.env.BAKIN_RUNTIME_ADAPTER = 'bogus'
    expect(await chooseRuntime({ flag: undefined, interactive: false, promptRuntimeChoice: never }))
      .toMatchObject({ kind: 'refused', code: 'invalid_runtime' })
  })

  test('nothing is chosen on top of a settings file that cannot be trusted', async () => {
    piInstalled()
    settings('{ not json')
    expect(await chooseRuntime({ flag: undefined, interactive: true, promptRuntimeChoice: never })).toEqual({ kind: 'none', found: ['pi'] })
    // An explicit flag still names the runtime for the run; it is not kept.
    expect(await chooseRuntime({ flag: 'pi', interactive: false, promptRuntimeChoice: never }))
      .toEqual({ kind: 'use', adapter: 'pi', source: 'flag', persist: false, found: ['pi'] })
    expect(existsSync(settingsFile)).toBe(true)
  })
})
