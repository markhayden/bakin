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
  SearchInput,
  SegmentedControl,
} from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

export function ValidListRecipe() {
  const [status, setStatus] = useQueryState('status', 'all')
  return (
    <ListPage width="full">
      <PageHeader
        title="Tasks"
        controlsLabel="Task search and view"
        controls={(
          <>
            <SearchInput label="Search tasks" value="" onValueChange={() => {}} />
            <SegmentedControl ariaLabel="Task view" options={[{ value: 'board', label: 'Board' }]} value="board" onValueChange={() => {}} />
          </>
        )}
        actions={<Button>New task</Button>}
      />
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

export function ValidMediaDetailRecipe() {
  return (
    <DetailPage width="full">
      <PageHeader measure="wide" title="Asset detail" />
      <DetailPageBody layout="aside">
        <DetailPageMain>Asset preview</DetailPageMain>
        <DetailPageAside label="Asset context">Metadata and version history</DetailPageAside>
      </DetailPageBody>
    </DetailPage>
  )
}

// @ts-expect-error list pages intentionally exclude reading-width canvases
export const invalidListWidth = <ListPage width="content">Invalid</ListPage>

// @ts-expect-error detail pages expose only the finite content, wide, and full canvases
export const invalidDetailWidth = <DetailPage width="canvas">Invalid</DetailPage>

// @ts-expect-error page headers expose only the finite standard and wide measures
export const invalidPageHeaderMeasure = <PageHeader measure="full" title="Invalid">Invalid</PageHeader>

// @ts-expect-error detail asides must have an accessible name
export const invalidUnnamedAside = <DetailPageAside>Context</DetailPageAside>
