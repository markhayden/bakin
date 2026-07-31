import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../../..')

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('Chat UI conformance', () => {
  it('composes the routed shell from the public full-bleed workspace and conversation patterns', () => {
    const contents = source('plugins/chat/components/chat-page.tsx')

    expect(contents).not.toContain('@makinbakin/sdk/components')
    expect(contents).toContain("from '@makinbakin/sdk/navigation'")
    expect(contents).toContain("from '@makinbakin/sdk/patterns'")
    expect(contents).toContain('<WorkspacePage')
    expect(contents).toContain('<WorkspacePageHeader')
    expect(contents).toContain('<WorkspacePageBody')
    expect(contents).not.toContain('[&>[data-slot=page-shell-content]]')
    expect(contents).toContain('<PageBody')
    expect(contents).toContain('<PageHeader')
    expect(contents).toContain('<SearchInput')
    expect(contents).toContain("className={chatId || draft ? 'hidden md:block' : undefined}")
    expect(contents).not.toContain('rounded-bakin-surface border border-bakin-border-subtle')
    expect(contents).not.toContain('<PluginHeader')
  })

  it('keeps the launcher single-column on narrow screens and uses focused UI contracts', () => {
    const contents = source('plugins/chat/components/launcher.tsx')

    expect(contents).not.toContain('@makinbakin/sdk/components')
    expect(contents).toContain("from '@makinbakin/sdk/conversation'")
    expect(contents).toContain("from '@makinbakin/sdk/patterns'")
    expect(contents).toContain('grid-cols-1')
    expect(contents).not.toContain('grid-cols-2 gap-3 sm:grid-cols-3')
  })

  it('uses the canonical button and focused agent identity contract for starting chats', () => {
    const contents = source('plugins/chat/components/agent-picker.tsx')

    expect(contents).not.toContain('@makinbakin/sdk/components')
    expect(contents).toContain("from '@makinbakin/sdk/patterns'")
    expect(contents).toContain('<Button')
    expect(contents).toContain('render={<Button')
  })

  it('keeps active and draft threads inside the canonical contained composer boundary', () => {
    const contents = source('plugins/chat/components/chat-view.tsx')

    expect(contents).toContain("from '@makinbakin/sdk/conversation'")
    expect(contents).toContain("from '@makinbakin/sdk/patterns'")
    expect(contents).toContain('<PageComposer')
    expect(contents).toContain('data-chat-view')
    expect(contents).toContain('min-h-0')
  })
})
