'use client'

/**
 * Per-agent dispatch containment (self-healing PR1 slice 1.4b; row 50): the
 * "Pause dispatch for this agent" control on the agent's Diagnostics tab.
 * Writes `settings.dispatch.pausedAgents` through `/api/settings` (arrays
 * replace on merge); the dispatch gate holds that agent's turns with the
 * typed reason `agent_paused` while every other agent runs on.
 */
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@makinbakin/sdk/patterns'
import { Banner, Button, Text } from '@makinbakin/sdk/ui'

const AFFECTED_CHECKS = ['health.usage.agent-burn']

export function AgentDispatchPausePanel({ agentId }: { agentId: string }) {
  const [pausedAgents, setPausedAgents] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'pause' | 'resume' | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void fetch('/api/settings', { signal: controller.signal }).then(async (res) => {
      if (!active) return
      if (!res.ok) { setError(`Could not read settings (HTTP ${res.status}).`); return }
      const settings = await res.json() as { dispatch?: { pausedAgents?: string[] } }
      if (active) setPausedAgents(settings.dispatch?.pausedAgents ?? [])
    }).catch((err: unknown) => { if (active && !(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false; controller.abort() }
  }, [])

  const paused = pausedAgents?.includes(agentId) ?? false

  const write = async (next: string[]) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dispatch: { pausedAgents: next } }) })
      if (!res.ok) { setError(`Could not update settings (HTTP ${res.status}).`); return }
      setPausedAgents(next)
      void fetch('/api/plugins/health/doctor/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkIds: AFFECTED_CHECKS }) }).catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  if (pausedAgents === null && !error) return null
  return (
    <section aria-labelledby="diagnostics-dispatch" data-testid="agent-dispatch-pause" className="flex flex-col gap-bakin-2">
      <h3 id="diagnostics-dispatch" className="text-bakin-typography-size-heading-sm font-bakin-typography-weight-semibold">Dispatch</h3>
      {error && <Banner tone="danger" title="Dispatch setting could not be read or saved" description={error} />}
      {paused ? (
        <Banner
          tone="attention"
          title="Dispatch is paused for this agent"
          description="Bakin does not start new turns for this agent; its queued tasks wait, other agents run. In-flight turns finish."
          action={<Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm('resume')}>{busy ? 'Saving…' : 'Resume dispatch'}</Button>}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-bakin-3">
          <Text as="p" tone="muted">Contain a runaway: hold this agent's dispatch while you look, without pausing everyone.</Text>
          <Button size="sm" variant="outline" disabled={busy || pausedAgents === null} onClick={() => setConfirm('pause')}>{busy ? 'Saving…' : 'Pause dispatch for this agent'}</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'pause' ? `Pause dispatch for ${agentId}?` : `Resume dispatch for ${agentId}?`}
        description={confirm === 'pause'
          ? 'Queued and new tasks for this agent wait until you resume. Turns already running finish. Other agents are not affected.'
          : 'Queued tasks for this agent dispatch again on the next cycle.'}
        confirmLabel={confirm === 'pause' ? 'Pause dispatch' : 'Resume dispatch'}
        confirmTone={confirm === 'pause' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() => { void write(confirm === 'pause' ? [...new Set([...(pausedAgents ?? []), agentId])] : (pausedAgents ?? []).filter((id) => id !== agentId)) }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  )
}
