import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as PrivatePatterns from '@bakin/ui/patterns'
import * as Patterns from '@makinbakin/sdk/patterns'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('public agent identity and assignment patterns', () => {
  it('owns agent presentation in the private kit without app or SDK dependencies', () => {
    const patterns = read('packages/sdk/src/patterns/index.ts')
    expect(existsSync(join(root, 'packages/ui/src/patterns/agent-patterns.tsx'))).toBe(true)
    expect(existsSync(join(root, 'packages/sdk/src/patterns/agent-patterns.tsx'))).toBe(false)
    const agentPatterns = read('packages/ui/src/patterns/agent-patterns.tsx')

    for (const symbol of [
      'AgentAvatar',
      'AgentDot',
      'AgentStatus',
      'AgentSelect',
      'TEAM_VALUE_PREFIX',
      'isTeamValue',
      'teamIdFromValue',
    ]) expect(patterns).toContain(symbol)

    expect(agentPatterns).not.toMatch(/@\/|@makinbakin\/sdk|lucide-react|useAgent|fetch\(|Date\.now|window\.|document\./)
    expect(agentPatterns).not.toMatch(/from ['"]@bakin\/ui(?:\/patterns)?['"]/)
    expect(agentPatterns).not.toMatch(/(?:bg|text|border)-(?:red|yellow|green|blue|gray|zinc|slate)-/)
  })

  it('publishes the same agent implementations and assignment helpers through the SDK', () => {
    for (const name of [
      'AgentAvatar', 'AgentDot', 'AgentStatus', 'AgentSelect',
      'TEAM_VALUE_PREFIX', 'isTeamValue', 'teamIdFromValue',
    ] as const) {
      expect(Patterns[name]).toBeDefined()
      expect(Patterns[name]).toBe(PrivatePatterns[name])
    }

    const renderer = read('packages/sdk/src/patterns/plugin-settings-renderer.tsx')
    expect(renderer).toContain("from '@bakin/ui/patterns'")
    expect(renderer).not.toContain("from './agent-patterns'")
  })

  it('retains the store-aware avatar adapter; barrel-era adapters stay deleted (P-final)', () => {
    // Host code still reaches the store-aware avatar via `@/components/agent-avatar`.
    const avatar = read('src/components/agent-avatar.tsx')
    expect(avatar).toContain("from '@makinbakin/sdk/patterns'")
    expect(avatar).toContain('useAgent')

    // Deleted with the frozen components barrel — reintroduction is a regression.
    expect(existsSync(join(root, 'src/components/agent-select.tsx'))).toBe(false)
    expect(existsSync(join(root, 'src/components/agent-status.tsx'))).toBe(false)
  })
})
