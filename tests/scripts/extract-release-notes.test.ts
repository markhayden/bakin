import { describe, expect, it } from 'bun:test'
import { extractReleaseNotes, parseArgs } from '../../scripts/extract-release-notes'

const changelog = `# Changelog

## [Unreleased]

### Added
- Future thing.

## [0.2.0] - 2026-05-05

### Added
- Release automation.

### Fixed
- Stable release notes.

## [0.1.0] - 2026-05-05

### Added
- Initial public release.
`

describe('extractReleaseNotes', () => {
  it('extracts the concrete version section only', () => {
    const notes = extractReleaseNotes(changelog, '0.2.0')

    expect(notes).toContain('### Added')
    expect(notes).toContain('- Release automation.')
    expect(notes).toContain('### Fixed')
    expect(notes).not.toContain('Future thing')
    expect(notes).not.toContain('Initial public release')
    expect(notes.endsWith('\n')).toBe(true)
  })

  it('fails when the version section is missing or empty', () => {
    expect(() => extractReleaseNotes(changelog, '9.9.9')).toThrow('missing [9.9.9]')
    expect(() => extractReleaseNotes('## [0.1.0]\n\n### Added\n', '0.1.0')).toThrow('no release-note bullets')
  })
})

describe('parseArgs', () => {
  it('parses required inputs', () => {
    expect(parseArgs(['--version', '0.2.0', '--out', '/tmp/notes.md'])).toMatchObject({
      version: '0.2.0',
      outPath: '/tmp/notes.md',
    })
  })

  it('rejects incomplete input', () => {
    expect(() => parseArgs(['--version', '--out'])).toThrow('requires a value')
    expect(() => parseArgs(['--version', '0.2.0'])).toThrow('Usage')
  })
})
