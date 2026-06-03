import { describe, expect, it } from 'bun:test'
import {
  parsePrepArgs,
  prepareChangelog,
  targetTagForPrep,
} from '../../scripts/prep-release'

describe('prep-release args', () => {
  it('parses bump commands', () => {
    expect(parsePrepArgs(['minor', '--create-branch', '--dry-run'], '2026-05-11')).toEqual({
      bump: 'minor',
      version: '',
      prerelease: false,
      date: '2026-05-11',
      dryRun: true,
      createBranch: true,
    })
  })

  it('parses explicit versions', () => {
    expect(parsePrepArgs(['--version', '0.1.0', '--date', '2026-05-12'], '2026-05-11')).toMatchObject({
      bump: null,
      version: '0.1.0',
      date: '2026-05-12',
    })
  })

  it('rejects ambiguous inputs', () => {
    expect(() => parsePrepArgs(['minor', '--version', '0.2.0'])).toThrow('either a bump type or --version')
    expect(() => parsePrepArgs(['--version', 'bad'])).toThrow('version must be')
  })
})

describe('targetTagForPrep', () => {
  it('starts an unpublished project at v0.1.0', () => {
    const opts = parsePrepArgs(['minor'], '2026-05-11')
    expect(targetTagForPrep(opts, [])).toBe('v0.1.0')
  })

  it('starts an unpublished patch release at v0.0.1', () => {
    const opts = parsePrepArgs(['patch', '--rc'], '2026-05-11')
    expect(targetTagForPrep(opts, [])).toBe('v0.0.1-rc.1')
  })

  it('uses remote tags to compute the next version', () => {
    const opts = parsePrepArgs(['patch'], '2026-05-11')
    expect(targetTagForPrep(opts, ['v0.1.0'])).toBe('v0.1.1')
  })

  it('lets explicit versions override computed versions', () => {
    const opts = parsePrepArgs(['--version', '0.1.0'], '2026-05-11')
    expect(targetTagForPrep(opts, ['v2.0.0'])).toBe('v0.1.0')
  })
})

describe('prepareChangelog', () => {
  it('moves Unreleased notes into the target version', () => {
    const changelog = `# Changelog

## [Unreleased]

### Added
- New thing.

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.1.0...HEAD
`
    const result = prepareChangelog(changelog, 'v0.2.0', '2026-05-11')

    expect(result.changed).toBe(true)
    expect(result.bulletCount).toBe(1)
    expect(result.changelog).toContain('## [0.2.0] - 2026-05-11')
    expect(result.changelog).toContain('- New thing.')
    expect(result.changelog).toContain('[0.2.0]: https://github.com/markhayden/bakin/releases/tag/v0.2.0')
  })

  it('scaffolds an empty placeholder section when Unreleased has no bullets', () => {
    const changelog = `# Changelog

## [Unreleased]

## [0.0.1-rc.9] - 2026-06-01

### Added
- Previous thing.

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.0.1-rc.9...HEAD
`
    const result = prepareChangelog(changelog, 'v0.0.1-rc.10', '2026-06-02')

    expect(result.changed).toBe(true)
    expect(result.bulletCount).toBe(0)
    expect(result.changelog).toContain('## [0.0.1-rc.10] - 2026-06-02')
    expect(result.changelog).toContain('### Added')
    expect(result.changelog).toContain('### Changed')
    expect(result.changelog).toContain('### Fixed')
    // Earlier notes are preserved.
    expect(result.changelog).toContain('- Previous thing.')
    // [Unreleased] stays empty.
    expect(result.changelog).toMatch(/## \[Unreleased\]\s+## \[0\.0\.1-rc\.10\]/)
  })

  it('reports zero bullets for an existing but empty scaffolded section', () => {
    const changelog = `# Changelog

## [Unreleased]

## [0.0.1-rc.10] - 2026-06-02

### Added

### Changed

### Fixed
`
    const result = prepareChangelog(changelog, 'v0.0.1-rc.10', '2026-06-02')

    expect(result.changed).toBe(false)
    expect(result.bulletCount).toBe(0)
    expect(result.changelog).toBe(changelog)
  })

  it('is idempotent when the target version section already exists', () => {
    const changelog = `# Changelog

## [Unreleased]

## [0.1.0] - 2026-05-11

### Added
- Initial public release.
`
    const result = prepareChangelog(changelog, 'v0.1.0', '2026-05-11')

    expect(result.changed).toBe(false)
    expect(result.bulletCount).toBe(1)
    expect(result.changelog).toBe(changelog)
  })
})
