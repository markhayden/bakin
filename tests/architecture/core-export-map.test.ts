/**
 * Every `@bakin/core/<subpath>` the SDK's browser navigation entrypoint
 * imports must be listed in the core package's `exports` map.
 *
 * Bun and tsc resolve these through tsconfig paths, so a missing entry passes
 * the whole local suite — and then fails every Vite build (Storybook, the
 * docs site), which resolves through `exports` and loads
 * `@makinbakin/sdk/navigation` on nearly every page. Type-only imports are
 * erased and exempt. Pure scanner: imports no app modules.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../..')
const exportsMap = (JSON.parse(readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8')) as { exports: Record<string, unknown> }).exports

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('@bakin/core export map', () => {
  test('lists every subpath the navigation entrypoint imports', () => {
    const missing = new Set<string>()
    for (const file of sourceFiles(join(ROOT, 'packages/sdk/src/navigation'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/^(?:import|export) (?!type )[^;]*?from '@bakin\/core(\/[^']+)?'/gm)) {
        const subpath = match[1] ? `.${match[1]}` : '.'
        if (!(subpath in exportsMap)) missing.add(`${subpath} (imported by ${file.slice(ROOT.length + 1)})`)
      }
    }
    expect([...missing]).toEqual([])
  })
})
