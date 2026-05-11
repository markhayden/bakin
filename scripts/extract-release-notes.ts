/**
 * Extract one concrete CHANGELOG section for GitHub release notes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')

interface ExtractOptions {
  version: string
  changelogPath: string
  outPath: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasBullets(body: string): boolean {
  return /^\s*-\s+\S/m.test(body)
}

export function stripEmptyChangelogSections(body: string): string {
  const lines = body.trim().split('\n')
  const loose: string[] = []
  const order: string[] = []
  const sections = new Map<string, string[]>()
  let current: string | null = null

  for (const line of lines) {
    if (line.startsWith('### ')) {
      current = line
      if (!sections.has(current)) {
        sections.set(current, [])
        order.push(current)
      }
      continue
    }

    if (!current) {
      if (line.trim()) loose.push(line)
      continue
    }

    sections.get(current)?.push(line)
  }

  const chunks = [...loose]
  for (const heading of order) {
    const sectionBody = (sections.get(heading) ?? []).join('\n').trim()
    if (hasBullets(sectionBody)) chunks.push(`${heading}\n${sectionBody}`)
  }

  return chunks.join('\n\n').trim()
}

export function extractReleaseNotes(changelog: string, version: string): string {
  if (!version) throw new Error('version is required')
  const headerRe = new RegExp(`^## \\[${escapeRegExp(version)}\\](?: - .*)?$`, 'm')
  const match = headerRe.exec(changelog)
  if (!match || match.index === undefined) {
    throw new Error(`CHANGELOG.md is missing [${version}]`)
  }
  const bodyStart = match.index + match[0].length
  const next = /^\n(?:## \[[^\]]+\]|\[[^\]]+\]:)/m.exec(changelog.slice(bodyStart))
  const end = next ? bodyStart + next.index : changelog.length
  const notes = changelog.slice(bodyStart, end).trim()
  if (!hasBullets(notes)) {
    throw new Error(`CHANGELOG.md [${version}] has no release-note bullets`)
  }
  return `${stripEmptyChangelogSections(notes)}\n`
}

export function parseArgs(argv: string[]): ExtractOptions {
  let version = ''
  let changelogPath = resolve(REPO_ROOT, 'CHANGELOG.md')
  let outPath = ''

  const takeValue = (index: number, name: string): string => {
    const value = argv[index + 1] ?? ''
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    return value
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--version') {
      version = takeValue(i, '--version')
      i += 1
    } else if (arg === '--changelog') {
      changelogPath = resolve(takeValue(i, '--changelog'))
      i += 1
    } else if (arg === '--out') {
      outPath = resolve(takeValue(i, '--out'))
      i += 1
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  if (!version || !outPath) {
    throw new Error('Usage: bun run scripts/extract-release-notes.ts --version <version> --out <path> [--changelog CHANGELOG.md]')
  }
  return { version, changelogPath, outPath }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const notes = extractReleaseNotes(readFileSync(opts.changelogPath, 'utf-8'), opts.version)
  mkdirSync(dirname(opts.outPath), { recursive: true })
  writeFileSync(opts.outPath, notes, 'utf-8')
  console.log(`Extracted release notes for ${opts.version} to ${opts.outPath}`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
