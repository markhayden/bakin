import { describe, expect, it } from 'bun:test'
import { formatPrompt } from '../../../src/core/onboarding/prompts'

describe('onboarding prompts', () => {
  function withPromptEnv(env: Record<string, string | undefined>, isTTY: boolean, run: () => void): void {
    const previousEnv: Record<string, string | undefined> = {}
    for (const key of Object.keys(env)) {
      previousEnv[key] = process.env[key]
      if (env[key] === undefined) delete process.env[key]
      else process.env[key] = env[key]
    }
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: isTTY,
    })
    try {
      run()
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, 'isTTY', descriptor)
      else delete (process.stdout as unknown as { isTTY?: boolean }).isTTY
      for (const key of Object.keys(env)) {
        if (previousEnv[key] === undefined) delete process.env[key]
        else process.env[key] = previousEnv[key]
      }
    }
  }

  it('aligns interactive prompts with pretty log messages', () => {
    withPromptEnv({ BAKIN_CONSOLE_FORMAT: undefined }, true, () => {
      expect(formatPrompt('Install Antfly? [Y/n]')).toBe('  Install Antfly? [Y/n]')
    })
  })

  it('keeps prompts plain when plain console format is requested', () => {
    withPromptEnv({ BAKIN_CONSOLE_FORMAT: 'plain' }, true, () => {
      expect(formatPrompt('Install Antfly? [Y/n]')).toBe('Install Antfly? [Y/n]')
    })
  })

  it('keeps prompts plain when stdout is not a terminal', () => {
    withPromptEnv({ BAKIN_CONSOLE_FORMAT: undefined }, false, () => {
      expect(formatPrompt('Install Antfly? [Y/n]')).toBe('Install Antfly? [Y/n]')
    })
  })
})
