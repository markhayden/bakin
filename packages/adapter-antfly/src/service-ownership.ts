/** Ownership is the home recorded in Bakin's unit, never just a shared data inode. */
import { lstatSync, readFileSync, realpathSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'

export type OwnershipKind = 'owner' | 'foreign-home' | 'temporary-home' | 'unclaimed-home' | 'unknown-owner'
export interface ServiceOwnership {
  kind: OwnershipKind
  home: string
  ownerHome?: string
  unitPath?: string
  detail: string
  /** Malformed unit evidence can be replaced deliberately; unsafe paths cannot. */
  claimable: boolean
}

/** Resolve existing ancestors without creating a home or following dangling links. */
export function canonicalPath(path: string): string {
  const absolute = resolve(path)
  try {
    lstatSync(absolute)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const parent = dirname(absolute)
    if (parent === absolute) throw err
    return join(canonicalPath(parent), basename(absolute))
  }
  return realpathSync(absolute)
}

function within(path: string, root: string): boolean {
  const suffix = relative(root, path)
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}

function decodeXml(value: string): string {
  return value.replace(/&([^;]*);|&/g, (entity, name: string | undefined) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (name && name in named) return named[name]
    if (name && /^#(?:[0-9]+|x[0-9a-f]+)$/i.test(name)) {
      const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      if (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) return String.fromCodePoint(n)
    }
    throw new Error(`Unsupported XML entity ${entity}`)
  })
}

/** Supported generated ExecStart syntax only. Expansion must be escaped literally. */
function systemdArgs(command: string): string[] {
  const args: string[] = []
  let rest = command.trim()
  while (rest) {
    const token = /^(?:"((?:[^"\\]|\\[\\"'])*)"|'([^']*)'|([^\s"'\\]+))(?:\s+|$)/.exec(rest)
    if (!token) throw new Error('Unsupported ExecStart quoting')
    const raw = (token[1] ?? token[2] ?? token[3]).replace(/\\([\\"'])/g, '$1')
    if (/[$%]/.test(raw.replace(/\$\$|%%/g, ''))) throw new Error('Unsupported ExecStart expansion')
    args.push(raw.replace(/\$\$/g, '$').replace(/%%/g, '%'))
    rest = rest.slice(token[0].length)
  }
  return args
}

export function unitDataDir(content: string, mode: 'launchd' | 'systemd'): string {
  let args: string[]
  if (mode === 'launchd') {
    const arrays = [...content.matchAll(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/g)]
    if (arrays.length !== 1 || (content.match(/<key>ProgramArguments<\/key>/g)?.length ?? 0) !== 1) throw new Error('Ambiguous ProgramArguments')
    const body = arrays[0][1]
    if (body.replace(/<string>[^<]*<\/string>/g, '').trim()) throw new Error('Unsupported ProgramArguments')
    args = [...body.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => decodeXml(m[1]))
  } else {
    let section = ''
    const commands: string[] = []
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim()
      if (line.startsWith('[')) section = line
      if (section === '[Service]' && /^ExecStart\s*=/.test(line)) commands.push(line.slice(line.indexOf('=') + 1))
    }
    if (commands.length !== 1) throw new Error('Ambiguous ExecStart')
    args = systemdArgs(commands[0])
  }
  const flags = args.filter((arg) => arg === '--data-dir' || arg.startsWith('--data-dir='))
  if (flags.length !== 1 || flags[0] !== '--data-dir') throw new Error('Expected one --data-dir argument')
  const dataDir = args[args.indexOf('--data-dir') + 1]
  if (!dataDir || !isAbsolute(dataDir) || basename(dataDir) !== 'antfly') throw new Error('Expected an absolute <home>/antfly data directory')
  return dataDir
}

export function evaluateOwnership(input: {
  home: string
  tempRoots: readonly string[]
  unitPath?: string
  mode?: 'launchd' | 'systemd'
}): ServiceOwnership {
  const result = (kind: OwnershipKind, detail: string, claimable: boolean, ownerHome?: string): ServiceOwnership =>
    ({ kind, home: input.home, unitPath: input.unitPath, detail, claimable, ...(ownerHome ? { ownerHome } : {}) })
  let home: string
  try {
    home = canonicalPath(input.home)
    if (input.tempRoots.some((root) => within(home, canonicalPath(root)))) {
      return result('temporary-home', `Temporary home ${input.home} cannot manage the shared search service. Configure an isolated search endpoint.`, false)
    }
    try {
      if (lstatSync(join(home, 'antfly')).isSymbolicLink()) {
        return result('unknown-owner', `Search data in ${home} is a symlink. Use a whole-home symlink instead so indexes and home metadata remain together.`, false)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  } catch (err) {
    return result('unknown-owner', `Cannot establish search home identity: ${String(err)}`, false)
  }
  if (!input.unitPath || !input.mode) return result('owner', 'Strict child in a home without an OS supervisor.', true)
  let content: string
  try {
    content = readFileSync(input.unitPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return result('unclaimed-home', `Search service is unclaimed for ${home}. Run bakin install search from this permanent home, then restart Bakin.`, true)
    return result('unknown-owner', `Cannot read service unit ${input.unitPath}: ${String(err)}`, false)
  }
  try {
    const ownerHome = canonicalPath(dirname(unitDataDir(content, input.mode)))
    if (ownerHome !== home) return result('foreign-home', `Search service ${input.unitPath} belongs to ${ownerHome}, not ${home}. Use an isolated endpoint, or stop the prior Bakin process and deliberately run bakin install search from this permanent home.`, true, ownerHome)
    return result('owner', `Search service belongs to ${home}.`, true, ownerHome)
  } catch (err) {
    return result('unknown-owner', `Cannot establish the owner of ${input.unitPath}: ${String(err)}. Deliberate installation can replace malformed configuration.`, true)
  }
}
