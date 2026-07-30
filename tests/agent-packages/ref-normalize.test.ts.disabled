/**
 * Paste-a-link normalization (#687, D2): the user copies a clawhub.ai or
 * github.com page URL — or types a scheme ref — and every surface funnels
 * through ONE pure normalizer. Garbage gets a typed, actionable error.
 */
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-ref-normalize-${Date.now()}`)

import { describe, expect, it, mock } from 'bun:test'

// Pure module — mocks are the uniform belt-and-suspenders for this feature dir.
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

import { normalizeSkillRef, parseClawhubRef } from '../../src/core/agent-packages/ref-normalize'

describe('normalizeSkillRef — URLs', () => {
  it('clawhub.ai skill page URL → clawhub ref', () => {
    expect(normalizeSkillRef('https://clawhub.ai/steipete/skills/weather'))
      .toEqual({ ok: true, ref: 'clawhub:@steipete/weather' })
    // Trailing slash, http, www, query junk all normalize.
    expect(normalizeSkillRef('http://www.clawhub.ai/steipete/skills/weather/?utm_source=x'))
      .toEqual({ ok: true, ref: 'clawhub:@steipete/weather' })
  })

  it('github tree URL → github ref with @ref and #subpath', () => {
    expect(normalizeSkillRef('https://github.com/badlogic/pi-skills/tree/main/brave-search'))
      .toEqual({ ok: true, ref: 'github:badlogic/pi-skills@main#brave-search' })
    expect(normalizeSkillRef('https://github.com/anthropics/skills/tree/v1.2.0/document-skills/pdf'))
      .toEqual({ ok: true, ref: 'github:anthropics/skills@v1.2.0#document-skills/pdf' })
  })

  it('github repo root URL → bare github ref', () => {
    expect(normalizeSkillRef('https://github.com/badlogic/pi-skills'))
      .toEqual({ ok: true, ref: 'github:badlogic/pi-skills' })
  })

  it('github blob URL to a SKILL.md → its parent directory', () => {
    expect(normalizeSkillRef('https://github.com/badlogic/pi-skills/blob/main/brave-search/SKILL.md'))
      .toEqual({ ok: true, ref: 'github:badlogic/pi-skills@main#brave-search' })
  })
})

describe('normalizeSkillRef — scheme refs and local paths', () => {
  it('passes through valid scheme refs', () => {
    for (const ref of [
      'clawhub:@steipete/weather',
      'clawhub:weather',
      'clawhub:@steipete/weather@2.0.1',
      'github:badlogic/pi-skills@main#brave-search',
      'github:owner/repo',
    ]) {
      expect(normalizeSkillRef(ref)).toEqual({ ok: true, ref })
    }
  })

  it('passes through local paths', () => {
    for (const ref of ['./my-skill', '../skills/foo', '/abs/path/skill', '~/skills/bar']) {
      expect(normalizeSkillRef(ref)).toEqual({ ok: true, ref })
    }
  })

  it('rejects garbage with an actionable message', () => {
    for (const bad of ['', 'not a ref', 'https://example.com/foo', 'clawhub:', 'github:', 'https://clawhub.ai/', 'ftp://x/y']) {
      const result = normalizeSkillRef(bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/clawhub|github|path/i)
    }
  })
})

describe('parseClawhubRef', () => {
  it('parses owner, slug, and version forms', () => {
    expect(parseClawhubRef('clawhub:@steipete/weather')).toEqual({ owner: 'steipete', slug: 'weather' })
    expect(parseClawhubRef('clawhub:@steipete/weather@2.0.1')).toEqual({ owner: 'steipete', slug: 'weather', version: '2.0.1' })
    expect(parseClawhubRef('clawhub:weather')).toEqual({ slug: 'weather' })
    expect(parseClawhubRef('clawhub:weather@2.0.1')).toEqual({ slug: 'weather', version: '2.0.1' })
  })

  it('throws on malformed refs', () => {
    for (const bad of ['clawhub:', 'clawhub:@/x', 'clawhub:@owner/', 'github:x/y', 'clawhub:UPPER CASE']) {
      expect(() => parseClawhubRef(bad)).toThrow()
    }
  })
})
