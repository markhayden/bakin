import { describe, it, expect } from 'bun:test'
import { parseAgentPathMap, translateAgentPathWith } from '../../packages/core/src/agent-path-map'

describe('parseAgentPathMap', () => {
  it('parses a single mapping', () => {
    expect(parseAgentPathMap('/container/home=/host/home')).toEqual([
      { from: '/container/home', to: '/host/home' },
    ])
  })

  it('parses multiple ;-separated mappings in order', () => {
    expect(parseAgentPathMap('/a=/x;/b=/y')).toEqual([
      { from: '/a', to: '/x' },
      { from: '/b', to: '/y' },
    ])
  })

  it('normalizes trailing slashes on both sides', () => {
    expect(parseAgentPathMap('/a/=/x/')).toEqual([{ from: '/a', to: '/x' }])
  })

  it('ignores malformed entries', () => {
    expect(parseAgentPathMap('no-equals;=/x;/a=;;/ok=/y')).toEqual([{ from: '/ok', to: '/y' }])
  })

  it('returns empty for unset/empty input', () => {
    expect(parseAgentPathMap(undefined)).toEqual([])
    expect(parseAgentPathMap('')).toEqual([])
  })
})

describe('translateAgentPathWith', () => {
  const map = parseAgentPathMap('/home/node/.openclaw=/Users/dev/openclaw-home')

  it('translates a path under the mapped prefix', () => {
    expect(translateAgentPathWith('/home/node/.openclaw/workspace/out.png', map))
      .toBe('/Users/dev/openclaw-home/workspace/out.png')
  })

  it('translates an exact prefix match', () => {
    expect(translateAgentPathWith('/home/node/.openclaw', map))
      .toBe('/Users/dev/openclaw-home')
  })

  it('respects path boundaries — sibling prefixes do not match', () => {
    expect(translateAgentPathWith('/home/node/.openclawX/file', map))
      .toBe('/home/node/.openclawX/file')
  })

  it('passes through non-matching paths unchanged', () => {
    expect(translateAgentPathWith('/tmp/other.png', map)).toBe('/tmp/other.png')
    expect(translateAgentPathWith('relative/path.png', map)).toBe('relative/path.png')
    expect(translateAgentPathWith('20260711-some-asset-abcd1234', map)).toBe('20260711-some-asset-abcd1234')
  })

  it('first matching mapping wins', () => {
    const multi = parseAgentPathMap('/a=/first;/a=/second;/a/b=/never')
    expect(translateAgentPathWith('/a/b/c', multi)).toBe('/first/b/c')
  })

  it('identity on empty map', () => {
    expect(translateAgentPathWith('/home/node/.openclaw/x', [])).toBe('/home/node/.openclaw/x')
  })
})
