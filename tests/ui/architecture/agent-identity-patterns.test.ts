import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('public agent identity and assignment patterns', () => {
  it('keeps presentation-ready identity, status, and selection in the focused patterns entrypoint', () => {
    const patterns = read('packages/sdk/src/patterns/index.ts')
    const agentPatterns = read('packages/sdk/src/patterns/agent-patterns.tsx')

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
    expect(agentPatterns).not.toMatch(/(?:bg|text|border)-(?:red|yellow|green|blue|gray|zinc|slate)-/)
  })

  it('retains stores, team loading, and heartbeat timing only in compatibility adapters', () => {
    const avatar = read('src/components/agent-avatar.tsx')
    const select = read('src/components/agent-select.tsx')
    const status = read('src/components/agent-status.tsx')

    expect(avatar).toContain("from '@makinbakin/sdk/patterns'")
    expect(avatar).toContain('useAgent')
    expect(select).toContain("from '@makinbakin/sdk/patterns'")
    expect(select).toContain("fetch('/api/plugins/team/teams')")
    expect(status).toContain("from '@makinbakin/sdk/patterns'")
    expect(status).toContain('Date.now')
  })
})
