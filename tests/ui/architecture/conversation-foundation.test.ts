import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('focused conversation foundation', () => {
  it('publishes model, folding, and time utilities only through the isolated entrypoint', () => {
    const focused = read('packages/sdk/src/conversation/index.ts')
    const base = [
      read('packages/sdk/src/ui/index.ts'),
      read('packages/sdk/src/layout/index.ts'),
      read('packages/sdk/src/patterns/index.ts'),
      read('packages/sdk/src/charts/index.ts'),
      read('packages/ui/src/index.ts'),
    ].join('\n')
    const manifest = JSON.parse(read('packages/ui/package.json')) as { exports: Record<string, string> }

    expect(focused).toContain("from '@bakin/ui/conversation'")
    expect(focused).toContain('foldConversation')
    expect(focused).toContain('ConversationMessage')
    expect(focused).toContain('formatRelativeTime')
    expect(focused).toContain('dayKey')
    expect(manifest.exports['./conversation']).toBe('./src/conversation/index.ts')
    expect(base).not.toMatch(/(?:^|\/)conversation(?:\/|')/m)
    // P-final: the frozen components barrel is gone entirely.
    expect(existsSync(resolve(ROOT, 'packages/sdk/src/components'))).toBe(false)
  })

  it('keeps the pure model package-local and legacy modules as public-SDK adapters', () => {
    const sources = [
      read('packages/ui/src/conversation/fold.ts'),
      read('packages/ui/src/conversation/relative-time.ts'),
    ].join('\n')

    expect(sources).not.toMatch(
      /@\/|@makinbakin\/sdk|@bakin\/core|\b(?:window|document)\b|from ['"]react['"]/
    )
    expect(read('src/components/conversation/fold.ts')).toContain("@makinbakin/sdk/conversation")
    // P-final: the barrel-era relative-time adapter stays deleted.
    expect(existsSync(resolve(ROOT, 'src/components/conversation/relative-time.ts'))).toBe(false)
  })

  it('documents stable folding, missing data, time, and runtime-chunk compatibility', () => {
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    expect(guide).toContain('@makinbakin/sdk/conversation')
    expect(guide).toContain('foldConversation')
    expect(guide).toContain('RuntimeChatChunk')
    expect(guide).toContain('formatRelativeTime')
    expect(guide).toContain('arrival order')
  })
})
