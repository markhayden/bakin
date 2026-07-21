import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('public settings and turn-output patterns', () => {
  it('publishes schema-driven settings presentation from the focused patterns entrypoint', () => {
    const patterns = read('packages/sdk/src/patterns/index.ts')
    const settings = read('packages/sdk/src/patterns/plugin-settings-renderer.tsx')

    for (const symbol of [
      'PluginSettingsRenderer',
      'PluginSettingsRendererProps',
      'PluginSettingsFeedback',
      'PluginSettingsSchema',
      'ListSettingsField',
    ]) expect(patterns).toContain(symbol)

    expect(settings).not.toMatch(/@\/|@bakin\/core|@makinbakin\/sdk|lucide-react|useToast|fetch\(|\/api\/|window\.|document\./)
    expect(settings).not.toMatch(/(?:bg|text|border)-(?:red|yellow|green|blue|gray|zinc|slate)-/)
  })

  it('publishes single-turn output beside the shared conversation folding engine', () => {
    const conversation = read('packages/sdk/src/conversation/index.ts')
    const output = read('packages/ui/src/conversation/turn-output.tsx')

    for (const symbol of [
      'TurnOutputView',
      'TurnToolChip',
      'foldTurnChunks',
      'TurnOutputViewProps',
      'FoldedTurnOutput',
    ]) expect(conversation).toContain(symbol)

    expect(output).toContain("from './fold'")
    expect(output).toContain("from './activity-group'")
    expect(output).not.toMatch(/@\/|@makinbakin\/sdk|react-markdown|remark-gfm|rehype-highlight|MarkdownContent|lucide-react/)
  })

  it('keeps app feedback and rich Markdown behavior in source-compatible root adapters', () => {
    const settings = read('src/components/plugin-settings-renderer.tsx')
    const output = read('src/components/turn-output-view.tsx')

    expect(settings).toContain("from '@makinbakin/sdk/patterns'")
    expect(settings).toContain('useToastStore')
    expect(output).toContain("from '@makinbakin/sdk/conversation'")
    expect(output).toContain('MarkdownContent')
  })
})
