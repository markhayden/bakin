/**
 * What `bakin start` does once the server is listening: say where Bakin is,
 * in a box that does not get lost in the logs, and open it in the browser.
 *
 * Both only happen for a person at a terminal. A service (`bakin serve` under
 * launchd or systemd), a pipe, CI, or a session over SSH gets neither: there
 * is no screen to open a browser on, and a box is noise in a log file.
 */
import { spawn } from 'child_process'
import { createLogger } from './logger'

const log = createLogger('startup')

/** The environment the decision is made from. Passed in so it can be tested. */
export interface StartupContext {
  /** The person ran `bakin start` (not `serve`, not a restart child). */
  interactiveStart: boolean
  /** `--no-open` was given. */
  noOpen: boolean
  isTTY: boolean
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
}

/** Somewhere a browser can actually appear. */
function hasScreen(platform: NodeJS.Platform, env: StartupContext['env']): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT) return false
  if (platform === 'darwin' || platform === 'win32') return true
  if (platform === 'linux') return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
  return false
}

/** Print the address box: anything run by a person at a terminal, never into a log. */
export function shouldAnnounce(context: Pick<StartupContext, 'isTTY' | 'env'>): boolean {
  return context.isTTY && !context.env.CI
}

/** Open the browser: `bakin start`, at a terminal, on a machine with a screen, unless told not to. */
export function shouldOpenBrowser(context: StartupContext): boolean {
  return context.interactiveStart
    && !context.noOpen
    && !context.env.BAKIN_NO_OPEN
    && shouldAnnounce(context)
    && hasScreen(context.platform, context.env)
}

/** The command that opens a URL in the default browser, or null where there is none. */
export function openerFor(platform: NodeJS.Platform, url: string): string[] | null {
  if (platform === 'darwin') return ['open', url]
  if (platform === 'win32') return ['cmd', '/c', 'start', '""', url]
  if (platform === 'linux') return ['xdg-open', url]
  return null
}

/** The box: where Bakin is, and how to reach it from another device on the tailnet. */
export function addressBox(local: string, network: string | null): string {
  const rows = [
    'Bakin is running',
    '',
    `Local:    ${local}`,
    ...(network ? [`Network:  ${network}`] : []),
  ]
  const width = Math.max(...rows.map((row) => row.length)) + 4
  const line = (text: string) => `│  ${text.padEnd(width - 4)}  │`
  return ['', `╭${'─'.repeat(width)}╮`, ...rows.map(line), `╰${'─'.repeat(width)}╯`, ''].join('\n')
}

/** Called once the server is listening. Never throws: failing to open a browser never stops Bakin. */
export function announceReady(local: string, network: string | null, context: StartupContext): void {
  if (shouldAnnounce(context)) process.stdout.write(`${addressBox(local, network)}\n`)
  if (!shouldOpenBrowser(context)) return
  const command = openerFor(context.platform, local)
  if (!command) return
  try {
    const child = spawn(command[0]!, command.slice(1), { stdio: 'ignore', detached: true })
    child.on('error', (err) => log.debug('Could not open the browser', { error: err.message }))
    child.unref()
  } catch (err) {
    log.debug('Could not open the browser', { error: err instanceof Error ? err.message : String(err) })
  }
}
