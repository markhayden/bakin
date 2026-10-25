/**
 * The Health card's terminal handoff (self-healing PR1 slice 1.4c): when the
 * Terminal plugin is active, a command resolution gets an "Open in Terminal"
 * action that creates a human session with the command PREFILLED (typed, not
 * executed — the operator presses Enter), then navigates to it. Without the
 * plugin the card stays copy-only. Whichever way the operator went, the
 * Health page reruns the check when they come back (`handoff-return.ts`).
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@makinbakin/sdk/navigation'

interface ManifestPlugin { id: string; status: 'active' | 'failed' }
interface TerminalOptions { defaults?: { cwd?: string } }
interface TerminalSession { id: string; generation: number; inputSequence: number }

let terminalActivePromise: Promise<boolean> | null = null

/** One manifest read per page load: is the Terminal plugin active? */
function terminalActive(): Promise<boolean> {
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
  /** Null while unknown; the card renders copy-only until true. */
  available: boolean | null
  busy: boolean
  error: string | null
  /** Create a session with the command prefilled (in `cwd` when the handoff declares one) and go to it. Resolves to the session id, or null when it could not be opened. */
  open: (command: string, title: string, cwd?: string) => Promise<string | null>
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
}

/**
 * `enabled` gates the manifest probe: only a card that is SHOWING a command
 * asks whether a terminal is available — rows without one never fetch.
 */
export function useTerminalHandoff(enabled: boolean): TerminalHandoff {
  const router = useRouter()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    void terminalActive().then((answer) => { if (active) setAvailable(answer) })
    return () => { active = false }
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
