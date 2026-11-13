/**
 * Handing a command to the person: open it in a Terminal session when the
 * Terminal plugin is active, and check the thing it was meant to fix when
 * they come back.
 *
 * Two halves, both used by every surface that shows a command to run
 * (Health's incident cards, Home's login steps):
 *
 * - `useTerminalHandoff` says whether a browser terminal is available and
 *   opens a session with the command PREFILLED: typed, never executed. The
 *   person presses Enter. Without the plugin a surface stays copy-only.
 * - `handoffReturnChannel` + `useHandoffReturn` are return verification.
 *   Taking a command (opening it, or copying it) ARMS the consumer's
 *   channel; when the person is back on the consumer's page (it mounts
 *   again, the window regains focus, or the tab becomes visible) the page
 *   is told once what to recheck. Channels are per consumer: one page
 *   coming back never spends another page's recheck.
 *
 * The Terminal plugin's routes are the wire contract. It is an installable
 * plugin, so nothing here imports it; an absent or failed plugin is simply
 * "not available".
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '../navigation'

interface ManifestPlugin { id: string; status: 'active' | 'failed' }
interface TerminalOptions { defaults?: { cwd?: string } }
interface TerminalSession { id: string; generation: number; inputSequence: number }

let terminalActivePromise: Promise<boolean> | null = null

/**
 * Is the Terminal plugin active? Asked once and shared while the answer is
 * yes. A "no" is only as good as the moment it was read (the plugin can be
 * installed while the page is open), so it is asked again on `refresh`.
 */
function terminalActive(refresh = false): Promise<boolean> {
  if (refresh) terminalActivePromise = null
  terminalActivePromise ??= fetch('/api/plugins/manifest')
    .then(async (res) => {
      if (!res.ok) return false
      const body = await res.json() as { plugins?: ManifestPlugin[] }
      return (body.plugins ?? []).some((plugin) => plugin.id === 'terminal' && plugin.status === 'active')
    })
    .catch(() => false)
  return terminalActivePromise
}

/** Test seam: forget the cached manifest answer. */
export function resetTerminalHandoffForTests(): void {
  terminalActivePromise = null
}

export interface TerminalHandoff {
  /** Null while unknown; a surface renders copy-only until true. */
  available: boolean | null
  busy: boolean
  error: string | null
  /** Create a session with the command prefilled (in `cwd` when given) and go to it. Resolves to the session id, or null when it could not be opened. */
  open: (command: string, title: string, cwd?: string) => Promise<string | null>
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
}

/**
 * `enabled` gates the manifest read: only a surface that is SHOWING a
 * command asks whether a terminal is available. While the answer is not
 * yes, it is asked again each time the window regains focus.
 */
export function useTerminalHandoff(enabled: boolean): TerminalHandoff {
  const router = useRouter()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    const read = (refresh: boolean) => { void terminalActive(refresh).then((answer) => { if (active) setAvailable(answer) }) }
    read(false)
    // Installed while this page was open: found on the way back to it.
    const onFocus = () => { void terminalActive().then((known) => { if (active && !known) read(true) }) }
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled])

  const open = useCallback(async (command: string, title: string, cwd?: string): Promise<string | null> => {
    setBusy(true)
    setError(null)
    try {
      const optionsRes = await fetch('/api/plugins/terminal/options')
      const options = optionsRes.ok ? await optionsRes.json() as TerminalOptions : {}
      const created = await fetch('/api/plugins/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.slice(0, 100), cwd: cwd ?? options.defaults?.cwd ?? '/', program: 'shell' }),
      })
      if (!created.ok) { setError(`The Terminal plugin refused to start a session: ${await readError(created)}. Copy the command instead.`); return null }
      const session = await created.json() as TerminalSession
      // Prefill: the command is typed into the session, never submitted.
      const typed = await fetch('/api/plugins/terminal/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: session.id, operation: 'write', generation: session.generation, sequence: session.inputSequence + 1, data: command }),
      }).catch(() => null)
      if (!typed || !typed.ok) setError('The session opened but the command could not be prefilled — paste it from the copy block.')
      router.push(`/terminal/${encodeURIComponent(session.id)}`)
      return session.id
    } catch (err) {
      setError(`${err instanceof Error ? err.message : String(err)}. Copy the command instead.`)
      return null
    } finally {
      setBusy(false)
    }
  }, [router])

  return { available, busy, error, open }
}

/**
 * One consumer's armed handoffs. `key` names what was handed off (an
 * incident, a login step); `tokens` say what to recheck when the person is
 * back (check ids, or nothing when the consumer just looks again).
 */
export interface HandoffReturnChannel {
  arm: (key: string, tokens?: readonly string[]) => void
  /** A terminal that failed to open hands nothing off: no phantom recheck. */
  disarm: (key: string) => void
  isArmed: (key: string) => boolean
  /** Every token the armed handoffs would recheck, once each. */
  armedTokens: () => string[]
  /** Hand over the tokens and disarm everything; null when nothing was armed. */
  take: () => string[] | null
}

const channels = new Map<string, Map<string, string[]>>()

/** The channel for one consumer (a plugin id is the natural name). The same name always gives the same channel. */
export function handoffReturnChannel(consumer: string): HandoffReturnChannel {
  let armed = channels.get(consumer)
  if (!armed) {
    armed = new Map()
    channels.set(consumer, armed)
  }
  const store = armed
  const armedTokens = () => [...new Set([...store.values()].flat())]
  return {
    arm: (key, tokens = []) => { store.set(key, [...new Set(tokens)]) },
    disarm: (key) => { store.delete(key) },
    isArmed: (key) => store.has(key),
    armedTokens,
    take: () => {
      if (store.size === 0) return null
      const tokens = armedTokens()
      store.clear()
      return tokens
    },
  }
}

/** Test seam: disarm every channel. */
export function resetHandoffReturnForTests(): void {
  for (const armed of channels.values()) armed.clear()
}

/**
 * Page-level: `onReturn(tokens)` runs once per arming of THIS consumer's
 * channel, when the person is back on the page. The arming lives outside
 * any component because the one that armed it usually unmounts when the
 * Terminal route opens, and a copy fires no event a component could see.
 */
export function useHandoffReturn(consumer: string, onReturn: (tokens: string[]) => void): void {
  useEffect(() => {
    const channel = handoffReturnChannel(consumer)
    const fire = () => {
      const tokens = channel.take()
      if (tokens) onReturn(tokens)
    }
    fire() // mounting again IS the return when the handoff navigated away
    const onVisible = () => { if (document.visibilityState === 'visible') fire() }
    window.addEventListener('focus', fire)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', fire)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [consumer, onReturn])
}
