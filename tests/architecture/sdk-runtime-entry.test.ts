/**
 * The published `@makinbakin/sdk` root bundle is built from
 * scripts/sdk-runtime-entry.ts, not from the source barrel. Every VALUE the
 * barrel exports must be in that entry, or plugins compile against a name
 * the shipped bundle does not have (defineSocketRoute was missing, #1029).
 * Pure scanner: reads both files as text.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')
const valueExports = (source: string): string[] => [...source.matchAll(/^export \{([^}]+)\} from /gm)]
  .flatMap((match) => match[1]!.split(','))
  .map((name) => name.trim())
  .filter((name) => name && !name.startsWith('type '))
  .map((name) => name.split(/\s+as\s+/).at(-1)!)

describe('SDK publish runtime entry', () => {
  it('exports every value the public source barrel exports', () => {
    const barrel = valueExports(readFileSync(join(root, 'packages/sdk/src/index.ts'), 'utf-8'))
    const entry = new Set(valueExports(readFileSync(join(root, 'scripts/sdk-runtime-entry.ts'), 'utf-8')))
    expect(barrel.length).toBeGreaterThan(0)
    expect(barrel.filter((name) => !entry.has(name))).toEqual([])
  })
})
