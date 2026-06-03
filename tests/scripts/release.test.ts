import { describe, expect, it } from 'bun:test'
import {
  assertHasUnreleasedBullets,
  moveReleaseNotesToVersion,
  moveUnreleasedToVersion,
  parseArgs,
  parseReleaseTag,
  releaseNotesForTarget,
  releaseWorkflowUrlFromRuns,
  resolveReleaseTarget,
  scaffoldVersionSection,
} from '../../scripts/release'

describe('parseReleaseTag', () => {
  it('parses stable and rc tags', () => {
    expect(parseReleaseTag('v0.2.0')).toEqual({
      tag: 'v0.2.0',
      version: '0.2.0',
      major: 0,
      minor: 2,
      patch: 0,
      rc: null,
    })
    expect(parseReleaseTag('v1.2.3-rc.4')?.rc).toBe(4)
  })

  it('rejects malformed tags', () => {
    expect(parseReleaseTag('v0.2.0-dev.1')).toBeNull()
    expect(parseReleaseTag('search-checkpoint-5')).toBeNull()
  })
})

describe('resolveReleaseTarget', () => {
  it('starts unpublished release lines from the requested bump', () => {
    expect(resolveReleaseTarget([], { verb: 'minor', prerelease: false })).toBe('v0.1.0')
    expect(resolveReleaseTarget([], { verb: 'patch', prerelease: true })).toBe('v0.0.1-rc.1')
  })

  it('bumps stable versions', () => {
    const tags = ['v0.2.0', 'v0.2.1', 'v0.3.0']
    expect(resolveReleaseTarget(tags, { verb: 'patch', prerelease: false })).toBe('v0.3.1')
    expect(resolveReleaseTarget(tags, { verb: 'minor', prerelease: false })).toBe('v0.4.0')
    expect(resolveReleaseTarget(tags, { verb: 'major', prerelease: false })).toBe('v1.0.0')
  })

  it('increments an rc line for the same target', () => {
    const tags = ['v0.3.0', 'v0.4.0-rc.1', 'v0.4.0-rc.2']
    expect(resolveReleaseTarget(tags, { verb: 'minor', prerelease: true })).toBe('v0.4.0-rc.3')
  })

  it('fails stable releases while an rc is in flight', () => {
    expect(() => resolveReleaseTarget(['v0.3.0', 'v0.4.0-rc.1'], {
      verb: 'patch',
      prerelease: false,
    })).toThrow('release candidate is in flight')
  })

  it('fails malformed v-prefixed tags instead of ignoring them', () => {
    expect(() => resolveReleaseTarget(['v0.3.0', 'v0.4.0-beta.1'], {
      verb: 'patch',
      prerelease: false,
    })).toThrow('Malformed release tag')
  })

  it('promotes the latest rc to stable', () => {
    expect(resolveReleaseTarget(['v0.3.0', 'v0.4.0-rc.2'], {
      verb: 'promote',
      prerelease: false,
    })).toBe('v0.4.0')
  })
})

describe('parseArgs', () => {
  it('parses write and dry-run release commands', () => {
    expect(parseArgs(['minor', '--rc', '--dry-run'])).toEqual({
      verb: 'minor',
      prerelease: true,
      dryRun: true,
      yes: false,
    })
  })

  it('rejects ambiguous command shapes', () => {
    expect(() => parseArgs(['patch', 'minor'])).toThrow('Unexpected release arguments')
    expect(() => parseArgs(['promote', '--rc'])).toThrow('cannot be combined')
  })
})

describe('release workflow URL discovery', () => {
  it('returns the tag-triggered release run URL', () => {
    const runs = JSON.stringify([
      { headBranch: 'main', url: 'https://github.com/markhayden/bakin/actions/runs/old' },
      { headBranch: 'v0.1.0-rc.9', url: 'https://github.com/markhayden/bakin/actions/runs/next' },
    ])

    expect(releaseWorkflowUrlFromRuns(runs, 'v0.1.0-rc.9')).toBe('https://github.com/markhayden/bakin/actions/runs/next')
  })

  it('does not report stale release workflow runs for other refs', () => {
    const runs = JSON.stringify([
      { headBranch: 'v0.1.0-rc.8', url: 'https://github.com/markhayden/bakin/actions/runs/old' },
    ])

    expect(releaseWorkflowUrlFromRuns(runs, 'v0.1.0-rc.9')).toBeNull()
  })
})

