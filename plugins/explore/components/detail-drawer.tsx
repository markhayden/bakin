import { ArrowUpRight, Check, Image as ImageIcon } from 'lucide-react'
import { BakinDrawer, PluginLink } from '@makinbakin/sdk/components'
import { Badge } from '@makinbakin/sdk/ui'
import { EntryVisual } from './catalog-card'
import type { ExploreCatalogEntry } from '../types'

const KIND_LABELS: Record<ExploreCatalogEntry['kind'], string> = {
  agent: 'Agent',
  plugin: 'Plugin',
  'skill-pack': 'Skill pack',
  'workflow-pack': 'Workflow pack',
  'lesson-pack': 'Lesson pack',
}

export function DetailDrawer({
  entry,
  installedPluginIds,
  onOpenChange,
  actions,
}: {
  entry: ExploreCatalogEntry | null
  /** Used to render a ✓ next to satisfied plugin dependencies. */
  installedPluginIds: ReadonlySet<string>
  onOpenChange: (open: boolean) => void
  /** Footer actions (Install button etc.) — wired by the page. */
  actions?: React.ReactNode
}) {
  if (!entry) return null
  return (
    <BakinDrawer
      open={entry !== null}
      onOpenChange={onOpenChange}
      storageKey="explore-detail"
      title={
        <span className="flex items-center gap-2.5">
          <EntryVisual entry={entry} />
          <span>{entry.name}</span>
          {entry.trust === 'official' && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">official ✓</Badge>
          )}
        </span>
      }
      description={`${entry.category} · ${KIND_LABELS[entry.kind]}${entry.installedVersion ? ` · v${entry.installedVersion}` : ''}`}
    >
      <div className="flex flex-col gap-5 p-4" data-testid="detail-drawer-body">
        <p className="text-sm text-foreground/90">{entry.description}</p>

        {/* Gallery — real screenshots once the bits-repo catalog ships them;
            placeholder frames until then so the layout is ready. */}
        <div data-testid="drawer-gallery" className="grid grid-cols-3 gap-2">
          {entry.screenshots.length > 0
            ? entry.screenshots.slice(0, 6).map((src) => (
                <img
                  key={src}
                  src={src}
                  alt={`${entry.name} screenshot`}
                  loading="lazy"
                  className="aspect-video w-full rounded-lg border border-border object-cover"
                />
              ))
            : Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  data-testid="gallery-placeholder"
                  className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border bg-[rgba(255,255,255,0.03)]"
                >
                  <ImageIcon className="size-5 text-muted-foreground/40" />
                </div>
              ))}
        </div>
        {entry.screenshots.length === 0 && (
          <p className="-mt-3 text-[11px] text-muted-foreground/50">Screenshots coming soon</p>
        )}

        {entry.useCases.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Use cases</h3>
            <ul className="flex flex-col gap-1.5">
              {entry.useCases.map((useCase) => (
                <li key={useCase} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-foreground/40" />
                  {useCase}
                </li>
              ))}
            </ul>
          </div>
        )}

        {entry.dependencies.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Requires</h3>
            <div className="flex flex-wrap gap-2">
              {entry.dependencies.map((dep) => (
                <span key={dep} className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {dep}
                  {installedPluginIds.has(dep) && <Check className="size-3 text-emerald-400" />}
                </span>
              ))}
            </div>
          </div>
        )}

        {entry.source && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</h3>
            <code className="break-all text-xs text-muted-foreground">{entry.source}</code>
          </div>
        )}

        {entry.updateAvailable === true && entry.kind === 'agent' && (
          <PluginLink
            to={`/team/${entry.id}`}
            className="flex items-center gap-1 text-sm text-amber-400 hover:underline"
          >
            Update available — manage in Team <ArrowUpRight className="size-3.5" />
          </PluginLink>
        )}

        {actions && <div className="mt-2 flex justify-end gap-2">{actions}</div>}
      </div>
    </BakinDrawer>
  )
}
