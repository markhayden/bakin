import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import {
  ContextMeter,
  ConversationHeader,
  contextMeterHasContent,
  type ContextMeterStats,
} from '@makinbakin/sdk/conversation'
import { Stack } from '@makinbakin/sdk/layout'
import { AgentAvatar } from '@makinbakin/sdk/patterns'
import { Badge, Button, Tooltip, TooltipContent, TooltipTrigger } from '@makinbakin/sdk/ui'

const meta = {
  title: 'Components/Conversation/Header',
  component: ConversationHeader,
  tags: ['public'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'ConversationHeader is the one header treatment for chat-like surfaces: identity avatar, title row with trailing actions, and an optional stable meta line. Chat and the embedded ConversationPanel both compose it — new conversation surfaces must too. The meta line is where ContextMeter (the runtime-truth compaction bar) and usage totals live.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'non-color', 'tooltip'],
  },
} satisfies Meta<typeof ConversationHeader>

export default meta
type Story = StoryObj<typeof meta>

/** Container-typed component: give centered canvases a definite inline size. */
function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ inlineSize: '40rem', maxInlineSize: '90vw' }}>{children}</div>
}

const agent = { id: 'release', name: 'Release agent', imageSrc: null }

const meterStats: ContextMeterStats = {
  tokens: 45_300,
  contextWindow: 272_000,
  compactionThreshold: 255_616,
}

export const CanonicalUsage = {
  args: { title: 'Release review' },
  render: () => (
    <ConversationHeader
      // Container-typed component: centered canvases need a definite inline size.
      style={{ inlineSize: '40rem', maxInlineSize: '90vw' }}
      avatar={<AgentAvatar agent={agent} size="sm" />}
      title="Release review"
      meta={
        <>
          <ContextMeter stats={meterStats} />
          <Badge size="xs" variant="outline">1.2m tokens · $0.84</Badge>
        </>
      }
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Release review')).toBeVisible()
    // Identity is the avatar's own accessible name — no redundant text.
    await expect(canvas.getByRole('img', { name: 'Release agent' })).toBeVisible()
    // The meta line carries the compaction bar with its exact reading.
    await expect(canvas.getByRole('progressbar', { name: /Context 45\.3k of 272k/ })).toBeVisible()
  },
} satisfies Story

function PinnedHeader() {
  const [pinned, setPinned] = useState(false)
  return (
    <ConversationHeader
      avatar={<AgentAvatar agent={agent} size="sm" />}
      title="Release review"
      actions={
        <Tooltip>
          <TooltipTrigger
            render={<Button type="button" variant="ghost" size="icon-sm" />}
            aria-label={pinned ? 'Unpin conversation' : 'Pin conversation'}
            aria-pressed={pinned}
            onClick={() => setPinned((v) => !v)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-bakin-4 fill-none stroke-current stroke-2">
              <path d="M12 17v5m-5-5h10l-1.5-6.5L17 4H7l1.5 6.5Z" strokeLinejoin="round" />
            </svg>
          </TooltipTrigger>
          <TooltipContent>{pinned ? 'Unpin conversation' : 'Pin conversation'}</TooltipContent>
        </Tooltip>
      }
      meta={<ContextMeter stats={meterStats} />}
    />
  )
}

export const HeaderActions = {
  args: { title: 'Release review' },
  render: () => (
    <Frame>
      <PinnedHeader />
    </Frame>
  ),
  play: async ({ canvas, userEvent }) => {
    // The pin action is a toggle with honest pressed state.
    const pin = canvas.getByRole('button', { name: 'Pin conversation' })
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(pin)
    await expect(canvas.getByRole('button', { name: 'Unpin conversation' })).toHaveAttribute('aria-pressed', 'true')
  },
} satisfies Story

const meterCases: Array<{ label: string; stats: ContextMeterStats }> = [
  { label: 'Healthy', stats: { tokens: 45_300, contextWindow: 272_000, compactionThreshold: 255_616 } },
  { label: 'Attention at ≥70%', stats: { tokens: 200_000, contextWindow: 272_000, compactionThreshold: null } },
  { label: 'Danger at ≥90%', stats: { tokens: 250_000, contextWindow: 272_000, compactionThreshold: null } },
  { label: 'Window unknown — number only', stats: { tokens: 45_300, contextWindow: null, compactionThreshold: null } },
  {
    label: 'Post-compaction gap — honest dash',
    stats: {
      tokens: null,
      contextWindow: null,
      compactionThreshold: null,
      lastCompaction: { at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
    },
  },
]

export const MeterStates = {
  args: { title: 'Meter states' },
  render: () => (
    <Frame>
      <Stack gap="item">
        {meterCases.map(({ label, stats }) => (
          <div key={label} className="flex items-center justify-between gap-bakin-4">
            <span className="text-bakin-typography-size-meta text-bakin-text-muted">{label}</span>
            <ContextMeter stats={stats} />
          </div>
        ))}
        {/* Nothing honest to show → the meter renders NOTHING (and the
            predicate consumers use to plan around it agrees). */}
        <div data-testid="meter-empty-probe">
          <ContextMeter stats={{ tokens: null, contextWindow: null, compactionThreshold: null }} />
        </div>
      </Stack>
    </Frame>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('progressbar', { name: /Context 45\.3k of 272k \(16%\)/ })).toBeVisible()
    await expect(canvas.getByRole('progressbar', { name: /\(73%\)/ })).toBeVisible()
    await expect(canvas.getByRole('progressbar', { name: /\(91%\)/ })).toBeVisible()
    await expect(canvas.getByText(/^context 45\.3k$/)).toBeVisible()
    await expect(canvas.getByText(/compacted/)).toBeVisible()
    const probe = canvasElement.querySelector('[data-testid=meter-empty-probe]')
    await expect(probe?.querySelector('[data-context-meter]')).toBeNull()
    await expect(
      contextMeterHasContent({ tokens: null, contextWindow: null, compactionThreshold: null }),
    ).toBe(false)
  },
} satisfies Story

export const TitleOverflowAndNoMeta = {
  args: { title: 'Overflow' },
  render: () => (
    <Frame>
      <ConversationHeader
        avatar={<AgentAvatar agent={agent} size="sm" />}
        title="A very long conversation title that must truncate inside the header instead of pushing the actions out of the frame"
        actions={<Button type="button" variant="ghost" size="xs">Action</Button>}
      />
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const title = canvasElement.querySelector('[data-slot=conversation-header-title]')
    await expect(title?.className ?? '').toContain('min-w-0')
    // No meta content → no meta line reserved.
    await expect(canvasElement.querySelector('[data-slot=conversation-header-meta]')).toBeNull()
  },
} satisfies Story
