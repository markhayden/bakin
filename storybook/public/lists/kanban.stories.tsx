import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'
import { Activity, AlertTriangle, GripVertical, Workflow } from 'lucide-react'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import {
  AgentAvatar,
  KanbanBoard,
  KanbanCardSignal,
  KanbanColumn,
  KanbanColumnBody,
  KanbanColumnEmpty,
  KanbanColumnHeader,
  StatusBadge,
  type StatusTone,
} from '@makinbakin/sdk/patterns'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@makinbakin/sdk/ui'

import './kanban.stories.css'

const meta = {
  title: 'Lists/Kanban',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'KanbanBoard owns one labelled horizontal overflow boundary. KanbanColumn supplies a calm structural lane, while each coherent record uses Card. Filled badges identify record state, quiet icon-led metadata carries provenance, and full-width KanbanCardSignal rows carry operational feedback. Consumers retain domain data, drag/drop, routing, and a non-drag movement alternative. A domain drag implementation preserves its proven stable scroll, lane, and keyed sortable wrappers; it previews the record at the exact in-flow insertion position. A pointer clone is supplemental, and whole-lane highlighting is not a placement signal.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'keyboard', 'keyboard-non-drag', 'long-content', 'empty', 'non-color', 'reduced-motion'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface KanbanCanonicalArgs {
  /** Accessible name announced for the board's overflow boundary. */
  label: string
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    label: 'Task board',
  },
  // No meta `component` (the board composes columns), so the knob declares itself.
  argTypes: {
    label: { control: 'text' },
  },
  render: (args: KanbanCanonicalArgs) => (
    <KanbanBoard label={args.label}>
      <KanbanColumn labelledBy="canonical-todo-heading">
        <KanbanColumnHeader>
          <h2 id="canonical-todo-heading">Todo</h2>
        </KanbanColumnHeader>
        <KanbanColumnBody>
          <p>Prepare launch brief</p>
        </KanbanColumnBody>
      </KanbanColumn>
      <KanbanColumn labelledBy="canonical-progress-heading">
        <KanbanColumnHeader>
          <h2 id="canonical-progress-heading">In progress</h2>
        </KanbanColumnHeader>
        <KanbanColumnBody>
          <p>Draft campaign launch copy</p>
        </KanbanColumnBody>
      </KanbanColumn>
    </KanbanBoard>
  ),
  play: async ({ canvas, args }) => {
    const board = canvas.getByRole('region', { name: args.label })
    await expect(board).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Todo' })).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'In progress' })).toBeVisible()
  },
} satisfies StoryObj<KanbanCanonicalArgs>

interface ExampleTaskProps {
  id: string
  title: string
  description: string
  status: string
  tone: StatusTone
  owner: string
  workflow?: string
  signal?: {
    label: string
    detail: string
    tone: StatusTone
    icon?: typeof Activity
  }
  onOpen: (title: string) => void
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" /></svg>
}

function ExampleTask({ id, title, description, status, tone, owner, workflow, signal, onOpen }: ExampleTaskProps) {
  return (
    <Card size="sm" data-example-task={id}>
      <CardHeader>
        <div className="bakin-kanban-story__task-heading">
          <div className="bakin-kanban-story__task-meta">
            <StatusBadge tone={tone} variant="solid" size="xs">{status}</StatusBadge>
            <span>{id}</span>
          </div>
          <CardTitle>
            <h3>
              <Button
                variant="link"
                size="inline"
                className="font-bakin-typography-weight-bold text-bakin-text-primary"
                onClick={() => onOpen(title)}
              >
                {title}
              </Button>
            </h3>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <CardAction>
          <Button variant="ghost" size="icon-xs" aria-label={`Delete ${title}`}>
            <CloseIcon />
          </Button>
        </CardAction>
      </CardHeader>
      {workflow || signal ? (
        <CardContent className="bakin-kanban-story__task-content">
          {workflow ? (
            <div className="bakin-kanban-story__workflow">
              <Workflow aria-hidden="true" />
              <strong>Workflow</strong>
              <span>{workflow}</span>
            </div>
          ) : null}
          {signal ? (
            <KanbanCardSignal tone={signal.tone} label={signal.label} icon={signal.icon}>
              {signal.detail}
            </KanbanCardSignal>
          ) : null}
        </CardContent>
      ) : null}
      <CardFooter>
        <AgentAvatar agent={{ id: owner.toLowerCase(), name: owner }} size="sm" />
        <span>{owner}</span>
      </CardFooter>
    </Card>
  )
}