describe('CHANGELOG helpers', () => {
  const changelog = `# Changelog

## [Unreleased]

### Added
- Release script.

### Fixed
- Another thing.

## [0.1.0] - 2026-05-05

### Added
- Initial public release.
`

  it('detects non-empty Unreleased bullets', () => {
    expect(assertHasUnreleasedBullets(changelog)).toBeUndefined()
    expect(() => assertHasUnreleasedBullets('# Changelog\n\n## [Unreleased]\n\n### Added\n')).toThrow('[Unreleased]')
  })

  it('scaffolds an empty version section when absent', () => {
    const next = scaffoldVersionSection(changelog, '0.2.0', '2026-05-05')
    expect(next).toContain('## [0.2.0] - 2026-05-05')
    expect(next).toContain('### Added')
    expect(next).toContain('### Changed')
    expect(next).toContain('### Fixed')
  })

  it('never overwrites an existing version section', () => {
    const withSection = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-05-05

### Added
- Hand-written note that must survive.
`
    const next = scaffoldVersionSection(withSection, '0.2.0', '2026-05-05')
    expect(next).toBe(withSection)
    expect(next).toContain('- Hand-written note that must survive.')
  })

  it('moves Unreleased notes into a concrete version', () => {
    const next = moveUnreleasedToVersion(changelog, '0.2.0', '2026-05-05')

    expect(next).toContain('## [Unreleased]\n\n## [0.2.0] - 2026-05-05')
    expect(next).toContain('- Release script.')
    expect(next).toContain('[Unreleased]: https://github.com/markhayden/bakin/compare/v0.2.0...HEAD')
    expect(next).toContain('[0.2.0]: https://github.com/markhayden/bakin/releases/tag/v0.2.0')
  })

  it('promotes stable notes from the matching rc section when Unreleased is empty', () => {
    const afterRc = `# Changelog

## [Unreleased]

### Fixed
- Final polish.

## [0.2.0-rc.2] - 2026-05-05

### Fixed
- Release pipeline fix.

## [0.2.0-rc.1] - 2026-05-05

### Added
- Release pipeline.

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.2.0-rc.2...HEAD
[0.2.0-rc.2]: https://github.com/markhayden/bakin/releases/tag/v0.2.0-rc.2
[0.2.0-rc.1]: https://github.com/markhayden/bakin/releases/tag/v0.2.0-rc.1
`
    const target = parseReleaseTag('v0.2.0')!
    const notes = releaseNotesForTarget(afterRc, target, { verb: 'promote' }, ['v0.2.0-rc.1', 'v0.2.0-rc.2'])
    expect(notes.bulletCount).toBe(3)
    expect(notes.body).toContain('### Added')
    expect(notes.body).toContain('- Release pipeline.')
    expect(notes.body).toContain('### Fixed')
    expect(notes.body).toContain('- Release pipeline fix.')
    expect(notes.body).toContain('- Final polish.')

    const promoted = moveReleaseNotesToVersion(afterRc, target, '2026-05-06', {
      verb: 'promote',
      tags: ['v0.2.0-rc.1', 'v0.2.0-rc.2'],
    })
    expect(promoted).toContain('## [0.2.0] - 2026-05-06')
    expect(promoted).not.toContain('## [0.2.0-rc.1] - 2026-05-05')
    expect(promoted).not.toContain('## [0.2.0-rc.2] - 2026-05-05')
    expect(promoted).not.toContain('[0.2.0-rc.1]:')
    expect(promoted).not.toContain('[0.2.0-rc.2]:')
    expect(promoted).toContain('[0.2.0]: https://github.com/markhayden/bakin/releases/tag/v0.2.0')
  })
})
