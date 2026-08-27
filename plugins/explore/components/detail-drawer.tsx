import { ArrowUpRight, Check, Image as ImageIcon } from 'lucide-react'
import { CodeBlock } from '@makinbakin/sdk/content'
import { Grid } from '@makinbakin/sdk/layout'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Drawer, DrawerSection, Text } from '@makinbakin/sdk/ui'
import { KeyValue, ListRow, ListRows, StatusBadge } from '@makinbakin/sdk/patterns'
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
      description={KIND_LABELS[entry.kind]}
      actions={actions}
    >
      <div className="flex min-w-0 flex-col gap-bakin-6 pb-bakin-6" data-testid="detail-drawer-body">
        <DrawerSection title="Overview">
          <p className="leading-relaxed text-bakin-text-primary">{entry.description}</p>
          <KeyValue
            layout="columns"
            data-testid="drawer-facts"
            items={[
              { label: 'Kind', value: KIND_LABELS[entry.kind] },
              { label: 'Category', value: entry.category },
              { label: 'Installed version', value: entry.installedVersion ? `v${entry.installedVersion}` : null },
            ]}
          />
        </DrawerSection>

        {/* Gallery — real screenshots once the bits-repo catalog ships them;
            placeholder frames until then so the layout is ready. The kit Grid
            sizes against its OWN width, so a narrow user-resized drawer really
            does collapse to one column (a `sm:` viewport breakpoint did not). */}
        <DrawerSection title="Preview">
          <Grid layout="split" gap="dense" data-testid="drawer-gallery">
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
                    <ImageIcon className="size-bakin-6 text-bakin-text-muted" />
                  </div>
                ))}
          </Grid>
          {entry.screenshots.length === 0 ? (
            <Text size="meta" tone="muted" as="p" className="mt-bakin-2">
              Screenshots coming soon
            </Text>
          ) : null}
        </DrawerSection>

        {entry.useCases.length > 0 ? (
          <DrawerSection title="Use cases">
            <ListRows variant="plain" size="sm">
              {entry.useCases.map((useCase) => (
                <ListRow key={useCase} className="leading-relaxed text-bakin-text-muted">
                  {useCase}
                </ListRow>
              ))}
            </ListRows>
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
            <CodeBlock code={entry.source} label="Source" copyable wrap />
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
