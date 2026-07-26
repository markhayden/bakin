import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const repoRoot = resolve(import.meta.dir, '../../..')

function read(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('Team detail route layout ownership', () => {
  it('leaves agent and team detail spacing to the shared DetailPage archetype', () => {
    for (const path of [
      'packages/host/src/routes/team.$id.tsx',
      'packages/host/src/routes/team.teams.$teamId.tsx',
    ]) {
      const source = read(path)

      expect(source).not.toMatch(/className=["'][^"']*\bp-6\b/)
      expect(source).not.toMatch(/className=["'][^"']*\bh-full\b/)
      expect(source).toContain('<Suspense fallback={null}>')
      expect(source).toContain('<Slot name="page:/team/')
    }
  })
})
