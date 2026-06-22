'use client'

import { Button, Input, Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@makinbakin/sdk/ui"
import { ModelSelect } from "@makinbakin/sdk/components"
import type { ModelsData } from './use-models-data'
import { InlineEmpty } from './models-page-shared'

export function AliasesTab({ m }: { m: ModelsData }) {
  const {
    aliases, modelOptions, modelsReady,
    newAliasName, setNewAliasName, newAliasTarget, setNewAliasTarget,
    addAlias, deleteAlias, prepopulateAliases,
  } = m

  return (
    <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Model aliases from <code className="text-xs">agents.defaults.models</code>
          </p>
          <Button variant="outline" size="xs" onClick={prepopulateAliases}>
            Pre-populate Defaults
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-card">
                <TableHead>Alias</TableHead>
                <TableHead>Target Model</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(aliases).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <InlineEmpty message="No aliases defined" />
                  </TableCell>
                </TableRow>
              ) : (
                Object.entries(aliases).map(([name, target]) => (
                  <TableRow key={name}>
                    <TableCell>
                      <code className="text-sm font-medium">{name}</code>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground font-mono">{target}</span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => deleteAlias(name)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Add alias form */}
        <div className="flex items-end gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Alias Name</label>
            <Input
              value={newAliasName}
              onChange={(e) => setNewAliasName(e.target.value)}
              placeholder="e.g. opus"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Target Model</label>
            <ModelSelect
              value={newAliasTarget}
              onChange={setNewAliasTarget}
              models={modelOptions}
            />
          </div>
          <Button onClick={addAlias} disabled={!newAliasName.trim() || !newAliasTarget.trim() || !modelsReady}>
            Add
          </Button>
        </div>
    </div>
  )
}
