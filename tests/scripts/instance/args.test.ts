import { describe, expect, it } from 'bun:test'

import { parseInstanceArgs } from '../../../scripts/instance/args'

describe('parseInstanceArgs — verbs', () => {
  it('parses each known verb with native/openclaw defaults', () => {
    for (const verb of ['up', 'dev', 'reset', 'down', 'shell', 'status', 'env'] as const) {
      expect(parseInstanceArgs([verb])).toEqual({
        verb,
        mode: 'native',
        runtime: 'openclaw',
        fresh: false,
        source: 'repo',
        preconfigure: false,
        rest: [],
      })
    }
  })

  it('requires a verb', () => {
    expect(() => parseInstanceArgs([])).toThrow(/verb/i)
  })

  it('rejects an unknown verb', () => {
    expect(() => parseInstanceArgs(['frobnicate'])).toThrow(/unknown verb/i)
  })

  it('rejects an unknown flag', () => {
    expect(() => parseInstanceArgs(['up', '--wat'])).toThrow(/unknown flag/i)
  })
})

describe('parseInstanceArgs — modes + flags', () => {
  it('parses --mode and --fresh', () => {
    expect(parseInstanceArgs(['up', '--mode', 'isolated', '--fresh'])).toMatchObject({
      mode: 'isolated',
      fresh: true,
    })
  })

  it('rejects an unknown mode', () => {
    expect(() => parseInstanceArgs(['up', '--mode', 'bogus'])).toThrow(/mode/i)
  })

  it('accepts --source for isolated and sandbox', () => {
    expect(parseInstanceArgs(['up', '--mode', 'isolated', '--source', 'installed'])).toMatchObject({
      mode: 'isolated',
      source: 'installed',
    })
    expect(parseInstanceArgs(['up', '--mode', 'sandbox', '--source', 'repo'])).toMatchObject({
      mode: 'sandbox',
      source: 'repo',
    })
  })

  it('rejects --source with native mode (native always runs this repo)', () => {
    expect(() => parseInstanceArgs(['up', '--source', 'installed'])).toThrow(/--source/)
  })

  it('rejects an unknown source', () => {
    expect(() => parseInstanceArgs(['up', '--mode', 'sandbox', '--source', 'nope'])).toThrow(/source/i)
  })
})

describe('parseInstanceArgs — --preconfigure', () => {
  it('accepts --preconfigure only with sandbox', () => {
    expect(parseInstanceArgs(['up', '--mode', 'sandbox', '--preconfigure'])).toMatchObject({
      mode: 'sandbox',
      preconfigure: true,
    })
  })

  it('rejects --preconfigure without sandbox', () => {
    expect(() => parseInstanceArgs(['up', '--preconfigure'])).toThrow(/--preconfigure/)
    expect(() => parseInstanceArgs(['up', '--mode', 'isolated', '--preconfigure'])).toThrow(/--preconfigure/)
  })
})

describe('parseInstanceArgs — --runtime', () => {
  it('parses --runtime pi on every mode', () => {
    expect(parseInstanceArgs(['up', '--runtime', 'pi'])).toMatchObject({ runtime: 'pi', mode: 'native' })
    expect(parseInstanceArgs(['dev', '--mode', 'isolated', '--runtime', 'pi'])).toMatchObject({ runtime: 'pi' })
    expect(parseInstanceArgs(['shell', '--mode', 'sandbox', '--runtime', 'pi'])).toMatchObject({ runtime: 'pi' })
  })

  it('rejects an unknown runtime', () => {
    expect(() => parseInstanceArgs(['up', '--runtime', 'gpt'])).toThrow(/runtime/i)
  })

  it('rejects --runtime on reset and down (they act on the whole mode)', () => {
    expect(() => parseInstanceArgs(['reset', '--runtime', 'pi'])).toThrow(/--runtime/)
    expect(() => parseInstanceArgs(['down', '--runtime', 'openclaw'])).toThrow(/--runtime/)
  })

  it('rejects --preconfigure with pi (pi sandbox onboarding is manual)', () => {
    expect(() => parseInstanceArgs(['up', '--mode', 'sandbox', '--runtime', 'pi', '--preconfigure']))
      .toThrow(/--preconfigure/)
  })

  it('rejects --source installed for pi host modes (they always run this repo)', () => {
    expect(() => parseInstanceArgs(['up', '--mode', 'isolated', '--runtime', 'pi', '--source', 'installed']))
      .toThrow(/--source/)
    // …but sandbox may still use an installed binary.
    expect(parseInstanceArgs(['up', '--mode', 'sandbox', '--runtime', 'pi', '--source', 'installed']))
      .toMatchObject({ runtime: 'pi', source: 'installed' })
  })
})

describe('parseInstanceArgs — run passthrough', () => {
  it('captures args after -- for the run verb', () => {
    expect(parseInstanceArgs(['run', '--', 'doctor', '--json'])).toMatchObject({
      verb: 'run',
      rest: ['doctor', '--json'],
    })
  })

  it('requires passthrough args for run', () => {
    expect(() => parseInstanceArgs(['run'])).toThrow(/run/i)
  })
})
