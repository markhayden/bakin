import { PluginLink, useQueryState } from '@makinbakin/sdk/navigation'
import {
  Page,
  PageAside,
  PageBody,
  PageCanvas,
  PageComposer,
  PageControls,
  PageHeader,
  PageTimeline,
  SearchInput,
  SegmentedControl,
} from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

export function ValidListRecipe() {
  const [status, setStatus] = useQueryState('status', 'all')
  return (
    <Page>
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
      <PageControls label="Task filters">
        <Button aria-pressed={status === 'open'} onClick={() => setStatus(status === 'open' ? 'all' : 'open')}>
          Toggle open tasks
        </Button>
      </PageControls>
      <PageBody label="Task results"><p>Results</p></PageBody>
    </Page>
  )
}

export function ValidDetailRecipe() {
  return (
    <Page width="standard">
      <PageHeader navigation={<PluginLink to="/tasks">Back to tasks</PluginLink>} title="Task detail" />
      <PageBody layout="aside">
        <div>Task fields</div>
        <PageAside labelledBy="task-context-heading">
          <h2 id="task-context-heading">Task context</h2>
        </PageAside>
      </PageBody>
    </Page>
  )
}

export function ValidContainedConversationRecipe() {
  return (
    <Page scroll="contained">
      <PageHeader measure="wide" title="Conversation with Patch" />
      <PageBody gap="content" label="Conversation">
        <PageTimeline labelledBy="chat-title">Messages</PageTimeline>
        <PageComposer>Composer</PageComposer>
      </PageBody>
    </Page>
  )
}

export function ValidCompactWorkflowRecipe() {
  return (
    <Page density="compact">
      <PageControls as="toolbar" label="Graph tools"><Button>Fit view</Button></PageControls>
      <PageBody gap="content">
        <PageCanvas label="Workflow canvas" orientation="horizontal">Graph</PageCanvas>
      </PageBody>
    </Page>
  )
}

// @ts-expect-error page widths are the finite standard and full canvases
export const invalidPageWidth = <Page width="wide">Invalid</Page>

// @ts-expect-error scroll ownership is a finite choice
export const invalidPageScroll = <Page scroll="viewport">Invalid</Page>

// @ts-expect-error density is a finite choice
export const invalidPageDensity = <Page density="dense">Invalid</Page>

// @ts-expect-error body layout is a finite choice
export const invalidBodyLayout = <PageBody layout="split">Invalid</PageBody>

// @ts-expect-error page headers expose only the finite standard and wide measures
export const invalidPageHeaderMeasure = <PageHeader measure="full" title="Invalid">Invalid</PageHeader>

// @ts-expect-error page asides must have an accessible name
export const invalidUnnamedAside = <PageAside>Context</PageAside>

// @ts-expect-error page controls must have an accessible name
export const invalidUnnamedControls = <PageControls><Button>Filter</Button></PageControls>

// @ts-expect-error page timelines need an accessible name
export const invalidUnnamedTimeline = <PageTimeline>Messages</PageTimeline>

// @ts-expect-error page canvases need an accessible name
export const invalidUnnamedCanvas = <PageCanvas>Graph</PageCanvas>

// @ts-expect-error graph orientation is a finite choice
export const invalidCanvasOrientation = <PageCanvas label="Graph" orientation="radial">Graph</PageCanvas>
