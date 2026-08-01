import { ArrowUpRight, Check, Image as ImageIcon } from 'lucide-react'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Drawer, DrawerSection } from '@makinbakin/sdk/ui'
import { StatusBadge } from '@makinbakin/sdk/patterns'
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
    <Drawer
      open={entry !== null}
      onOpenChange={onOpenChange}
      storageKey="explore-detail"
      title={
        <span className="flex min-w-0 items-center gap-bakin-2">
          <EntryVisual entry={entry} />
          <span className="truncate">{entry.name}</span>
          {entry.trust === 'official' && (
            <StatusBadge tone="accent" variant="solid" size="xs">Official</StatusBadge>
          )}
        </span>
      }
      description={`${entry.category} · ${KIND_LABELS[entry.kind]}${entry.installedVersion ? ` · v${entry.installedVersion}` : ''}`}
      actions={actions}
    >
      <div className="flex min-w-0 flex-col gap-bakin-6 pb-bakin-6" data-testid="detail-drawer-body">
        <DrawerSection title="Overview">
          <p className="m-0 leading-relaxed text-bakin-text-primary">{entry.description}</p>
        </DrawerSection>

        {/* Gallery — real screenshots once the bits-repo catalog ships them;
            placeholder frames until then so the layout is ready. */}
        <DrawerSection title="Preview">
          <div data-testid="drawer-gallery" className="grid grid-cols-1 gap-bakin-2 sm:grid-cols-2">
            {entry.screenshots.length > 0
              ? entry.screenshots.slice(0, 6).map((src) => (
                  <img
                    key={src}
                    src={src}
                    alt={`${entry.name} screenshot`}
                    loading="lazy"
                    className="aspect-video w-full rounded-bakin-surface border border-bakin-border-subtle object-cover"
                  />
                ))
              : Array.from({ length: 2 }).map((_, index) => (
                  <div
                    key={index}
                    data-testid="gallery-placeholder"
                    className="flex aspect-video w-full items-center justify-center rounded-bakin-surface border border-dashed border-bakin-border-subtle bg-bakin-canvas-default"
                  >
                    <ImageIcon className="size-5 text-bakin-text-muted opacity-50" />
                  </div>
                ))}
          </div>
          {entry.screenshots.length === 0 ? (
            <p className="mb-0 mt-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">
              Screenshots coming soon
            </p>
          ) : null}
        </DrawerSection>

        {entry.useCases.length > 0 ? (
          <DrawerSection title="Use cases">
            <ul className="m-0 grid list-none gap-bakin-2 p-0">
              {entry.useCases.map((useCase) => (
                <li key={useCase} className="flex items-start gap-bakin-2 leading-relaxed text-bakin-text-muted">
                  <span aria-hidden="true" className="mt-bakin-2 size-bakin-1 shrink-0 rounded-bakin-pill bg-bakin-text-muted" />
                  <span>{useCase}</span>
                </li>
              ))}
            </ul>
          </DrawerSection>
        ) : null}

        {entry.dependencies.length > 0 ? (
          <DrawerSection title="Requires">
            <div className="flex flex-wrap gap-bakin-2">
              {entry.dependencies.map((dep) => (
                <StatusBadge
                  key={dep}
                  tone={installedPluginIds.has(dep) ? 'success' : 'neutral'}
                  variant={installedPluginIds.has(dep) ? 'solid' : 'soft'}
                  size="sm"
                >
                  {dep}
                  {installedPluginIds.has(dep) ? <Check aria-hidden="true" /> : null}
                </StatusBadge>
              ))}
            </div>
          </DrawerSection>
        ) : null}

        {entry.source ? (
          <DrawerSection title="Source">
            <code className="block break-all rounded-bakin-control border border-bakin-border-subtle bg-bakin-canvas-default px-bakin-3 py-bakin-2 font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
              {entry.source}
            </code>
          </DrawerSection>
        ) : null}

        {entry.updateAvailable === true && entry.kind === 'agent' && (
          <PluginLink
            to={`/team/${entry.id}`}
            className="inline-flex items-center gap-bakin-1 text-bakin-action-primary-background hover:underline"
          >
            Update available — manage in Team <ArrowUpRight aria-hidden="true" className="size-bakin-4" />
          </PluginLink>
        )}
      </div>
    </Drawer>
  )
}
