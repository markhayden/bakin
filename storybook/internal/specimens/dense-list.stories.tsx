import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import {
  Action,
  BoundedOverflow,
  CandidateDirection,
  CandidateIntro,
  CandidateStyles,
  Grid,
  Inline,
  PageShell,
  Section,
  Stack,
  Status,
  SystemState,
  type DirectionId,
} from './candidate-ui'

const DENSE_CSS = `
.bakin-dense-header { display: grid; gap: var(--candidate-item-gap); }
.bakin-dense-header__eyebrow {
  margin: var(--bakin-layout-space-0);
  color: var(--bakin-color-signal-accent);
  font-size: var(--candidate-meta-size);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.bakin-dense-header h2 {
  max-width: 24ch;
  margin: var(--bakin-layout-space-0);
  overflow-wrap: anywhere;
  font-size: var(--candidate-page-title-size);
  font-weight: 600;
  line-height: 1.04;
  letter-spacing: -0.035em;
}
.bakin-dense-header__description { max-width: 62ch; margin: var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); line-height: 1.55; }
.bakin-dense-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-block: 1px solid var(--bakin-color-border-subtle);
}
.bakin-dense-metric { min-width: 0; padding: var(--candidate-item-gap) var(--candidate-item-gap) var(--candidate-item-gap) var(--bakin-layout-space-0); }
.bakin-dense-metric + .bakin-dense-metric { border-left: 1px solid var(--bakin-color-border-subtle); padding-left: var(--candidate-item-gap); }
.bakin-dense-metric span { display: block; color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.bakin-dense-metric strong { display: block; margin-top: var(--bakin-layout-space-1); overflow-wrap: anywhere; font-family: var(--candidate-font-mono); font-size: calc(var(--candidate-body-size) * 1.12); font-variant-numeric: tabular-nums; }
.bakin-dense-filter-label { color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); }
.bakin-dense-table { width: 100%; min-width: 48rem; border-collapse: collapse; font-size: var(--candidate-meta-size); }
.bakin-dense-table th, .bakin-dense-table td { min-height: var(--candidate-row-min-height); padding: var(--candidate-item-gap); text-align: left; vertical-align: middle; }
.bakin-dense-table th { color: var(--bakin-color-text-muted); font-weight: 500; }
.bakin-dense-table tbody tr { border-top: 1px solid var(--bakin-color-border-subtle); }
.bakin-dense-table tbody tr:hover { background: color-mix(in srgb, var(--bakin-color-surface-default) 72%, var(--bakin-color-text-primary)); }
.bakin-dense-table__title { display: grid; gap: var(--bakin-layout-space-1); }
.bakin-dense-table__title strong { font-size: var(--candidate-body-size); }
.bakin-dense-table code, .bakin-dense-object code { color: var(--bakin-color-text-muted); font-family: var(--candidate-font-mono); font-size: var(--candidate-meta-size); }
.bakin-dense-objects { display: grid; margin: var(--bakin-layout-space-0); padding: var(--bakin-layout-space-0); list-style: none; }
.bakin-dense-object {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(8rem, 0.8fr) auto;
  gap: var(--candidate-section-gap);
  align-items: center;
  min-height: var(--candidate-row-min-height);
  padding: var(--candidate-section-gap) var(--bakin-layout-space-0);
  border-top: 1px solid var(--bakin-color-border-subtle);
}
.bakin-dense-object:last-child { border-bottom: 1px solid var(--bakin-color-border-subtle); }
.bakin-dense-object__title { display: grid; gap: var(--bakin-layout-space-1); min-width: 0; }
.bakin-dense-object__title strong { overflow-wrap: anywhere; font-size: calc(var(--candidate-body-size) * 1.08); }
.bakin-dense-object__title code { overflow-wrap: anywhere; }
.bakin-dense-object__meta { display: grid; gap: var(--bakin-layout-space-1); color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); }
.bakin-dense-health { display: grid; gap: var(--candidate-item-gap); }
.bakin-dense-health__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--candidate-item-gap); align-items: baseline; padding-top: var(--candidate-item-gap); border-top: 1px solid var(--bakin-color-border-subtle); }
.bakin-dense-health__row code { min-width: 0; overflow-wrap: anywhere; color: var(--bakin-color-text-muted); font-family: var(--candidate-font-mono); font-size: var(--candidate-meta-size); }
.bakin-dense-state-grid { display: grid; gap: var(--candidate-section-gap); }
@media (max-width: 42rem) {
  .bakin-dense-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bakin-dense-metric:nth-child(3) { border-left: 0; }
  .bakin-dense-object { grid-template-columns: minmax(0, 1fr); gap: var(--candidate-item-gap); }
  .bakin-dense-object .bakin-action { justify-self: start; }
}
@media (max-width: 24rem) {
  .bakin-dense-summary { grid-template-columns: minmax(0, 1fr); }
  .bakin-dense-metric + .bakin-dense-metric { border-left: 0; border-top: 1px solid var(--bakin-color-border-subtle); padding-left: var(--bakin-layout-space-0); }
  .bakin-dense-health__row { grid-template-columns: minmax(0, 1fr); }
}
`.trim()

