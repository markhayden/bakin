export const PLUGIN_INSTALL_USAGE =
  'Usage: bakin plugins install [--dev] <path|github:user/repo[@ref][#subpath]> [--ref <ref>] [--yes] [--force]'

export interface ParsedPluginInstallArgs {
  source?: string
  ref?: string
  yes: boolean
  dev: boolean
  force: boolean
  error?: string
}

export function parsePluginInstallArgs(args: string[]): ParsedPluginInstallArgs {
  const parsed: ParsedPluginInstallArgs = {
    yes: false,
    dev: false,
    force: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--yes') {
      parsed.yes = true
      continue
    }
    if (arg === '--dev') {
      parsed.dev = true
      continue
    }
    if (arg === '--force') {
      parsed.force = true
      continue
    }
    if (arg === '--ref') {
      const ref = args[i + 1]
      if (!ref || ref.startsWith('--')) {
        return { ...parsed, error: '--ref requires a value' }
      }
      parsed.ref = ref
      i++
      continue
    }
    if (arg.startsWith('--ref=')) {
      const ref = arg.slice('--ref='.length)
      if (!ref) return { ...parsed, error: '--ref requires a value' }
      parsed.ref = ref
      continue
    }
    if (arg.startsWith('--')) {
      return { ...parsed, error: `unknown plugins install flag: ${arg}` }
    }
    if (parsed.source) {
      return { ...parsed, error: `multiple plugin install sources provided: ${parsed.source}, ${arg}` }
    }
    parsed.source = arg
  }

  if (!parsed.source) {
    return { ...parsed, error: 'missing plugin install source' }
  }
  return parsed
}
