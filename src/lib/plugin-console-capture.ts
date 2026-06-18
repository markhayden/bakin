/**
 * Plugin console capture + plugin-scoped logging.
 *
 * Extracted from plugin-registry.ts. User plugins activate inside
 * `withCapturedPluginConsole`, which patches `console.*` so a plugin's stray
 * `console.log` is routed through the structured logger tagged with its id
 * instead of leaking raw to stdout. `createPluginScopedLogger` is the
 * structured logger handed to each plugin's `ctx.log`.
 *
 * The capture context is `AsyncLocalStorage`-backed so the patch only affects
 * console calls made within a given plugin's activation, not unrelated async
 * work interleaved on the event loop.
 */
import { AsyncLocalStorage } from 'async_hooks'
import { inspect } from 'util'

import { createLogger } from '../core/logger'

const log = createLogger('plugin-registry')

type CapturedConsoleLevel = 'debug' | 'error' | 'info' | 'warn'
type CapturedConsoleMethod = CapturedConsoleLevel | 'log'
interface CapturedConsoleContext {
  pluginId: string
}

const capturedConsoleContext = new AsyncLocalStorage<CapturedConsoleContext | undefined>()

function withoutCapturedPluginConsole<T>(action: () => T): T {
  return capturedConsoleContext.run(undefined, action)
}

function stripPluginConsolePrefix(pluginId: string, message: string): string {
  const escaped = pluginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return message.replace(new RegExp(`^\\[${escaped}\\]\\s*`), '')
}

function formatPluginConsoleArgs(pluginId: string, args: unknown[]): string {
  return stripPluginConsolePrefix(
    pluginId,
    args.map((arg) => {
      if (typeof arg === 'string') return arg
      return inspect(arg, { breakLength: Infinity, colors: false, compact: true, depth: 5 })
    }).join(' '),
  ).trim()
}

export async function withCapturedPluginConsole<T>(pluginId: string, action: () => Promise<T> | T): Promise<T> {
  const original: Record<CapturedConsoleMethod, (...args: unknown[]) => void> = {
    debug: console.debug.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
  }

  const restore = () => {
    console.debug = original.debug as typeof console.debug
    console.error = original.error as typeof console.error
    console.info = original.info as typeof console.info
    console.log = original.log as typeof console.log
    console.warn = original.warn as typeof console.warn
  }

  const install = () => {
    console.debug = ((...args: unknown[]) => emit('debug', 'debug', args)) as typeof console.debug
    console.error = ((...args: unknown[]) => emit('error', 'error', args)) as typeof console.error
    console.info = ((...args: unknown[]) => emit('info', 'info', args)) as typeof console.info
    console.log = ((...args: unknown[]) => emit('info', 'log', args)) as typeof console.log
    console.warn = ((...args: unknown[]) => emit('warn', 'warn', args)) as typeof console.warn
  }

  const emit = (level: CapturedConsoleLevel, method: CapturedConsoleMethod, args: unknown[]) => {
    const context = capturedConsoleContext.getStore()
    if (!context) {
      original[method](...args)
      return
    }

    const message = formatPluginConsoleArgs(context.pluginId, args)
    if (!message) return

    // createLogger writes through console.*. Clear the plugin context while
    // forwarding so the rendered logger line is not captured recursively.
    withoutCapturedPluginConsole(() => {
      const data = { source: 'plugin', pluginId: context.pluginId, console: true }
      if (level === 'debug') log.debug(message, data)
      else if (level === 'error') log.error(message, data)
      else if (level === 'warn') log.warn(message, data)
      else log.info(message, data)
    })
  }

  install()
  try {
    return await capturedConsoleContext.run({ pluginId }, action)
  } finally {
    restore()
  }
}

function withPluginLogData(pluginId: string, data?: unknown): Record<string, unknown> {
  return {
    ...(data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}),
    source: 'plugin',
    pluginId,
  }
}

export function createPluginScopedLogger(pluginId: string) {
  const pluginLog = createLogger(`plugin:${pluginId}`)
  return {
    debug: (message: string, data?: Record<string, unknown>) => {
      withoutCapturedPluginConsole(() => pluginLog.debug(message, withPluginLogData(pluginId, data)))
    },
    info: (message: string, data?: Record<string, unknown>) => {
      withoutCapturedPluginConsole(() => pluginLog.info(message, withPluginLogData(pluginId, data)))
    },
    warn: (message: string, errorOrData?: unknown, data?: Record<string, unknown>) => {
      withoutCapturedPluginConsole(() => {
        if (errorOrData instanceof Error || typeof errorOrData === 'string') {
          pluginLog.warn(message, errorOrData, withPluginLogData(pluginId, data))
        } else {
          pluginLog.warn(message, withPluginLogData(pluginId, errorOrData))
        }
      })
    },
    error: (message: string, errorOrData?: unknown, data?: Record<string, unknown>) => {
      withoutCapturedPluginConsole(() => {
        if (errorOrData instanceof Error || typeof errorOrData === 'string') {
          pluginLog.error(message, errorOrData, withPluginLogData(pluginId, data))
        } else {
          pluginLog.error(message, withPluginLogData(pluginId, errorOrData))
        }
      })
    },
  }
}
