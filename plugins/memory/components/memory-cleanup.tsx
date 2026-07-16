'use client'

/**
 * MemoryCleanup — find → dispatch → verify flow for scrubbing a stale term
 * (e.g. an old product name) out of agents' memory.
 *
 * Bakin never edits runtime memory: it finds where the term appears, dispatches
 * a cleanup task to each affected agent (the agent edits its OWN files), then
 * re-checks. Only "actionable" tiers (durable / daily_note / dream) are
 * agent-editable; informational tiers (transcripts, audit) are shown for context
 * and left alone (they self-heal).
 */
import { useState } from 'react'
import { Search, Send, CheckCircle2, AlertTriangle, Loader2, Lock } from 'lucide-react'
import { Button, Input, Textarea, Badge, Label, Checkbox } from '@makinbakin/sdk/ui'
import { PluginLink } from '@makinbakin/sdk/components'

interface CleanupHit {
  rowId: string
  tier: string
  agent: string
  sourcePath: string
  label: 'actionable' | 'informational'
  snippets: string[]
  managed?: boolean
}
interface AgentGroup {
  agent: string
  hits: CleanupHit[]
  actionableCount: number
}
interface FindResponse {
  term: string
  groups: AgentGroup[]
  totalHits: number
  actionableHits: number
}
interface DispatchResponse {
  dispatched: Array<{ agent: string; taskId: string; hitCount: number; managedCount: number }>
  skipped: Array<{ agent: string; reason: string }>
  failed: Array<{ agent: string; reason: string }>
}
interface VerifyResponse {
  results: Array<{ agent: string; actionableRemaining: number; informationalRemaining: number; clean: boolean }>
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/plugins/memory/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function MemoryCleanup() {
  const [term, setTerm] = useState('')
  const [action, setAction] = useState<'replace' | 'remove'>('replace')
  const [replacement, setReplacement] = useState('')
  const [instruction, setInstruction] = useState('')

  const [find, setFind] = useState<FindResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dispatch, setDispatch] = useState<DispatchResponse | null>(null)
  const [verify, setVerify] = useState<VerifyResponse | null>(null)

  const [busy, setBusy] = useState<null | 'find' | 'dispatch' | 'verify'>(null)
  const [error, setError] = useState<string | null>(null)