function LaneHeading({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <KanbanColumnHeader>
      <h2 id={id}>{title}</h2>
      <Badge tone="neutral" variant="outline" size="xs" aria-label={`${count} tasks`}>{count}</Badge>
    </KanbanColumnHeader>
  )
}

function TaskBoardExample() {
  const [opened, setOpened] = useState('No task opened')
  return (
    <main className="bakin-kanban-story">
      <PageShell width="full">
        <Stack gap="section">
          <header className="bakin-kanban-story__intro">
            <p>Operational work / bounded objects</p>
            <h1>Keep lanes quiet and tasks scannable</h1>
            <p>The board owns horizontal overflow. Lanes provide structure; cards carry record identity, status, ownership, and local actions.</p>
          </header>

          <KanbanBoard label="Task board">
            <KanbanColumn labelledBy="todo-lane-heading">
              <LaneHeading id="todo-lane-heading" title="Todo" count={2} />
              <KanbanColumnBody>
                <ExampleTask id="TASK-01" title="Prepare launch brief" description="Collect the final positioning, audience, and channel requirements." status="Todo" tone="accent" owner="Margo" onOpen={setOpened} />
                <ExampleTask id="TASK-02" title="Production publishing approval for the extraordinarily long campaign name" description="Long content wraps inside the object without widening its lane or the page." status="Todo" tone="accent" owner="Rolo" onOpen={setOpened} />
              </KanbanColumnBody>
            </KanbanColumn>

            <KanbanColumn labelledBy="blocked-lane-heading">
              <LaneHeading id="blocked-lane-heading" title="Blocked" count={1} />
              <KanbanColumnBody>
                <ExampleTask id="TASK-03" title="Publish launch announcement" description="The draft is ready, but delivery cannot continue yet." status="Blocked" tone="danger" owner="Pixel" signal={{ label: 'Action required', detail: 'Runtime adapter unavailable', tone: 'danger', icon: AlertTriangle }} onOpen={setOpened} />
              </KanbanColumnBody>
            </KanbanColumn>

            <KanbanColumn labelledBy="in-progress-lane-heading">
              <LaneHeading id="in-progress-lane-heading" title="In progress" count={1} />
              <KanbanColumnBody>
                <ExampleTask id="TASK-04" title="Draft campaign launch copy" description="Current activity updates in place without adding another chip." status="In progress" tone="accent" owner="Rolo" signal={{ label: 'Current turn', detail: 'Writing launch copy…', tone: 'accent', icon: Activity }} onOpen={setOpened} />
              </KanbanColumnBody>
            </KanbanColumn>

            <KanbanColumn labelledBy="review-lane-heading">
              <LaneHeading id="review-lane-heading" title="Review" count={1} />
              <KanbanColumnBody>
                <ExampleTask id="TASK-05" title="Approve final campaign copy" description="One explicit approval remains before publishing." status="Review" tone="attention" owner="Margo" workflow="approval-copy" signal={{ label: 'Needs approval', detail: 'Approve final copy', tone: 'attention', icon: AlertTriangle }} onOpen={setOpened} />
              </KanbanColumnBody>
            </KanbanColumn>

            <KanbanColumn labelledBy="done-lane-heading">
              <LaneHeading id="done-lane-heading" title="Done" count={0} />
              <KanbanColumnBody>
                <p className="bakin-kanban-story__empty">No tasks</p>
              </KanbanColumnBody>
            </KanbanColumn>
          </KanbanBoard>

          <p role="status" className="bakin-kanban-story__opened">{opened}</p>
        </Stack>
      </PageShell>
    </main>
  )
}

type DragPreviewTarget = 'between' | 'empty'

function DragPreviewCard({ clone = false }: { clone?: boolean }) {
  return (
    <Card
      size="sm"
      aria-hidden={clone || undefined}
      data-drag-insertion-preview={clone ? undefined : ''}
      data-drag-pointer-clone={clone ? '' : undefined}
    >
      <CardHeader>
        <div className="bakin-kanban-story__task-meta">
          <GripVertical aria-hidden="true" />
          <StatusBadge tone="accent" variant="solid" size="xs">Todo</StatusBadge>
          <span>TASK-01</span>
        </div>
        <CardTitle><h3>Prepare launch brief</h3></CardTitle>
        <CardDescription>The record appears in-flow at the exact destination while the pointer clone remains distinct.</CardDescription>
      </CardHeader>
      <CardFooter>
        <AgentAvatar agent={{ id: 'margo', name: 'Margo' }} size="sm" />
        <span>Margo</span>
      </CardFooter>
    </Card>
  )
}