const filters = ['All', 'Needs attention', 'Running', 'Blocked'] as const

const taskRows = [
  {
    title: 'Assemble launch cut for social channels',
    id: 'task-01JZ9R8MT7TQ',
    owner: 'Patch',
    target: 'asset:campaign/spring-hero-final-v18.webp',
    status: 'Running',
    tone: 'positive' as const,
    updated: '42 sec ago',
  },
  {
    title: 'Reconcile partner usage and unreported spend',
    id: 'task-01JZ9S1B3KQ2',
    owner: 'Pixel',
    target: 'report:usage/2026-W29/provider-breakdown.csv',
    status: 'Needs attention',
    tone: 'attention' as const,
    updated: '8 min ago',
  },
  {
    title: 'Review migration copy for external plugin builders',
    id: 'task-01JZ9T4P6KE7',
    owner: 'Rolo',
    target: 'docs:extending/ui-migration-guide',
    status: 'Blocked',
    tone: 'danger' as const,
    updated: '1 hr ago',
  },
]

function DenseHeader({ activeFilter, onFilter }: { activeFilter: string; onFilter: (filter: string) => void }) {
  return (
    <Stack gap="item">
      <header className="bakin-dense-header">
        <p className="bakin-dense-header__eyebrow">Tasks / live operations</p>
        <Inline align="between">
          <div><h2>Coordinate active work without losing operational context</h2></div>
          <Inline><Action>Export view</Action><Action tone="primary">New task</Action></Inline>
        </Inline>
        <p className="bakin-dense-header__description">42 active tasks across agents, assets, schedules, and workflows. Filters belong in the URL under the existing routing contract.</p>
      </header>
      <Inline aria-label="Task filters">
        <span className="bakin-dense-filter-label">Search tasks and assets</span>
        {filters.map((filter) => (
          <Action key={filter} aria-pressed={activeFilter === filter} onClick={() => onFilter(filter)}>{filter}</Action>
        ))}
      </Inline>
    </Stack>
  )
}

function Summary() {
  return (
    <div className="bakin-dense-summary" aria-label="Task summary">
      <div className="bakin-dense-metric"><span>Active</span><strong>42</strong></div>
      <div className="bakin-dense-metric"><span>Due today</span><strong>08</strong></div>
      <div className="bakin-dense-metric"><span>Blocked</span><strong>03</strong></div>
      <div className="bakin-dense-metric"><span>Search p95</span><strong>184 ms</strong></div>
    </div>
  )
}

function OperationalTable() {
  return (
    <BoundedOverflow label="Scrollable active tasks table">
      <table className="bakin-dense-table">
        <thead><tr><th scope="col">Task</th><th scope="col">Owner</th><th scope="col">Target</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead>
        <tbody>{taskRows.map((task) => (
          <tr key={task.id}>
            <td><div className="bakin-dense-table__title"><strong>{task.title}</strong><code>{task.id}</code></div></td>
            <td>{task.owner}</td>
            <td><code>{task.target}</code></td>
            <td><Status tone={task.tone}>{task.status}</Status></td>
            <td>{task.updated}</td>
          </tr>
        ))}</tbody>
      </table>
    </BoundedOverflow>
  )
}

function ProductRows() {
  return (
    <ul className="bakin-dense-objects" aria-label="Active task objects">
      {taskRows.map((task) => (
        <li className="bakin-dense-object" key={task.id}>
          <div className="bakin-dense-object__title"><strong>{task.title}</strong><code>{task.target}</code></div>
          <div className="bakin-dense-object__meta"><Status tone={task.tone}>{task.status}</Status><span>{task.owner} · {task.updated}</span></div>
          <Action aria-label={`Open ${task.title}`}>Open</Action>
        </li>
      ))}
    </ul>
  )
}