  const runFind = async () => {
    if (!term.trim()) return
    setBusy('find'); setError(null); setDispatch(null); setVerify(null)
    try {
      const data = await postJson<FindResponse>('cleanup/find', { term: term.trim() })
      setFind(data)
      // Pre-select every agent that has something the agent can actually fix.
      setSelected(new Set(data.groups.filter((g) => g.actionableCount > 0).map((g) => g.agent)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runDispatch = async () => {
    if (!find) return
    const agents = [...selected]
    if (agents.length === 0) return
    if (action === 'replace' && !replacement.trim()) { setError('Replacement is required for rename'); return }
    setBusy('dispatch'); setError(null); setVerify(null)
    try {
      const data = await postJson<DispatchResponse>('cleanup/dispatch', {
        term: find.term, action,
        replacement: action === 'replace' ? replacement.trim() : undefined,
        agents,
        instruction: instruction.trim() || undefined,
      })
      setDispatch(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runVerify = async () => {
    if (!find) return
    const agents = dispatch?.dispatched.map((d) => d.agent) ?? [...selected]
    if (agents.length === 0) return
    setBusy('verify'); setError(null)
    try {
      setVerify(await postJson<VerifyResponse>('cleanup/verify', { term: find.term, agents }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const toggle = (agent: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(agent)) next.delete(agent); else next.add(agent)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Find */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="cleanup-term">Find a term to scrub from agent memory</Label>
        <div className="flex gap-2">
          <Input
            id="cleanup-term"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runFind() }}
            placeholder="e.g. beacon"
          />
          <Button onClick={runFind} disabled={busy === 'find' || !term.trim()}>
            {busy === 'find' ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Find
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4" /> {error}
        </div>
      )}

      {/* Results + selection */}
      {find && (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-muted-foreground">
            {find.totalHits} occurrence(s) · {find.actionableHits} editable across {find.groups.length} agent(s)
          </div>
          {find.groups.length === 0 && (
            <div className="text-sm text-muted-foreground">No occurrences. Nothing to clean up. 🎉</div>
          )}
          {find.groups.map((g) => (
            <div key={g.agent} className="rounded-lg border p-3 flex flex-col gap-2">
              <label className="flex items-center gap-2 font-medium cursor-pointer">
                <Checkbox
                  checked={selected.has(g.agent)}
                  onCheckedChange={() => toggle(g.agent)}
                  disabled={g.actionableCount === 0}
                />
                {g.agent}
                <Badge variant="secondary">{g.actionableCount} editable</Badge>
                {g.hits.length > g.actionableCount && (
                  <Badge variant="outline">{g.hits.length - g.actionableCount} informational</Badge>
                )}
              </label>
              <ul className="flex flex-col gap-1 pl-6">
                {g.hits.map((h) => (
                  <li key={h.rowId} className="text-xs">
                    <span className="flex items-center gap-1.5">
                      <Badge variant={h.label === 'actionable' ? 'default' : 'outline'} className="text-[10px]">{h.tier}</Badge>
                      {h.managed && (
                        <span title="package-managed — edit pinned so it survives template refresh">
                          <Lock className="size-3 text-amber-500" />
                        </span>
                      )}
                      <span className="font-mono text-muted-foreground truncate">{h.sourcePath}</span>
                    </span>
                    {h.snippets.map((s, i) => (
                      <div key={i} className="pl-5 text-muted-foreground truncate">› {s}</div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Action + dispatch */}
      {find && find.actionableHits > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Button variant={action === 'replace' ? 'default' : 'outline'} size="sm" onClick={() => setAction('replace')}>Rename</Button>
            <Button variant={action === 'remove' ? 'default' : 'outline'} size="sm" onClick={() => setAction('remove')}>Remove</Button>
            {action === 'replace' && (
              <Input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="replace with… e.g. bakin"
                className="max-w-xs"
              />
            )}
          </div>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Optional: override the instruction sent to the agent"
            rows={2}
          />
          <div>
            <Button
              onClick={runDispatch}
              disabled={busy === 'dispatch' || selected.size === 0 || (action === 'replace' && !replacement.trim())}
            >
              {busy === 'dispatch' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Dispatch to {selected.size} agent(s)
            </Button>
          </div>
        </div>
      )}

      {/* Dispatch result */}
      {dispatch && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="text-sm font-medium">Dispatched {dispatch.dispatched.length} cleanup task(s)</div>
          {dispatch.dispatched.map((d) => (
            <div key={d.agent} className="text-xs text-muted-foreground">
              {d.agent} → <PluginLink className="underline" to="/tasks">task {d.taskId}</PluginLink> ({d.hitCount} file(s){d.managedCount ? `, ${d.managedCount} pinned` : ''})
            </div>
          ))}
          {dispatch.skipped.map((s) => (
            <div key={s.agent} className="text-xs text-muted-foreground">{s.agent} — skipped ({s.reason})</div>
          ))}
          {dispatch.failed?.map((f) => (
            <div key={f.agent} className="text-xs text-destructive">{f.agent} — failed ({f.reason})</div>
          ))}
          <div>
            <Button variant="outline" size="sm" onClick={runVerify} disabled={busy === 'verify'}>
              {busy === 'verify' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Verify
            </Button>
          </div>
        </div>
      )}

      {/* Verify result */}
      {verify && (
        <div className="flex flex-col gap-1 rounded-lg border p-3">
          <div className="text-sm font-medium">Verification</div>
          {verify.results.map((r) => (
            <div key={r.agent} className="flex items-center gap-2 text-xs">
              {r.clean
                ? <CheckCircle2 className="size-3.5 text-green-500" />
                : <AlertTriangle className="size-3.5 text-amber-500" />}
              <span>{r.agent}</span>
              <span className="text-muted-foreground">
                {r.clean ? 'clean' : `${r.actionableRemaining} editable occurrence(s) remain`}
                {r.informationalRemaining > 0 ? ` · ${r.informationalRemaining} informational left (self-healing)` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