function DragFeedbackExample() {
  const [target, setTarget] = useState<DragPreviewTarget>('between')
  const previewInPopulatedLane = target === 'between'

  return (
    <main className="bakin-kanban-story bakin-kanban-story--feedback">
      <PageShell width="full">
        <Stack gap="section">
          <header className="bakin-kanban-story__intro">
            <p>Domain interaction / placement feedback</p>
            <h1>Show the exact destination, not an approximate lane</h1>
            <p>This is a presentation contract, not a drag-and-drop implementation. Domain code keeps its proven sensors, collision model, state, mutations, and stable DOM hierarchy.</p>
          </header>

          <div className="bakin-kanban-story__feedback-controls" role="group" aria-label="Drag preview location">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={previewInPopulatedLane}
              onClick={() => setTarget('between')}
            >
              Preview populated-lane insertion
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={!previewInPopulatedLane}
              onClick={() => setTarget('empty')}
            >
              Preview empty-lane insertion
            </Button>
          </div>

          <div className="bakin-kanban-story__feedback-stage">
            <KanbanBoard label="Drag feedback contract">
              <KanbanColumn labelledBy="feedback-todo-heading">
                <LaneHeading id="feedback-todo-heading" title="Todo" count={1} />
                <KanbanColumnBody>
                  <ExampleTask id="TASK-02" title="Confirm channel owners" description="A second task remains in the source lane while TASK-01 is previewed elsewhere." status="Todo" tone="accent" owner="Rolo" onOpen={() => {}} />
                </KanbanColumnBody>
              </KanbanColumn>

              <KanbanColumn labelledBy="feedback-progress-heading">
                <LaneHeading id="feedback-progress-heading" title="In progress" count={previewInPopulatedLane ? 3 : 2} />
                <KanbanColumnBody>
                  <ExampleTask id="TASK-03" title="Draft campaign copy" description="The preview opens a concrete gap after this task." status="In progress" tone="accent" owner="Pixel" onOpen={() => {}} />
                  {previewInPopulatedLane ? <DragPreviewCard /> : null}
                  <ExampleTask id="TASK-04" title="Prepare image direction" description="This card moves down when the insertion preview occupies the slot above it." status="In progress" tone="accent" owner="Margo" onOpen={() => {}} />
                </KanbanColumnBody>
              </KanbanColumn>

              <KanbanColumn labelledBy="feedback-review-heading">
                <LaneHeading id="feedback-review-heading" title="Review" count={previewInPopulatedLane ? 0 : 1} />
                <KanbanColumnBody>
                  {previewInPopulatedLane ? (
                    <p className="bakin-kanban-story__empty">No tasks</p>
                  ) : (
                    <DragPreviewCard />
                  )}
                </KanbanColumnBody>
              </KanbanColumn>
            </KanbanBoard>

            <aside className="bakin-kanban-story__pointer-clone" aria-label="Supplemental pointer clone">
              <p>Pointer clone · supplemental</p>
              <DragPreviewCard clone />
            </aside>
          </div>

          <p className="bakin-kanban-story__feedback-contract">
            <strong>Required feedback.</strong> The in-flow card marks the exact insertion slot and replaces an empty state when needed. Whole-lane highlighting is not sufficient because it does not communicate placement. Every required move also needs a named keyboard-accessible action.
          </p>
        </Stack>
      </PageShell>
    </main>
  )
}

export const TaskBoardComposition = {
  render: () => <TaskBoardExample />,
  play: async ({ canvas, userEvent }) => {
    const board = canvas.getByRole('region', { name: 'Task board' })
    await expect(canvas.getAllByRole('region', { name: /Todo|Blocked|In progress|Review|Done/ })).toHaveLength(5)
    await expect(board.querySelectorAll('[data-slot="card"]')).toHaveLength(5)
    await expect(board.querySelector('[data-slot="kanban-column"] [data-slot="card"]')).toBeTruthy()
    await expect(board.querySelectorAll('[data-slot="kanban-card-signal"]')).toHaveLength(3)
    const taskButton = canvas.getByRole('button', { name: 'Prepare launch brief' })
    await userEvent.click(taskButton)
    await expect(canvas.getByRole('status', { name: '' })).toHaveTextContent('Prepare launch brief')
    taskButton.blur()
  },
} satisfies Story

