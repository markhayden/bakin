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
})
