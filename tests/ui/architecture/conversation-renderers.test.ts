import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('focused conversation renderers', () => {
  it('publishes activity presentation through the focused conversation entrypoint', () => {
    const privateIndex = read('packages/ui/src/conversation/index.ts')
    const focused = read('packages/sdk/src/conversation/index.ts')
    expect(privateIndex).toContain("from './activity-group'")
    expect(focused).toContain('ActivityGroup')
    expect(focused).toContain("from '@bakin/ui/conversation'")
  })

  it('keeps activity presentation package-local and the legacy module as an adapter', () => {
    const implementation = read('packages/ui/src/conversation/activity-group.tsx')
    const adapter = read('src/components/conversation/activity-group.tsx')
    expect(implementation).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react/)
    expect(implementation).toContain('text-bakin-text-primary')
    expect(implementation).toContain('motion-reduce:animate-none')
    expect(adapter).toContain("from '@makinbakin/sdk/conversation'")
    expect(adapter).toContain("from '@bakin/core/format'")
  })

  it('publishes agent and user turns without host identity or markdown dependencies', () => {
    const privateIndex = read('packages/ui/src/conversation/index.ts')
    const focused = read('packages/sdk/src/conversation/index.ts')
    const agentTurn = read('packages/ui/src/conversation/agent-turn.tsx')
    const userMessage = read('packages/ui/src/conversation/user-message.tsx')
    expect(privateIndex).toContain("from './agent-turn'")
    expect(privateIndex).toContain("from './user-message'")
    expect(focused).toContain('AgentTurn')
    expect(focused).toContain('UserMessage')
    expect(agentTurn).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react|markdown-content/)
    expect(userMessage).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react|markdown-content/)
    expect(agentTurn).toContain('text-bakin-text-primary')
    expect(agentTurn).toContain('motion-reduce:animate-none')
  })

  it('keeps host identity, markdown, and structured JSON in compatibility adapters', () => {
    const agentAdapter = read('src/components/conversation/agent-turn.tsx')
    const userAdapter = read('src/components/conversation/user-message.tsx')
    expect(agentAdapter).toContain("from '@makinbakin/sdk/conversation'")
    expect(agentAdapter).toContain("from '@makinbakin/sdk/hooks'")
    expect(agentAdapter).toContain("from '@bakin/core/format'")
    expect(agentAdapter).toContain("from '../markdown-content'")
    expect(userAdapter).toContain("from '@makinbakin/sdk/conversation'")
  })
})
