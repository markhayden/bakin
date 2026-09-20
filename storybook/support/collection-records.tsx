import { Folder } from 'lucide-react'

import { Grid, Inline, Stack } from '@makinbakin/sdk/layout'
import { DataTable, ListRow, ListRowActions, ListRows, type DataTableColumn } from '@makinbakin/sdk/patterns'
import { Badge, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, Progress, Text } from '@makinbakin/sdk/ui'

import { CollectionActions, type CollectionActionsProps } from './collection-actions'
import { StorySection, StoryStage } from './index'

export const collectionProjects = [
  { id: 'menu', title: 'Spring menu launch', description: 'Coordinate photography, seasonal recipes, and the launch brief.', status: 'Active', owner: 'Jessica', progress: 40, items: 5, updated: '2 hours ago' },
  { id: 'blog', title: 'Food blog redesign', description: 'Review the editorial structure before production starts.', status: 'Draft', owner: 'Pixel', progress: 0, items: 3, updated: 'Yesterday' },
  { id: 'archive', title: 'Recipe archive migration', description: 'Move the existing collection and verify every reference.', status: 'Completed', owner: 'Rolo', progress: 100, items: 4, updated: '3 days ago' },
] as const

export type CollectionProject = typeof collectionProjects[number]

export function ProjectStatus({ project }: { project: CollectionProject }) {
  return <Badge size="xs" variant="solid" tone={project.status === 'Completed' ? 'success' : project.status === 'Active' ? 'accent' : 'neutral'}>{project.status}</Badge>
}

export function ProjectFacts({ project }: { project: CollectionProject }) {
  return (
    <Inline gap="item">
      <Text size="meta" tone="muted">Owner: {project.owner}</Text>
      <Text size="meta" tone="muted">{project.items} items</Text>
      <Text size="meta" tone="muted">{project.progress}% complete</Text>
      <Text size="meta" tone="muted">Updated {project.updated}</Text>
    </Inline>
  )
}

const columns: ReadonlyArray<DataTableColumn<CollectionProject>> = [
  {
    key: 'title', header: 'Project', sortable: true, sortValue: (project) => project.title,
    cell: (project) => (
      <Stack gap="dense">
        <Text weight="semibold">{project.title}</Text>
        <Text size="meta" tone="muted">{project.description}</Text>
      </Stack>
    ),
  },
  { key: 'status', header: 'Status', cell: (project) => <ProjectStatus project={project} /> },
  { key: 'owner', header: 'Owner' },
  { key: 'items', header: 'Items', align: 'end', sortable: true, sortValue: (project) => project.items },
  { key: 'progress', header: 'Progress', align: 'end', sortable: true, sortValue: (project) => project.progress, cell: (project) => <span>{project.progress}% complete</span> },
  { key: 'updated', header: 'Updated' },
]

export function CollectionComparison({ showActions = true, onAction }: CollectionActionsProps) {
  const tableColumns: ReadonlyArray<DataTableColumn<CollectionProject>> = showActions
    ? [...columns, { key: 'actions', header: 'Actions', hideLabel: true, align: 'end', cell: (project) => <CollectionActions title={project.title} onAction={onAction} /> }]
    : columns
  return (
    <StoryStage
      eyebrow="Collection review / #806"
      title="One collection, three presentations"
      description="Start with standard rows. Choose cards for meaningful previews, or a table when comparing columns is the job. Each supports an optional action menu; demo actions are logged in Storybook only."
      width="wide"
    >
      <StorySection title="Standard rows — the default" description="Quiet dividers, one clear identity, and supporting facts that wrap on narrow screens.">
        <ListRows variant="separated" aria-label="Projects as standard rows">
          {collectionProjects.map((project) => (
            <ListRow key={project.id}>
              <Inline align="start" wrap={false} gap="item">
                <Folder aria-hidden="true" className="mt-bakin-1 size-bakin-4 shrink-0 text-bakin-text-muted" />
                <Stack gap="dense" className="min-w-0 flex-1">
                  <Inline justify="between" gap="dense">
                    <Text weight="semibold">{project.title}</Text>
                    <Inline gap="dense" wrap={false}>
                      <ProjectStatus project={project} />
                      {showActions && <ListRowActions><CollectionActions title={project.title} onAction={onAction} /></ListRowActions>}
                    </Inline>
                  </Inline>
                  <Text tone="muted" as="p">{project.description}</Text>
                  <ProjectFacts project={project} />
                </Stack>
              </Inline>
            </ListRow>
          ))}
        </ListRows>
      </StorySection>
      <StorySection title="Cards — compare the cost" description="The same text-first records take separate boxes. Nothing here needs a visual preview, so rows are the recommended choice.">
        <Grid as="ul" layout="cards" gap="item" aria-label="Projects as cards" className="m-0 list-none p-0">
          {collectionProjects.map((project) => (
            <li key={project.id} className="min-w-0">
              <Card className="h-full">
                <CardHeader>
                  <Inline justify="between" gap="dense">
                    <CardTitle>{project.title}</CardTitle>
                    <ProjectStatus project={project} />
                  </Inline>
                  <CardDescription>{project.description}</CardDescription>
                  {showActions && <CardAction><CollectionActions title={project.title} onAction={onAction} /></CardAction>}
                </CardHeader>
                <CardContent>
                  <Stack gap="item">
                    <Progress value={project.progress} aria-label={`${project.title} progress`} />
                    <ProjectFacts project={project} />
                  </Stack>
                </CardContent>
              </Card>
            </li>
          ))}
        </Grid>
      </StorySection>
      <StorySection title="Table — compare attributes" description="Aligned columns help compare ownership, item counts, and progress. This example deliberately stays a table on narrow screens; scroll its bounded region when needed.">
        <DataTable
          label="Projects as a comparison table"
          rows={collectionProjects}
          columns={tableColumns}
          rowKey={(project) => project.id}
          tableProps={{ className: 'min-w-max' }}
        />
      </StorySection>
    </StoryStage>
  )
}