function HealthPulse() {
  return (
    <div className="bakin-dense-health">
      <div className="bakin-dense-health__row"><Status>Coordination database and execution journal</Status><code>healthy · 42 ms</code></div>
      <div className="bakin-dense-health__row"><Status tone="attention">Search index enrichment queue</Status><code>7 pending · 00:18</code></div>
      <div className="bakin-dense-health__row"><Status tone="accent">OpenClaw gateway websocket</Status><code>connected · 12m 08s</code></div>
      <div className="bakin-dense-health__row"><Status tone="muted">Agent session</Status><code>agent:patch:explicit:sess-01JZ9T4P6KE7</code></div>
    </div>
  )
}

function DenseDirection({ direction }: { direction: DirectionId }) {
  const [activeFilter, setActiveFilter] = useState<string>('All')
  return (
    <CandidateDirection direction={direction}>
      <PageShell>
        <DenseHeader activeFilter={activeFilter} onFilter={setActiveFilter} />
        <Summary />
        <Section title={activeFilter === 'All' ? 'Active work' : `${activeFilter} work`} description="One content hierarchy; bounded objects only where the data genuinely requires one.">
          {direction === 'operational-neutral' ? <OperationalTable /> : <ProductRows />}
        </Section>
        <Section title="Health pulse" description="Domain status color remains signal, never decorative chrome."><HealthPulse /></Section>
      </PageShell>
    </CandidateDirection>
  )
}

function StateGallery({ direction }: { direction: DirectionId }) {
  return (
    <CandidateDirection direction={direction}>
      <PageShell>
        <Section title="List and data system states" description="Every state explains what happened and preserves a recovery path when one exists.">
          <Grid columns={1}>
            <SystemState kind="loading" title="Loading active work" description="Fetching the latest task and health snapshots without hiding the existing page context." action={<Action disabled>Refresh</Action>} />
            <SystemState kind="initial-empty" title="No tasks yet" description="Create the first task directly, or connect a workflow that contributes work." action={<Action tone="primary">Create task</Action>} />
            <SystemState kind="filtered-no-results" title="No matches for this view" description="The current filters exclude all 42 active tasks. Clear filters without losing the search term." action={<Action>Clear filters</Action>} />
            <SystemState kind="error" title="Tasks could not be refreshed" description="The last usable snapshot remains visible. Retry or inspect runtime health for a precise cause." action={<Action>Retry</Action>} />
            <SystemState kind="permission-denied" title="Asset details are restricted" description="You can see task status, but this workspace role cannot open the linked campaign asset." action={<Action>Request access</Action>} />
            <SystemState kind="success" title="Task moved to running" description="Patch received the updated route and started session sess-01JZ9T4P6KE7." action={<Action>View run</Action>} />
          </Grid>
        </Section>
      </PageShell>
    </CandidateDirection>
  )
}

function DirectionStudy({ text200 = false }: { text200?: boolean }) {
  return (
    <main className="bakin-candidate-study">
      <CandidateStyles css={DENSE_CSS} />
      {text200 && <style>{'html { font-size: 200%; }'}</style>}
      <CandidateIntro title={text200 ? 'Dense list and data at 200% text' : 'Dense list and data directions'}>
        Compare identical Tasks, Assets, and Health pressure cases. Both alternatives use candidate tokens and the same proposed composition APIs; neither is selected.
      </CandidateIntro>
      <div className="bakin-candidate-study__directions">
        <DenseDirection direction="operational-neutral" />
        <DenseDirection direction="product-character" />
      </div>
    </main>
  )
}

function StatesStudy() {
  return (
    <main className="bakin-candidate-study">
      <CandidateStyles css={DENSE_CSS} />
      <CandidateIntro title="Dense surface system states">Loading, initial empty, filtered empty, error, permission, and success feedback remain first-class parts of both directions.</CandidateIntro>
      <div className="bakin-candidate-study__directions">
        <StateGallery direction="operational-neutral" />
        <StateGallery direction="product-character" />
      </div>
    </main>
  )
}

const meta = {
  title: 'Direction studies/Dense list and data',
  tags: ['internal'],
  parameters: {
    layout: 'fullscreen',
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'system-states'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const SideBySide = {
  render: () => <DirectionStudy />,
  play: async ({ canvas, userEvent }) => {
    const filters = canvas.getAllByRole('button', { name: 'Needs attention' })
    await userEvent.click(filters[0])
    await expect(filters[0]).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByRole('heading', { name: 'Needs attention work' })).toBeVisible()
  },
} satisfies Story

export const SystemStates = { render: () => <StatesStudy /> } satisfies Story
export const TextAt200Percent = { render: () => <DirectionStudy text200 /> } satisfies Story
