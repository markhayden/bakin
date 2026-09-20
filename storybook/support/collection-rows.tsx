import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { Inline, Stack } from '@makinbakin/sdk/layout'
import { ListRow, ListRowActions, ListRowGroup, ListRows } from '@makinbakin/sdk/patterns'
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Text } from '@makinbakin/sdk/ui'

import { collectionProjects, ProjectFacts, ProjectStatus, type CollectionProject } from './collection-records'
import { CollectionActions, type CollectionActionsProps } from './collection-actions'
import { StorySection, StoryStage } from './index'

function ProjectRow({ project, selected, onSelect, showActions, onAction }: {
  project: CollectionProject
  selected: boolean
  onSelect: () => void
} & CollectionActionsProps) {
  const [pinned, setPinned] = useState(false)
  const [expanded, setExpanded] = useState(false)
  return (
    <ListRow selected={selected} interactive={{ label: `Select ${project.title}`, onActivate: onSelect }}>
      <Collapsible open={expanded} onOpenChange={setExpanded} className="border-0">
        <Stack gap="dense">
          <Inline justify="between" gap="dense">
            <Text weight="semibold" className="min-w-0 break-words">{project.title}</Text>
            <ProjectStatus project={project} />
          </Inline>
          <ProjectFacts project={project} />
          <ListRowActions className="max-w-full flex-wrap justify-end">
            <Button
              size="xs"
              variant="ghost"
              aria-label={`${pinned ? 'Unpin' : 'Pin'} ${project.title}`}
              aria-pressed={pinned}
              onClick={() => setPinned((value) => !value)}
            >
              {pinned ? 'Pinned' : 'Pin'}
            </Button>
            <CollapsibleTrigger className="min-h-0 w-auto gap-bakin-1 py-0" render={<Button size="xs" variant="ghost" />} aria-label={`Details for ${project.title}`}>
              Details
              {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </CollapsibleTrigger>
            {showActions && <CollectionActions title={project.title} onAction={onAction} />}
          </ListRowActions>
          <CollapsibleContent>
            <Text as="p" tone="muted">{project.description}</Text>
          </CollapsibleContent>
        </Stack>
      </Collapsible>
    </ListRow>
  )
}

export function CollectionRowBehaviors({ showActions = true, onAction }: CollectionActionsProps) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <StoryStage
      eyebrow="Standard rows / behavior review"
      title="One row pattern, different situations"
      description="Select a row, pin it independently, or open its details. Actions stay visible for touch; grouping and compact density do not introduce another boundary style."
      width="content"
    >
      <StorySection title="Grouped rows" description="The group heading names each list. Selection and expansion remain separate actions.">
        <Stack gap="item">
          <ListRowGroup label="Planning projects" headerVariant="section">
            <ListRows variant="separated" className="border-y-0">
              {collectionProjects.slice(0, 2).map((project) => (
                <ProjectRow key={project.id} project={project} selected={selected === project.id} onSelect={() => setSelected(project.id)} showActions={showActions} onAction={onAction} />
              ))}
            </ListRows>
          </ListRowGroup>
          <ListRowGroup label="Completed projects" headerVariant="section">
            <ListRows variant="separated" size="sm" className="border-y-0">
              <ProjectRow project={collectionProjects[2]} selected={selected === 'archive'} onSelect={() => setSelected('archive')} showActions={showActions} onAction={onAction} />
            </ListRows>
          </ListRowGroup>
        </Stack>
      </StorySection>
      <StorySection title="Long content and unavailable actions" description="Wrap the information rather than requiring hover to read it. This row is not selectable while its action is unavailable.">
        <ListRows variant="separated" aria-label="Long project names">
          <ListRow>
            <Stack gap="dense">
              <Text weight="semibold">Recipe archive migration with cross-team editorial review and reference verification</Text>
              <Text as="p" size="meta" tone="muted">Waiting for the current archive refresh to finish. The project can be opened when its records are available.</Text>
              <Inline justify="end">
                <Button size="sm" variant="ghost" disabled>Refreshing…</Button>
              </Inline>
            </Stack>
          </ListRow>
        </ListRows>
      </StorySection>
    </StoryStage>
  )
}
