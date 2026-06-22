'use client'

import { Plus, Layers } from 'lucide-react'
import { Button, Input, Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@makinbakin/sdk/ui"
import { EmptyState } from "@makinbakin/sdk/components"
import { ModelSelect } from "@makinbakin/sdk/components"
import type { ModelsData } from './use-models-data'

// Dispatch origins routing can target, with a short hint of what each is.
const ROUTING_ORIGINS = [
  { id: 'scheduled', label: 'Scheduled', hint: 'Cron-fired tasks' },
  { id: 'workflow', label: 'Workflow', hint: 'Workflow step turns' },
  { id: 'adhoc', label: 'Ad-hoc', hint: 'Manually kicked tasks' },
  { id: 'recovery', label: 'Recovery', hint: 'Session-death re-dispatch' },
  { id: 'decomposition', label: 'Decomposition', hint: 'Subtask breakdown' },
] as const

const THINKING_LEVELS = ['inherit', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const

export function RoutingTab({ m }: { m: ModelsData }) {
  const {
    pendingRouting, setPendingRouting, saveRouting, saving, displayRouting,
    setOriginField, addTagOverride, updateTagOverride, removeTagOverride, modelOptions,
  } = m

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Route each dispatch origin to a model and thinking level. Leave a row blank to inherit the agent&apos;s configured model. Tag overrides win over origin policies.
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

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-card">
              <TableHead>Origin</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="w-[160px]">Thinking</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROUTING_ORIGINS.map((o) => {
              const policy = displayRouting.policies.find((p) => p.origin === o.id)
              return (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="font-medium">{o.label}</div>
                    <div className="text-[11px] text-muted-foreground">{o.hint}</div>
                  </TableCell>
                  <TableCell>
                    <ModelSelect
                      value={policy?.model ?? ''}
                      onChange={(v) => setOriginField(o.id, 'model', v)}
                      models={modelOptions}
                    />
                  </TableCell>
                  <TableCell>
                    <select
                      className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                      value={policy?.thinking ?? 'inherit'}
                      onChange={(e) => setOriginField(o.id, 'thinking', e.target.value)}
                    >
                      {THINKING_LEVELS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

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
                    <select
                      className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
                      value={row.thinking ?? 'inherit'}
                      onChange={(e) => updateTagOverride(i, 'thinking', e.target.value)}
                    >
                      {THINKING_LEVELS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
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
