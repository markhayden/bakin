import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parseArgs,
  parseChecksums,
  renderHomebrewFormula,
} from '../../scripts/update-homebrew-formula'

const template = readFileSync(resolve(import.meta.dir, '../../homebrew/bakin.rb'), 'utf-8')
const checksumsText = readFileSync(resolve(import.meta.dir, '../fixtures/release/checksums.txt'), 'utf-8')

describe('parseChecksums', () => {
  it('parses sha256sum output by filename', () => {
    const checksums = parseChecksums(checksumsText)

    expect(checksums.get('bakin-darwin-arm64.tar.gz')).toBe('a'.repeat(64))
    expect(checksums.get('bakin-linux-x64.tar.gz')).toBe('b'.repeat(64))
    expect(checksums.get('bakin-linux-arm64.tar.gz')).toBe('c'.repeat(64))
  })

  it('rejects malformed checksum lines', () => {
    expect(() => parseChecksums('not-a-checksum  bakin-darwin-arm64.tar.gz')).toThrow('Malformed')
  })
})

describe('renderHomebrewFormula', () => {
  it('renders release URLs and checksums for every supported binary', () => {
    const formula = renderHomebrewFormula({
      template,
      version: '0.1.0',
      checksums: parseChecksums(checksumsText),
    })

    expect(formula).toContain('https://github.com/markhayden/bakin/releases/download/v0.1.0/bakin-darwin-arm64.tar.gz')
    expect(formula).toContain('https://github.com/markhayden/bakin/releases/download/v0.1.0/bakin-linux-x64.tar.gz')
    expect(formula).toContain('https://github.com/markhayden/bakin/releases/download/v0.1.0/bakin-linux-arm64.tar.gz')
    expect(formula).toContain(`sha256 "${'a'.repeat(64)}"`)
    expect(formula).toContain(`sha256 "${'b'.repeat(64)}"`)
    expect(formula).toContain(`sha256 "${'c'.repeat(64)}"`)
    expect(formula).not.toMatch(/__[A-Z0-9_]+__/)
  })

  it('supports rc formula rendering for workflow dry-runs', () => {
    const formula = renderHomebrewFormula({
      template,
      version: '0.1.0-rc.1',
      checksums: parseChecksums(checksumsText),
    })

    expect(formula).toContain('/download/v0.1.0-rc.1/bakin-darwin-arm64.tar.gz')
  })

  it('fails loudly when a required checksum is missing', () => {
    const checksums = parseChecksums(checksumsText)
    checksums.delete('bakin-linux-arm64.tar.gz')

    expect(() => renderHomebrewFormula({ template, version: '0.1.0', checksums })).toThrow('missing bakin-linux-arm64.tar.gz')
  })
})

describe('parseArgs', () => {
  it('parses required inputs', () => {
    expect(parseArgs([
      '--version',
      '0.1.0',
      '--checksums',
      'dist/checksums.txt',
      '--out',
      '/tmp/bakin.rb',
    ])).toMatchObject({
      version: '0.1.0',
      outPath: '/tmp/bakin.rb',
    })
  })

  it('rejects missing inputs', () => {
    expect(() => parseArgs(['--version', '0.1.0'])).toThrow('Usage')
    expect(() => parseArgs(['--checksums', '--out'])).toThrow('requires a value')
  })
})
