import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function source(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

describe('focused browser navigation contract', () => {
  it('owns client navigation, URL state, links, and complete dirty-exit behavior', () => {
    const entrypoint = source('packages/sdk/src/navigation/index.ts')

    for (const module of [
      './router',
      './query-state',
      './history-back',
      './plugin-link',
      './unsaved-changes-guard',
    ]) expect(entrypoint).toContain(`from '${module}'`)

    for (const exported of [
      'PluginLink',
      'useRouter',
      'useQueryState',
      'useQueryArrayState',
      'useHistoryBack',
      'useUnsavedChangesGuard',
    ]) expect(entrypoint).toContain(exported)

    expect(entrypoint).not.toContain('useUnsavedGuard')
  })

  it('keeps server route declarations separate from browser navigation', () => {
    const routing = source('packages/sdk/src/routing/index.ts')
    expect(routing).toContain('defineRoute')
    expect(routing).not.toMatch(/react|PluginLink|useRouter|useUnsaved/)
  })

  it('retains surviving compatibility adapters; barrel-era adapters stay deleted (P-final)', () => {
    const adapters = [
      'packages/sdk/src/hooks/router.ts',
      'src/hooks/use-query-state.ts',
      'src/hooks/use-history-back.ts',
    ]

    for (const path of adapters) {
      const adapter = source(path)
      expect(adapter).toContain("from '@makinbakin/sdk/navigation'")
      expect(adapter).not.toMatch(/export function|function [A-Z]|function use/)
    }

    // Deleted with the frozen components barrel — reintroduction is a regression.
    for (const path of [
      'packages/sdk/src/components/plugin-link.tsx',
      'src/components/unsaved-changes-guard.tsx',
      'src/components/save-bar.tsx',
    ]) {
      expect(existsSync(join(REPO_ROOT, path))).toBe(false)
    }
  })
})
