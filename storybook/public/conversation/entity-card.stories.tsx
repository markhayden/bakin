import type { Meta, StoryObj } from '@storybook/react-vite'
import { FolderKanban, FolderOpen, CheckSquare } from 'lucide-react'
import { expect } from 'storybook/test'

import { EntityCard } from '@makinbakin/sdk/conversation'
import { PluginLink } from '@makinbakin/sdk/navigation'

import './conversation.stories.css'

const meta = {
  title: 'Components/Conversation/Entity card',
  component: EntityCard,
  tags: ['public'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'EntityCard links to something an agent created or changed, shown in its reply at the point it happened. It composes the row Card: an icon tile, the title, and a "Kind · Created" line, with the whole card as one link. Bakin renders these for you from what a tool reports (`entities` on its result) and the kind its plugin declares in `bakin-plugin.json` — plugins do not place cards themselves. `title` is a snapshot taken when the tool ran. Omit `link` when the kind cannot be resolved (its plugin was removed): the card stays as plain content rather than a dead link.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'long-labels', 'keyboard', 'non-color', 'interaction'],
  },
  // A definite frame: the card fills its container, and a centered canvas has no intrinsic width.
  decorators: [(Story) => <div style={{ inlineSize: 'min(24rem, calc(100vw - 2rem))' }}><Story /></div>],
} satisfies Meta<typeof EntityCard>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  args: {
    label: 'Project',
    title: 'Spring launch plan',
    action: 'created',
    link: <PluginLink to="/projects/spring-launch" />,
  },
  argTypes: {
    action: { control: 'inline-radio', options: ['created', 'updated'] },
    // Elements supplied by the app: the kind's icon and its client-routed link.
    icon: { control: false },
    link: { control: false },
  },
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Open project: Spring launch plan' })
    await expect(link).toHaveAttribute('href', '/projects/spring-launch')
    await expect(canvas.getByText('Project · Created')).toBeVisible()
  },
} satisfies Story

const LONG_TITLE = 'Quarterly partner enablement kit for the northern region resellers, second revision after legal review'

export const StatesInAReply = {
  args: { label: 'Project', title: 'Spring launch plan', action: 'created' },
  render: () => (
    <ul aria-label="Created and updated" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '0.5rem', listStyle: 'none', margin: 0, padding: 0 }}>
      <li>
        <EntityCard label="Project" title="Spring launch plan" action="created" icon={<FolderKanban />} link={<PluginLink to="/projects/spring-launch" />} />
      </li>
      <li>
        <EntityCard label="Task" title="Write the launch brief" action="updated" icon={<CheckSquare />} link={<PluginLink to="/tasks?taskId=t-1" />} />
      </li>
      <li>
        <EntityCard label="Asset" title={LONG_TITLE} action="created" icon={<FolderOpen />} link={<PluginLink to="/assets/kit" />} />
      </li>
      <li>
        {/* The kind's plugin was removed: no icon, no link, named after the kind. */}
        <EntityCard label="Campaign" title="Autumn newsletter" action="updated" />
      </li>
    </ul>
  ),
  play: async ({ canvas, userEvent }) => {
    // Created and updated are told apart in words, not colour.
    await expect(canvas.getByText('Task · Updated')).toBeVisible()
    // A long title stays on one line and keeps its full text reachable.
    const long = canvas.getByText(LONG_TITLE)
    await expect(long).toHaveAttribute('title', LONG_TITLE)
    await expect(long.scrollWidth).toBeGreaterThan(long.clientWidth)
    // An unresolved kind is content, not a link.
    await expect(canvas.getAllByRole('link')).toHaveLength(3)
    await expect(canvas.getByText('Autumn newsletter').closest('[data-slot="card"]')).not.toHaveAttribute('data-interactive')
    // Each card is one tab stop.
    await userEvent.tab()
    await expect(canvas.getByRole('link', { name: 'Open project: Spring launch plan' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('link', { name: 'Open task: Write the launch brief' })).toHaveFocus()
  },
} satisfies Story
