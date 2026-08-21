import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
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

  it('keeps activity presentation package-local; the legacy adapter stays deleted (P-final)', () => {
    const implementation = read('packages/ui/src/conversation/activity-group.tsx')
    expect(implementation).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react/)
    expect(implementation).toContain('text-bakin-text-primary')
    // Reduced motion is honoured by the Spinner primitive the group composes,
    // not by a hand-rolled ring — the guarantee moved, it did not disappear.
    expect(implementation).toContain("from '../primitives/spinner'")
    expect(implementation).not.toContain('border-r-transparent')
    expect(existsSync(resolve(ROOT, 'src/components/conversation/activity-group.tsx'))).toBe(false)
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
    // Reduced motion rides the Spinner primitive; see the activity-group pin above.
    expect(agentTurn).toContain("from '../primitives/spinner'")
    expect(agentTurn).not.toContain('border-r-transparent')
  })

  it('the legacy turn compatibility adapters stay deleted (P-final)', () => {
    expect(existsSync(resolve(ROOT, 'src/components/conversation/agent-turn.tsx'))).toBe(false)
    expect(existsSync(resolve(ROOT, 'src/components/conversation/user-message.tsx'))).toBe(false)
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

  it('the legacy conversation timeline adapter stays deleted (P-final)', () => {
    expect(existsSync(resolve(ROOT, 'src/components/conversation/conversation.tsx'))).toBe(false)
    expect(existsSync(resolve(ROOT, 'src/components/conversation/conversation-empty-state.tsx'))).toBe(false)
  })

  it('publishes the composer without host routing, agent stores, or upload behavior', () => {
    const implementation = read('packages/ui/src/conversation/composer.tsx')
    const focused = read('packages/sdk/src/conversation/index.ts')
    expect(focused).toContain('Composer')
    expect(implementation).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react|useQueryState|router|fetch\(/)
    expect(implementation).toContain('acceptedTypes')
    expect(implementation).toContain('onAdd')
  })

  it('the legacy composer compatibility adapter stays deleted (P-final)', () => {
    expect(existsSync(resolve(ROOT, 'src/components/conversation/composer.tsx'))).toBe(false)
  })

  it('publishes the panel and tool drawer without host identity, routing, or legacy drawer dependencies', () => {
    const panel = read('packages/ui/src/conversation/conversation-panel.tsx')
    const drawer = read('packages/ui/src/conversation/tool-call-drawer.tsx')
    const focused = read('packages/sdk/src/conversation/index.ts')
    expect(focused).toContain('ConversationPanel')
    expect(focused).toContain('ToolCallDrawer')
    expect(panel).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react|AgentSelect|useAgentStore|useQueryState|router/)
    expect(drawer).not.toMatch(/@\/|@makinbakin\/sdk|@bakin\/core|lucide-react|\bDrawer\b|useQueryState|router/)
    expect(panel).toContain('This conversation is read-only.')
    expect(drawer).toContain('Captured output was truncated')
  })

  it('publishes durable thread plumbing and does not restore request-scoped streaming', () => {
    const focused = read('packages/sdk/src/conversation/index.ts')
    const thread = read('packages/sdk/src/conversation/use-conversation-thread.ts')
    const replyToast = read('src/components/conversation/reply-toast.tsx')
    const avatarAdapter = read('src/components/agent-avatar.tsx')
    const navBadge = read('src/hooks/use-nav-badge.ts')
    expect(focused).toContain('useConversationThread')
    expect(focused).toContain('useConversationAttention')
    expect(focused).not.toContain('readConversationSseStream')
    expect(focused).not.toContain('useConversationStream')
    expect(thread).toContain('usePluginEvent')
    expect(thread).toContain("from '@/hooks/use-plugin-event'")
    expect(thread).toContain("from '../types/runtime'")
    expect(thread).not.toContain("from '@makinbakin/sdk/hooks'")
    expect(thread).not.toContain("from '@bakin/core")
    expect(thread).not.toContain('ReadableStream')
    expect(replyToast).toContain("from '@makinbakin/sdk/navigation'")
    expect(replyToast).toContain("from '@makinbakin/sdk/hooks'")
    expect(replyToast).not.toContain("from '@bakin/team")
    expect(avatarAdapter).toContain("from '@makinbakin/sdk/hooks'")
    expect(avatarAdapter).not.toContain("from '@bakin/team")
    expect(navBadge).toContain("from '../../packages/sdk/src/register'")
    expect(navBadge).toContain("from '@makinbakin/sdk/types'")
    expect(navBadge).not.toContain("from '@makinbakin/sdk'")
    expect(existsSync(resolve(ROOT, 'src/components/conversation/use-conversation-thread.ts'))).toBe(false)
  })
})
