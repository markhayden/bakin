'use client'

import { Plus, Layers } from 'lucide-react'
import { Button, Input, Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@makinbakin/sdk/ui"
import { EmptyState } from "@makinbakin/sdk/components"
import { ModelSelect } from "@makinbakin/sdk/components"
import { WORK_CLASSES } from '../../../src/core/model-routing'
import type { ModelsData } from './use-models-data'

// The full ordered ladder; the active runtime's declared support filters it.
const ALL_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const

const DISPATCH_ROWS = WORK_CLASSES.filter((c) => c.kind === 'dispatch' && c.routable)
const SYSTEM_ROWS = WORK_CLASSES.filter((c) => c.kind === 'system' && c.routable)

export function RoutingTab({ m }: { m: ModelsData }) {
  const {
    pendingRouting, setPendingRouting, saveRouting, saving, displayRouting, routingSupport,
    setRouteField, addTagOverride, updateTagOverride, removeTagOverride, modelOptions,
  } = m

  // Only offer levels the active runtime honors (capability honesty). A
  // persisted-but-unsupported level still clamps at send time with audit
  // evidence; the routing health check flags it.
  const supported = routingSupport?.supportedThinkingLevels
  const thinkingLevels = ['inherit', ...(supported ?? ALL_THINKING_LEVELS)]

  const thinkingSelect = (value: string | undefined, onChange: (v: string) => void) => (
    <select
      className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
      value={value ?? 'inherit'}
      onChange={(e) => onChange(e.target.value)}
    >
      {thinkingLevels.map((t) => <option key={t} value={t}>{t}</option>)}
      {value && !thinkingLevels.includes(value) && (
        <option value={value}>{value} (clamps — not supported by this runtime)</option>
      )}
    </select>
  )

  const classTable = (rows: typeof DISPATCH_ROWS, header: string) => (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-card">
            <TableHead>{header}</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="w-[160px]">Thinking</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => {
            const route = displayRouting.routes.find((r) => r.workClass === c.id)
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground">{c.description}</div>
                </TableCell>
                <TableCell>
                  <ModelSelect
                    value={route?.model ?? ''}
                    onChange={(v) => setRouteField(c.id, 'model', v)}
                    models={modelOptions}
                  />
                </TableCell>
                <TableCell>
                  {thinkingSelect(route?.thinking, (v) => setRouteField(c.id, 'thinking', v))}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Route each work class to a model and thinking level. Leave a row blank to inherit the agent&apos;s configured model. Tag overrides win over class routes. Interactive chat is metered but never routed.
        </p>
        {pendingRouting && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="xs" onClick={() => setPendingRouting(null)}>Discard</Button>
            <Button size="xs" onClick={saveRouting} disabled={saving === 'routing'}>
              {saving === 'routing' ? 'Saving...' : 'Save Routing'}
            </Button>
          </div>
        )}
      </div>

      {classTable(DISPATCH_ROWS, 'Task dispatch')}

      <h3 className="text-sm font-medium">System work</h3>
      <p className="text-xs text-muted-foreground">
        Background sends Bakin makes on your behalf — titles, enrichment, relays, team routing. These are the cheap-model wins.
      </p>
      {classTable(SYSTEM_ROWS, 'System class')}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Tag overrides</h3>
        <Button variant="outline" size="xs" onClick={addTagOverride}><Plus className="h-3 w-3" /> Add override</Button>
      </div>
      {displayRouting.tagOverrides.length === 0 ? (
        <EmptyState icon={Layers} title="No tag overrides" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-card">
                <TableHead>Tag</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="w-[160px]">Thinking</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRouting.tagOverrides.map((row, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input value={row.tag} onChange={(e) => updateTagOverride(i, 'tag', e.target.value)} className="h-8 text-sm" placeholder="e.g. heavy" />
                  </TableCell>
                  <TableCell>
                    <ModelSelect value={row.model ?? ''} onChange={(v) => updateTagOverride(i, 'model', v)} models={modelOptions} />
                  </TableCell>
                  <TableCell>
                    {thinkingSelect(row.thinking, (v) => updateTagOverride(i, 'thinking', v))}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="xs" onClick={() => removeTagOverride(i)} className="text-muted-foreground hover:text-destructive">Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
