import { CLI_COMMANDS } from './registry'
import {
  commandArgsWithPassthrough,
  parseGlobalOptions,
  type CliGlobalOptions,
} from './options'

export interface ParsedCliInvocation {
  global: CliGlobalOptions
  args: string[]
  commandName: string
  commandArgs: string[]
  commandFound: boolean
  passthrough: string[]
  endOfOptions: boolean
}

interface CommandPattern {
  name: string
  aliases: string[]
  words: string[]
}

function usageWords(usage: string): string[] {
  const words = usage.trim().split(/\s+/)
  return words[0] === 'bakin' ? words.slice(1) : words
}

function literalPrefix(words: string[]): string[] {
  const literals: string[] = []
  for (const word of words) {
    if (word.startsWith('<') || word.startsWith('[') || word.includes('|')) break
    literals.push(word)
  }
  return literals
}

function commandPatterns(): CommandPattern[] {
  return CLI_COMMANDS.map((command) => ({
    name: command.name,
    aliases: command.aliases ?? [],
    words: literalPrefix(usageWords(command.usage)),
  })).sort((a, b) => b.words.length - a.words.length || a.name.localeCompare(b.name))
}

function matchesPrefix(args: string[], words: string[]): boolean {
  if (words.length === 0 || args.length < words.length) return false
  return words.every((word, index) => args[index] === word)
}

export function parseCliInvocation(argv: string[]): ParsedCliInvocation {
  const raw = argv.slice(2)
  const parsed = parseGlobalOptions(raw)
  const args = commandArgsWithPassthrough(parsed)

  if (parsed.options.version) {
    return {
      global: parsed.options,
      args,
      commandName: 'version',
      commandArgs: args,
      commandFound: true,
      passthrough: parsed.passthrough,
      endOfOptions: parsed.endOfOptions,
    }
  }

  if (parsed.options.help || args[0] === 'help') {
    return {
      global: parsed.options,
      args,
      commandName: 'help',
      commandArgs: args[0] === 'help' ? args.slice(1) : args,
      commandFound: true,
      passthrough: parsed.passthrough,
      endOfOptions: parsed.endOfOptions,
    }
  }

  if (args.length === 0) {
    return {
      global: parsed.options,
      args,
      commandName: 'start',
      commandArgs: [],
      commandFound: true,
      passthrough: parsed.passthrough,
      endOfOptions: parsed.endOfOptions,
    }
  }

  for (const pattern of commandPatterns()) {
    if (matchesPrefix(args, pattern.words)) {
      return {
        global: parsed.options,
        args,
        commandName: pattern.name,
        commandArgs: args.slice(pattern.words.length),
        commandFound: true,
        passthrough: parsed.passthrough,
        endOfOptions: parsed.endOfOptions,
      }
    }

    const alias = pattern.aliases.find((candidate) => args[0] === candidate)
    if (alias) {
      return {
        global: parsed.options,
        args,
        commandName: pattern.name,
        commandArgs: args.slice(1),
        commandFound: true,
        passthrough: parsed.passthrough,
        endOfOptions: parsed.endOfOptions,
      }
    }
  }

  return {
    global: parsed.options,
    args,
    commandName: args[0],
    commandArgs: args.slice(1),
    commandFound: false,
    passthrough: parsed.passthrough,
    endOfOptions: parsed.endOfOptions,
  }
}
