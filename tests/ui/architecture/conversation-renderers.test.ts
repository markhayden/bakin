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

  it('publishes a document-first timeline and empty state without duplicating routing', () => {
    const implementation = read('packages/ui/src/conversation/conversation.tsx')
    const empty = read('packages/ui/src/conversation/conversation-empty-state.tsx')
    const focused = read('packages/sdk/src/conversation/index.ts')
    expect(focused).toContain('Conversation')
    expect(focused).toContain('ConversationEmptyState')
    expect(implementation).toContain("mode = 'document'")
    expect(implementation).toContain("mode === 'contained'")
    expect(implementation).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react|useQueryState|router/)
    expect(empty).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react/)
  })

  it('keeps the legacy conversation timeline as a contained compatibility adapter', () => {
    const adapter = read('src/components/conversation/conversation.tsx')
    const emptyAdapter = read('src/components/conversation/conversation-empty-state.tsx')
    expect(adapter).toContain("from '@makinbakin/sdk/conversation'")
    expect(adapter).toContain('mode="contained"')
    expect(adapter).toContain('flex-1')
    expect(emptyAdapter).toContain("from '@makinbakin/sdk/conversation'")
  })

  it('publishes the composer without host routing, agent stores, or upload behavior', () => {
    const implementation = read('packages/ui/src/conversation/composer.tsx')
    const focused = read('packages/sdk/src/conversation/index.ts')
    expect(focused).toContain('Composer')
    expect(implementation).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react|useQueryState|router|fetch\(/)
    expect(implementation).toContain('acceptedTypes')
    expect(implementation).toContain('onAdd')
  })

  it('keeps the legacy composer as a focused compatibility adapter', () => {
    const adapter = read('src/components/conversation/composer.tsx')
    expect(adapter).toContain("from '@makinbakin/sdk/conversation'")
  })

  it('publishes the panel and tool drawer without host identity, routing, or legacy drawer dependencies', () => {
    const panel = read('packages/ui/src/conversation/conversation-panel.tsx')
    const drawer = read('packages/ui/src/conversation/tool-call-drawer.tsx')
    const focused = read('packages/sdk/src/conversation/index.ts')
    expect(focused).toContain('ConversationPanel')
    expect(focused).toContain('ToolCallDrawer')
    expect(panel).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react|AgentSelect|useAgentStore|useQueryState|router/)
    expect(drawer).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react|BakinDrawer|useQueryState|router/)
    expect(panel).toContain('This conversation is read-only.')
    expect(drawer).toContain('Captured output was truncated')
  })

  it('publishes durable thread plumbing and does not restore request-scoped streaming', () => {
    const focused = read('packages/sdk/src/conversation/index.ts')
    const thread = read('packages/sdk/src/conversation/use-conversation-thread.ts')
    const adapter = read('src/components/conversation/use-conversation-thread.ts')
    expect(focused).toContain('useConversationThread')
    expect(focused).toContain('useConversationAttention')
    expect(focused).not.toContain('readConversationSseStream')
    expect(focused).not.toContain('useConversationStream')
    expect(thread).toContain('usePluginEvent')
    expect(thread).not.toContain('ReadableStream')
    expect(adapter).toContain("from '@makinbakin/sdk/conversation'")
  })
})
