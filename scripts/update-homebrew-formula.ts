/**
 * Render the Bakin Homebrew formula from release checksums.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const DEFAULT_TEMPLATE = resolve(REPO_ROOT, 'homebrew/bakin.rb')

interface FormulaOptions {
  version: string
  checksumsPath: string
  outPath: string
  templatePath: string
}

const REQUIRED_ASSETS = [
  {
    name: 'bakin-darwin-arm64',
    placeholder: '__SHA256_DARWIN_ARM64__',
  },
  {
    name: 'bakin-linux-x64',
    placeholder: '__SHA256_LINUX_X64__',
  },
  {
    name: 'bakin-linux-arm64',
    placeholder: '__SHA256_LINUX_ARM64__',
  },
] as const

export function parseChecksums(content: string): Map<string, string> {
  const checksums = new Map<string, string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(trimmed)
    if (!match) throw new Error(`Malformed checksum line: ${line}`)
    checksums.set(match[2].trim(), match[1].toLowerCase())
  }
  return checksums
}

export function renderHomebrewFormula(opts: {
  template: string
  version: string
  checksums: Map<string, string>
}): string {
  if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(opts.version)) {
    throw new Error('version must be MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-rc.N')
  }

  let formula = opts.template.replaceAll('__VERSION__', opts.version)
  for (const asset of REQUIRED_ASSETS) {
    const checksum = opts.checksums.get(asset.name)
    if (!checksum) throw new Error(`checksums.txt is missing ${asset.name}`)
    formula = formula.replaceAll(asset.placeholder, checksum)
  }

  const unresolved = formula.match(/__[A-Z0-9_]+__/g)
  if (unresolved) {
    throw new Error(`Homebrew formula still contains placeholders: ${[...new Set(unresolved)].join(', ')}`)
  }
  return formula
}

function takeValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1] ?? ''
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export function parseArgs(argv: string[]): FormulaOptions {
  let version = ''
  let checksumsPath = ''
  let outPath = ''
  let templatePath = DEFAULT_TEMPLATE

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--version') {
      version = takeValue(argv, i, '--version')
      i += 1
    } else if (arg === '--checksums') {
      checksumsPath = resolve(takeValue(argv, i, '--checksums'))
      i += 1
    } else if (arg === '--out') {
      outPath = resolve(takeValue(argv, i, '--out'))
      i += 1
    } else if (arg === '--template') {
      templatePath = resolve(takeValue(argv, i, '--template'))
      i += 1
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  if (!version || !checksumsPath || !outPath) {
    throw new Error('Usage: bun run scripts/update-homebrew-formula.ts --version <version> --checksums <checksums.txt> --out <Formula/bakin.rb> [--template homebrew/bakin.rb]')
  }

  return { version, checksumsPath, outPath, templatePath }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const formula = renderHomebrewFormula({
    template: readFileSync(opts.templatePath, 'utf-8'),
    version: opts.version,
    checksums: parseChecksums(readFileSync(opts.checksumsPath, 'utf-8')),
  })
  mkdirSync(dirname(opts.outPath), { recursive: true })
  writeFileSync(opts.outPath, formula, 'utf-8')
  console.log(`Rendered Homebrew formula for ${opts.version} to ${opts.outPath}`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
