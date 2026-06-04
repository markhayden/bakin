/**
 * Package signed release binaries into the downloadable artifact shape.
 *
 * Each archive contains one executable named `bakin`. Checksums are computed
 * for the archive files because installers verify exactly what they download.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { createBakinTarGz, releaseArchiveNameForBinary } from '../src/core/release-archive'

const REPO_ROOT = resolve(import.meta.dir, '..')
const DEFAULT_DIST_DIR = resolve(REPO_ROOT, 'dist')

export const RELEASE_BINARIES = [
  'bakin-darwin-arm64',
  'bakin-linux-x64',
  'bakin-linux-arm64',
] as const

export interface PackageReleaseArtifactsOptions {
  distDir: string
  binaries?: readonly string[]
}

export interface PackagedReleaseArtifact {
  binaryName: string
  archiveName: string
  archivePath: string
  sha256: string
  bytes: number
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function packageReleaseArtifacts(opts: PackageReleaseArtifactsOptions): PackagedReleaseArtifact[] {
  const distDir = resolve(opts.distDir)
  const binaries = opts.binaries ?? RELEASE_BINARIES
  mkdirSync(distDir, { recursive: true })

  const artifacts: PackagedReleaseArtifact[] = []
  for (const binaryName of binaries) {
    const binaryPath = join(distDir, binaryName)
    const stat = statSync(binaryPath)
    if (!stat.isFile()) {
      throw new Error(`release binary is not a file: ${binaryPath}`)
    }

    const archiveName = releaseArchiveNameForBinary(binaryName)
    const archivePath = join(distDir, archiveName)
    const archive = createBakinTarGz(readFileSync(binaryPath))
    writeFileSync(archivePath, archive)
    artifacts.push({
      binaryName,
      archiveName,
      archivePath,
      sha256: sha256(archive),
      bytes: archive.length,
    })
  }

  const checksums = artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.archiveName}`)
    .join('\n')
  writeFileSync(join(distDir, 'checksums.txt'), `${checksums}\n`, 'utf-8')
  return artifacts
}

function takeValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1] ?? ''
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function parseArgs(argv: string[]): PackageReleaseArtifactsOptions {
  let distDir = DEFAULT_DIST_DIR

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dist') {
      distDir = resolve(takeValue(argv, i, '--dist'))
      i += 1
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  return { distDir }
}

async function main(): Promise<void> {
  const artifacts = packageReleaseArtifacts(parseArgs(process.argv.slice(2)))
  for (const artifact of artifacts) {
    console.log(`${artifact.archiveName}: ${artifact.bytes} bytes`)
  }
  console.log(`Wrote checksums.txt for ${artifacts.length} release archives`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
