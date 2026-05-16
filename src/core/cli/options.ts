export interface CliGlobalOptions {
  json: boolean
  verbose: boolean
  color: boolean
  help: boolean
  version: boolean
  yes: boolean
  force: boolean
}

export interface ParsedCliGlobalOptions {
  options: CliGlobalOptions
  args: string[]
  passthrough: string[]
  endOfOptions: boolean
}

const DEFAULT_OPTIONS: CliGlobalOptions = {
  json: false,
  verbose: false,
  color: true,
  help: false,
  version: false,
  yes: false,
  force: false,
}

function colorDefault(): boolean {
  return !process.env.NO_COLOR && process.env.BAKIN_NO_COLOR !== '1'
}

export function defaultGlobalOptions(): CliGlobalOptions {
  return {
    ...DEFAULT_OPTIONS,
    color: colorDefault(),
  }
}

export function parseGlobalOptions(argv: string[]): ParsedCliGlobalOptions {
  const options = defaultGlobalOptions()
  const args: string[] = []
  const passthrough: string[] = []
  let endOfOptions = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (endOfOptions) {
      passthrough.push(arg)
      continue
    }

    if (arg === '--') {
      endOfOptions = true
      continue
    }

    switch (arg) {
      case '--json':
        options.json = true
        continue
      case '--verbose':
        options.verbose = true
        continue
      case '--color':
        options.color = true
        continue
      case '--no-color':
        options.color = false
        continue
      case '--help':
      case '-h':
        options.help = true
        continue
      case '--version':
      case '-v':
        options.version = true
        continue
      case '--yes':
        options.yes = true
        continue
      case '--force':
        options.force = true
        continue
      default:
        args.push(arg)
        continue
    }
  }

  return { options, args, passthrough, endOfOptions }
}

export function commandArgsWithPassthrough(parsed: ParsedCliGlobalOptions): string[] {
  return parsed.endOfOptions ? [...parsed.args, ...parsed.passthrough] : parsed.args
}
