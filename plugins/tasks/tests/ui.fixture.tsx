import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { TaskLogTable } from '../components/task-log-table'
import type { FlatTask } from '../hooks/use-task-filters'

const tasks: FlatTask[] = [
  { id: 'editorial', title: 'Prepare the seasonal editorial launch with cross-team review and publication approval', status: 'done', checked: true, date: '2026-01-14T13:00:00Z' },
  { id: 'review', title: 'Review campaign images', status: 'review', checked: false, date: '2026-01-15T08:00:00-07:00' },
  { id: 'undated', title: 'Unscheduled follow-up', status: 'todo', checked: false },
]
function TaskLogFixture() {
  return <Page><PageHeader title="Task log" /><PageBody>
    <TaskLogTable currentTasks={tasks} statusFilter={[]} onTaskOpen={() => {}}
      onTaskEdit={() => {}} onTaskDuplicate={() => {}} onTaskDelete={() => {}} />
  </PageBody></Page>
}

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost
    fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/tasks', network: [
      { path: '/api/plugins/memory/audit', status: 200, json: { entries: [] } },
    ] }}
    registrations={[{ id: 'tasks', routes: { '/tasks': TaskLogFixture } }]}
  />,
)
