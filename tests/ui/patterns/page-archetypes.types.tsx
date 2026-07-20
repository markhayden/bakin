import { PluginLink } from '@makinbakin/sdk/components'
import { useQueryState } from '@makinbakin/sdk/hooks'
import {
  DetailPage,
  DetailPageAside,
  DetailPageBody,
  DetailPageMain,
  ListPage,
  ListPageContent,
  ListPageControls,
  PageHeader,
} from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

export function ValidListRecipe() {
  const [status, setStatus] = useQueryState('status', 'all')
  return (
    <ListPage width="full">
      <PageHeader title="Tasks" actions={<Button>New task</Button>} />
      <ListPageControls label="Task filters">
        <Button aria-pressed={status === 'open'} onClick={() => setStatus(status === 'open' ? 'all' : 'open')}>
          Toggle open tasks
        </Button>
      </ListPageControls>
      <ListPageContent label="Task results"><p>Results</p></ListPageContent>
    </ListPage>
  )
}

export function ValidDetailRecipe() {
  return (
    <DetailPage width="content">
      <PageHeader navigation={<PluginLink to="/tasks">Back to tasks</PluginLink>} title="Task detail" />
      <DetailPageBody layout="aside">
        <DetailPageMain>Task fields</DetailPageMain>
        <DetailPageAside labelledBy="task-context-heading">
          <h2 id="task-context-heading">Task context</h2>
        </DetailPageAside>
      </DetailPageBody>
    </DetailPage>
  )
}

// @ts-expect-error list pages intentionally exclude reading-width canvases
export const invalidListWidth = <ListPage width="content">Invalid</ListPage>

// @ts-expect-error detail pages intentionally exclude full-bleed canvases
export const invalidDetailWidth = <DetailPage width="full">Invalid</DetailPage>

// @ts-expect-error detail asides must have an accessible name
export const invalidUnnamedAside = <DetailPageAside>Context</DetailPageAside>
