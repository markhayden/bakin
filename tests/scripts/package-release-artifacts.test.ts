import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { extractBakinFromTarGz } from '../../src/core/release-archive'
import { packageReleaseArtifacts } from '../../scripts/package-release-artifacts'

const tmpRoots: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bakin-package-release-artifacts-'))
  tmpRoots.push(dir)
  return dir
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('packageReleaseArtifacts', () => {
  it('packages release binaries as tar.gz archives and writes archive checksums', () => {
    const distDir = makeTempDir()
    const binaryPath = join(distDir, 'bakin-linux-x64')
    const binary = Buffer.from('fake-linux-binary')
    writeFileSync(binaryPath, binary)

    const artifacts = packageReleaseArtifacts({
      distDir,
      binaries: ['bakin-linux-x64'],
    })

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.archiveName).toBe('bakin-linux-x64.tar.gz')

    const archive = readFileSync(join(distDir, 'bakin-linux-x64.tar.gz'))
    expect(extractBakinFromTarGz(archive).toString('utf-8')).toBe('fake-linux-binary')
    expect(readFileSync(join(distDir, 'checksums.txt'), 'utf-8')).toBe(
      `${sha256(archive)}  bakin-linux-x64.tar.gz\n`,
    )
  })
})
