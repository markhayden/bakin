import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..')

const PRODUCTION_RENDER_FILES = [
  'cli/bakin.ts',
  'src/cli/schedule.ts',
  'src/core/cli.ts',
  'src/core/cli/onboarding-interactive.tsx',
  'src/core/cli/render.tsx',
]

describe('CLI TUI render guardrails', () => {
  it('keeps production static TUI renders on the shared width-aware wrapper', () => {
    const offenders = PRODUCTION_RENDER_FILES.filter((file) => {
      const source = readFileSync(join(REPO_ROOT, file), 'utf-8')
      return /import\s*\{[^}]*\brenderToString\b[^}]*\}\s*from ['"]ink['"]/.test(source)
        || /const\s*\{[^}]*\brenderToString\b[^}]*\}\s*=\s*await\s+import\(['"]ink['"]\)/.test(source)
    })

    expect(offenders).toEqual([])
  })
})
