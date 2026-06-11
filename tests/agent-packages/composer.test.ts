/**
 * Tests for the managed-block composer (layered-context spec, C1).
 *
 * Coverage:
 *   - Per-file recipes: AGENTS.md (global + team + package), SOUL.md
 *     (package + lessons), IDENTITY.md / TOOLS.md (package only)
 *   - Unmanaged-agent recipe: AGENTS.md with global/team only (no package)
 *   - Determinism: identical inputs → identical bytes
 *   - Absent/empty layers are omitted (no empty sections)
 *   - Nothing to compose → null (no block at all)
 *   - composeFileContent injects when absent, replaces in place when present,
 *     and preserves all content outside the markers exactly
 *   - Lesson catalog renders enabled/disabled checkboxes; only enabled
 *     lesson bodies are included; toggle recomposition changes output
 *   - Provenance comment and section separators present
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-composer-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  MANAGED_BLOCK_ID,
  composeManagedBlock,
  composeFileContent,
  type ComposeInputs,
} from '../../packages/core/src/agent-packages/composer'
import { extractBlock, hasBlock } from '../../packages/core/src/agent-packages/managed-blocks'

const PIXEL_INPUTS: ComposeInputs = {
  global: '# Global Rules\n\n- Always log progress',
  team: { id: 'media', content: '# Media Team\n\n- Use the style guide' },
  packageTemplate: {
    packageId: 'pixel',
    content: '# Operating Notes\n\n- Iterate until perfect',
  },
}

describe('composeManagedBlock — AGENTS.md recipe', () => {
  it('composes global + team + package sections in order', () => {
    const body = composeManagedBlock('AGENTS.md', PIXEL_INPUTS)
    expect(body).not.toBeNull()
    const globalIdx = body!.indexOf('<!-- bakin-section: global -->')
    const teamIdx = body!.indexOf('<!-- bakin-section: team:media -->')
    const pkgIdx = body!.indexOf('<!-- bakin-section: package -->')
    expect(globalIdx).toBeGreaterThan(-1)
    expect(teamIdx).toBeGreaterThan(globalIdx)
    expect(pkgIdx).toBeGreaterThan(teamIdx)
    expect(body!).toContain('Always log progress')
    expect(body!).toContain('Use the style guide')
    expect(body!).toContain('Iterate until perfect')
  })

  it('starts with the provenance comment', () => {
    const body = composeManagedBlock('AGENTS.md', PIXEL_INPUTS)
    expect(body!.startsWith('<!-- Managed by Bakin.')).toBe(true)
  })

  it('includes the role section after global (built-in role layer)', () => {
    const body = composeManagedBlock('AGENTS.md', {
      global: '# Global Rules',
      role: { id: 'orchestrator', content: '# Orchestrator Rules\n\n- Delegate, never do inline work' },
    })
    const globalIdx = body!.indexOf('<!-- bakin-section: global -->')
    const roleIdx = body!.indexOf('<!-- bakin-section: role:orchestrator -->')
    expect(globalIdx).toBeGreaterThan(-1)
    expect(roleIdx).toBeGreaterThan(globalIdx)
    expect(body!).toContain('Delegate, never do inline work')
  })

  it('ignores the role layer in non-AGENTS files', () => {
    const body = composeManagedBlock('SOUL.md', {
      packageTemplate: { packageId: 'pixel', content: '# Soul' },
      role: { id: 'subagent', content: 'must not appear' },
    })
    expect(body).not.toContain('must not appear')
  })

  it('supports the unmanaged-agent recipe (global + team, no package)', () => {
    const body = composeManagedBlock('AGENTS.md', {
      global: PIXEL_INPUTS.global,
      team: PIXEL_INPUTS.team,
    })
    expect(body).toContain('<!-- bakin-section: global -->')
    expect(body).toContain('<!-- bakin-section: team:media -->')
    expect(body).not.toContain('<!-- bakin-section: package -->')
  })

  it('omits absent and empty layers without empty sections', () => {
    const body = composeManagedBlock('AGENTS.md', {
      global: '  \n ',
      packageTemplate: PIXEL_INPUTS.packageTemplate,
    })
    expect(body).not.toContain('bakin-section: global')
    expect(body).not.toContain('bakin-section: team')
    expect(body).toContain('bakin-section: package')
  })

  it('returns null when there is nothing to compose', () => {
    expect(composeManagedBlock('AGENTS.md', {})).toBeNull()
    expect(composeManagedBlock('AGENTS.md', { global: '   ' })).toBeNull()
  })

  it('is deterministic — identical inputs produce identical bytes', () => {
    const a = composeManagedBlock('AGENTS.md', PIXEL_INPUTS)
    const b = composeManagedBlock('AGENTS.md', {
      global: '# Global Rules\n\n- Always log progress',
      team: { id: 'media', content: '# Media Team\n\n- Use the style guide' },
      packageTemplate: {
        packageId: 'pixel',
        content: '# Operating Notes\n\n- Iterate until perfect',
      },
    })
    expect(a).toBe(b)
  })

  it('normalizes trailing whitespace in inputs so shas are stable', () => {
    const a = composeManagedBlock('AGENTS.md', { global: '# Rules\n- one' })
    const b = composeManagedBlock('AGENTS.md', { global: '# Rules\n- one\n\n\n' })
    expect(a).toBe(b)
  })
})

describe('composeManagedBlock — SOUL.md recipe', () => {
  const SOUL_INPUTS: ComposeInputs = {
    packageTemplate: { packageId: 'pixel', content: '# Soul\n\nYou are Pixel.' },
    lessons: {
      packageId: 'pixel',
      entries: [
        { id: 'prompt-style', title: 'Prompt Style', enabled: true, body: '# Prompt Style\n\nBe specific.' },
        { id: 'media-rights', title: 'Media Rights', enabled: false },
      ],
    },
  }

  it('composes package + lessons; ignores global/team layers', () => {
    const body = composeManagedBlock('SOUL.md', {
      ...SOUL_INPUTS,
      global: '# Global Rules — must not appear',
    })
    expect(body).toContain('<!-- bakin-section: package -->')
    expect(body).toContain('<!-- bakin-section: lessons -->')
    expect(body).not.toContain('must not appear')
    const pkgIdx = body!.indexOf('bakin-section: package')
    const lessonsIdx = body!.indexOf('bakin-section: lessons')
    expect(pkgIdx).toBeLessThan(lessonsIdx)
  })

  it('renders the lesson catalog with checkbox state', () => {
    const body = composeManagedBlock('SOUL.md', SOUL_INPUTS)!
    expect(body).toContain('- [x] **Prompt Style** (`prompt-style`)')
    expect(body).toContain('- [ ] **Media Rights** (`media-rights`)')
  })

  it('includes only enabled lesson bodies', () => {
    const body = composeManagedBlock('SOUL.md', SOUL_INPUTS)!
    expect(body).toContain('Be specific.')
    expect(body).not.toContain('Media Rights\n\n#') // no body for disabled
  })

  it('recomposes differently when a lesson is toggled', () => {
    const before = composeManagedBlock('SOUL.md', SOUL_INPUTS)
    const after = composeManagedBlock('SOUL.md', {
      ...SOUL_INPUTS,
      lessons: {
        packageId: 'pixel',
        entries: [
          { id: 'prompt-style', title: 'Prompt Style', enabled: false },
          { id: 'media-rights', title: 'Media Rights', enabled: true, body: '# Media Rights\n\nNo deepfakes.' },
        ],
      },
    })
    expect(before).not.toBe(after)
    expect(after).toContain('No deepfakes.')
    expect(after).not.toContain('Be specific.')
  })

  it('omits the lessons section when the package ships no lessons', () => {
    const body = composeManagedBlock('SOUL.md', {
      packageTemplate: SOUL_INPUTS.packageTemplate,
    })
    expect(body).toContain('bakin-section: package')
    expect(body).not.toContain('bakin-section: lessons')
  })
})

describe('composeManagedBlock — IDENTITY.md / TOOLS.md recipes', () => {
  it('composes the package template only', () => {
    for (const file of ['IDENTITY.md', 'TOOLS.md'] as const) {
      const body = composeManagedBlock(file, {
        ...PIXEL_INPUTS,
        lessons: {
          packageId: 'pixel',
          entries: [{ id: 'x', title: 'X', enabled: true, body: 'nope' }],
        },
      })
      expect(body).toContain('bakin-section: package')
      expect(body).not.toContain('bakin-section: global')
      expect(body).not.toContain('bakin-section: lessons')
    }
  })

  it('returns null for unmanaged agents (no package template)', () => {
    expect(composeManagedBlock('IDENTITY.md', { global: '# G' })).toBeNull()
  })
})

describe('composeFileContent', () => {
  const body = composeManagedBlock('AGENTS.md', PIXEL_INPUTS)!

  it('appends the block to a file without one', () => {
    const existing = '# My Agent Notes\n\nAgent-owned content.\n'
    const next = composeFileContent(existing, body)
    expect(next).toContain('# My Agent Notes')
    expect(hasBlock(next, MANAGED_BLOCK_ID)).toBe(true)
    expect(extractBlock(next, MANAGED_BLOCK_ID)).toBe(body)
  })

  it('creates the file content from scratch when existing is empty', () => {
    const next = composeFileContent('', body)
    expect(hasBlock(next, MANAGED_BLOCK_ID)).toBe(true)
  })

  it('replaces an existing block in place, preserving outside content', () => {
    const existing = composeFileContent('# Above\n\nagent text\n', body) + '\nBelow text.\n'
    const newBody = composeManagedBlock('AGENTS.md', {
      ...PIXEL_INPUTS,
      global: '# Global Rules v2\n\n- New rule',
    })!
    const next = composeFileContent(existing, newBody)
    expect(next).toContain('# Above')
    expect(next).toContain('agent text')
    expect(next).toContain('Below text.')
    expect(extractBlock(next, MANAGED_BLOCK_ID)).toBe(newBody)
    expect(next).toContain('New rule')
    expect(next).not.toContain('Always log progress')
  })

  it('round-trips: replacing with the same body is a byte-level no-op', () => {
    const existing = composeFileContent('agent text\n', body)
    expect(composeFileContent(existing, body)).toBe(existing)
  })
})
