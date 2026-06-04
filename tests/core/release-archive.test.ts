import { describe, expect, it } from 'bun:test'
import { gzipSync } from 'node:zlib'

import {
  createBakinTarGz,
  extractBakinFromTarGz,
  releaseArchiveNameForBinary,
  releaseArchiveNameForTriple,
  releaseBinaryNameForTriple,
} from '../../src/core/release-archive'

describe('release archive helpers', () => {
  it('derives release binary and archive names from triples', () => {
    expect(releaseBinaryNameForTriple('linux-x64')).toBe('bakin-linux-x64')
    expect(releaseArchiveNameForBinary('bakin-linux-x64')).toBe('bakin-linux-x64.tar.gz')
    expect(releaseArchiveNameForTriple('linux-x64')).toBe('bakin-linux-x64.tar.gz')
  })

  it('round-trips the executable as bakin inside a tar.gz archive', () => {
    const binary = Buffer.from('#!/usr/bin/env bash\necho bakin\n')
    const archive = createBakinTarGz(binary)

    expect(extractBakinFromTarGz(archive).toString('utf-8')).toBe(binary.toString('utf-8'))
  })

  it('fails loudly when the archive does not contain bakin', () => {
    const emptyTar = Buffer.alloc(1024)

    expect(() => extractBakinFromTarGz(gzipSync(emptyTar))).toThrow('archive is missing bakin')
  })
})
