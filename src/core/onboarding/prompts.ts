/**
 * Minimal readline wrappers for the interactive onboarding flow.
 *
 * Uses Node's stdlib only — no inquirer/prompts dependency so the whole
 * module bundles cleanly into a future single-binary build. Callers are
 * expected to pre-check `process.stdout.isTTY` before calling these; in
 * non-TTY contexts the orchestrator should pass `interactive: false` and
 * never route through this file.
 */
import { createInterface } from 'readline'

const PRETTY_PROMPT_GUTTER = '  '

function shouldAlignPrompt(): boolean {
  if (process.env.BAKIN_CONSOLE_FORMAT === 'plain') return false
  if (process.env.NO_COLOR || process.env.BAKIN_NO_COLOR === '1') {
    return process.stdout.isTTY === true
  }
  return process.stdout.isTTY === true
}

export function formatPrompt(prompt: string): string {
  return shouldAlignPrompt() ? `${PRETTY_PROMPT_GUTTER}${prompt}` : prompt
}

/**
 * Read a single line from stdin. Resolves with trimmed user input.
 * Caller supplies the prompt text (no trailing space needed — added here).
 */
export function readLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`${formatPrompt(prompt)} `, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/**
 * Ask a yes/no question. Returns true for y/yes (case-insensitive), false
 * for n/no, and `defaultValue` when the user hits Enter without typing.
 *
 * The prompt is rendered with a bracketed default indicator — `[Y/n]` when
 * default is true, `[y/N]` when default is false.
 */
export async function askYesNo(question: string, defaultValue = true): Promise<boolean> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]'
  const answer = (await readLine(`${question} ${hint}`)).toLowerCase()
  if (answer === '') return defaultValue
  if (answer === 'y' || answer === 'yes') return true
  if (answer === 'n' || answer === 'no') return false
  // Anything else — re-ask once, then fall through to default.
  const retry = (await readLine(`Please answer y or n. ${hint}`)).toLowerCase()
  if (retry === 'y' || retry === 'yes') return true
  if (retry === 'n' || retry === 'no') return false
  return defaultValue
}
