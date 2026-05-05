# Changelog

All notable changes to Bakin are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with Bakin versions driven by git tags.

## [Unreleased]

### Added

### Changed

### Fixed
- Dispatch post-publish smoke explicitly after releases created by `GITHUB_TOKEN`.

### Removed

### Security

## [0.1.0-rc.7] - 2026-05-05

### Added

### Changed

### Fixed
- Reuse the draft GitHub release id when publishing a release.

### Removed

### Security

## [0.1.0-rc.6] - 2026-05-05

### Added

### Changed

### Fixed
- Publish the SDK without npm provenance when the source repository is private.

### Removed

### Security

## [0.1.0-rc.5] - 2026-05-05

### Added

### Changed

### Fixed
- Ignore non-numeric GitHub release lookup responses before creating draft releases.

### Removed

### Security

## [0.1.0-rc.4] - 2026-05-05

### Added

### Changed

### Fixed
- Treat codesign verification and Apple notarization acceptance as the macOS gate for standalone CLI binaries.

### Removed

### Security

## [0.1.0-rc.3] - 2026-05-05

### Added

### Changed

### Fixed
- Allow the macOS signing script to read GitHub Actions secrets from `process.env`.

### Removed

### Security

## [0.1.0-rc.2] - 2026-05-05

### Added

### Changed

### Fixed
- Stamp release versions before compiling binaries so `bakin --version` matches the release tag.

### Removed

### Security

## [0.1.0-rc.1] - 2026-05-05

### Added
- Initial public release: signed binaries, npm SDK publishing, Homebrew tap automation, and release smoke checks.

### Changed

### Fixed

### Removed

### Security

[0.1.0-rc.1]: https://github.com/markhayden/bakin/releases/tag/v0.1.0-rc.1

[0.1.0-rc.2]: https://github.com/markhayden/bakin/releases/tag/v0.1.0-rc.2

[0.1.0-rc.3]: https://github.com/markhayden/bakin/releases/tag/v0.1.0-rc.3

[0.1.0-rc.4]: https://github.com/markhayden/bakin/releases/tag/v0.1.0-rc.4

[0.1.0-rc.5]: https://github.com/markhayden/bakin/releases/tag/v0.1.0-rc.5

[0.1.0-rc.6]: https://github.com/markhayden/bakin/releases/tag/v0.1.0-rc.6

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.1.0-rc.7...HEAD
[0.1.0-rc.7]: https://github.com/markhayden/bakin/releases/tag/v0.1.0-rc.7