export const DragAndDropFeedback = {
  render: () => <DragFeedbackExample />,
  play: async ({ canvas, userEvent }) => {
    const board = canvas.getByRole('region', { name: 'Drag feedback contract' })
    const populatedLane = canvas.getByRole('region', { name: 'In progress' })
    const emptyLane = canvas.getByRole('region', { name: 'Review' })

    await expect(populatedLane.contains(board.querySelector('[data-drag-insertion-preview]'))).toBe(true)
    await expect(board.querySelector('[data-drop-target]')).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: 'Preview empty-lane insertion' }))

    await expect(emptyLane.contains(board.querySelector('[data-drag-insertion-preview]'))).toBe(true)
    await expect(canvas.getByText(/Whole-lane highlighting is not sufficient/)).toBeVisible()
  },
} satisfies Story

/**
 * Workspace mode: the board fills a height-bound parent, lane headers stay
 * pinned, each lane scrolls its own tasks, and the horizontal scrollbar is
 * always at the board's visible bottom edge — never below tall columns.
 */
function WorkspaceFillExample() {
  const laneCards = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => (
      <Card key={i} size="sm">
        <CardHeader>
          <CardTitle>{prefix} task {i + 1}</CardTitle>
        </CardHeader>
      </Card>
    ))
  return (
    <div style={{ blockSize: '22rem' }} className="flex min-h-0 flex-col p-bakin-4">
      <KanbanBoard label="Workspace board" fill>
        <KanbanColumn label="Todo" className="min-h-0">
          <KanbanColumnHeader>
            <h2 className="m-0 text-bakin-typography-size-body font-bakin-typography-weight-semibold">Todo</h2>
            <Badge size="xs" variant="outline">12</Badge>
          </KanbanColumnHeader>
          <KanbanColumnBody scroll data-testid="fill-scroll-lane">
            {laneCards(12, 'Todo')}
          </KanbanColumnBody>
        </KanbanColumn>
        <KanbanColumn label="In progress" className="min-h-0">
          <KanbanColumnHeader>
            <h2 className="m-0 text-bakin-typography-size-body font-bakin-typography-weight-semibold">In progress</h2>
            <Badge size="xs" variant="outline">2</Badge>
          </KanbanColumnHeader>
          <KanbanColumnBody scroll>
            {laneCards(2, 'Active')}
          </KanbanColumnBody>
        </KanbanColumn>
        <KanbanColumn label="Review" className="min-h-0">
          <KanbanColumnHeader>
            <h2 className="m-0 text-bakin-typography-size-body font-bakin-typography-weight-semibold">Review</h2>
            <Badge size="xs" variant="outline">0</Badge>
          </KanbanColumnHeader>
          {/* dropTarget={false} reserves the kit drop-treatment box so a
              drag hover never shifts layout; the empty slot stays a
              legible target. */}
          <KanbanColumnBody scroll dropTarget={false}>
            <KanbanColumnEmpty>No tasks</KanbanColumnEmpty>
          </KanbanColumnBody>
        </KanbanColumn>
      </KanbanBoard>
    </div>
  )
}

export const WorkspaceFill = {
  render: () => <WorkspaceFillExample />,
  play: async ({ canvas, canvasElement }) => {
    const board = canvas.getByRole('region', { name: 'Workspace board' })
    await expect(board.hasAttribute('data-fill')).toBe(true)
    // Fill mode pins the always-reachable horizontal scrollbar: the kit
    // track + thumb render as the region's synced proxy, and the region's
    // own native bar is suppressed while the proxy serves.
    const proxy = document.querySelector('[data-slot=bounded-overflow-scrollbar]')
    await expect(proxy).not.toBeNull()
    await expect(proxy!.querySelector('[data-slot=bounded-overflow-scrollbar-thumb]')).not.toBeNull()
    await expect(board.className).toContain('[scrollbar-width:none]')
    const lane = canvasElement.querySelector('[data-testid=fill-scroll-lane]') as HTMLElement
    await expect(lane.getAttribute('data-scroll')).toBe('')
    // The tall lane owns its vertical overflow — scrolling it moves ONLY it.
    await expect(lane.scrollHeight).toBeGreaterThan(lane.clientHeight)
    lane.scrollTop = 200
    await expect(lane.scrollTop).toBeGreaterThan(0)
    // The scrollable lane is keyboard-reachable.
    await expect(lane.getAttribute('tabindex')).toBe('0')
    // The kit empty-lane slot renders inside a reserved drop-treatment box.
    const empty = canvasElement.querySelector('[data-slot=kanban-column-empty]')
    await expect(empty).not.toBeNull()
    await expect(empty!.textContent).toBe('No tasks')
  },
} satisfies Story
