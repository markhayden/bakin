// @vitest-environment jsdom
/**
 * ContextMeter (#737) — the compaction bar, chat-owned since the frozen
 * `@makinbakin/sdk/components` barrel dropped it (storybook-refit T6.1).
 * Renders ONLY runtime truth: fill + reading when tokens+window are
 * known, tokens-only when the window is unknown, an honest "—" during a
 * post-compaction gap, and NOTHING when there's nothing honest to show.
 * Highlight ≥70%, danger ≥90%, tick at the runtime-reported threshold.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-context-meter-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { cleanup, render } from '@testing-library/react'
import '../../rtl-settle'

import type { RuntimeSessionContextStats as SdkContextStats } from '@makinbakin/sdk/types'
import type { RuntimeSessionContextStats } from '../../../packages/core/src/adapters/runtime'
import {
  ContextMeter,
  contextMeterHasContent,
  type ContextMeterStats,
} from '@makinbakin/sdk/conversation'

// Contract-parity pins: the chat DTO (an alias of the SDK mirror) and the
// core contract must stay mutually assignable — a field added on one side
// fails compile here instead of drifting silently.
const _toContract: RuntimeSessionContextStats = {} as ContextMeterStats
const _toKit: ContextMeterStats = {} as RuntimeSessionContextStats
const _toSdk: SdkContextStats = {} as RuntimeSessionContextStats
const _fromSdk: RuntimeSessionContextStats = {} as SdkContextStats
void _toContract
void _toKit
void _toSdk
void _fromSdk

// Kit selectors (the meter composes the SDK Progress primitive — #737
// semantics ride its slots): the fill is the progress indicator, the
// threshold tick is a track marker.
const FILL = '[data-slot="progress-indicator"]'
const TICK = '[data-slot="progress-marker"]'

describe('ContextMeter', () => {
  it('renders fill + reading + threshold tick when everything is known', () => {
    const { container } = render(
      <ContextMeter stats={{ tokens: 45_300, contextWindow: 272_000, compactionThreshold: 255_616 }} />,
    )
    const meter = container.querySelector('[data-context-meter]')
    expect(meter).not.toBeNull()
    expect(meter!.textContent).toContain('45.3k / 272k (16%)') // 16.65 floors — never optimistic rounding
    const fill = container.querySelector(FILL) as HTMLElement
    expect(fill.style.width).toBe('16%')
    // The accessible value is the same floored percent — one truth, two views.
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement
    expect(bar.getAttribute('aria-valuenow')).toBe('16')
    expect(bar.getAttribute('aria-label')).toBe('Context 45.3k of 272k (16%)')
    expect(container.querySelector(TICK)).not.toBeNull()
    cleanup()
  })

  it('no tick when the threshold is unknown (codex-native)', () => {
    const { container } = render(
      <ContextMeter stats={{ tokens: 45_300, contextWindow: 272_000, compactionThreshold: null }} />,
    )
    expect(container.querySelector(TICK)).toBeNull()
    cleanup()
  })

  it('highlight tone at ≥70%, danger tone at ≥90%', () => {
    const highlight = render(
      <ContextMeter stats={{ tokens: 200_000, contextWindow: 272_000, compactionThreshold: null }} />,
    )
    expect((highlight.container.querySelector(FILL) as HTMLElement).className).toContain(
      'bakin-signal-highlight',
    )
    cleanup()

    const danger = render(
      <ContextMeter stats={{ tokens: 250_000, contextWindow: 272_000, compactionThreshold: null }} />,
    )
    expect((danger.container.querySelector(FILL) as HTMLElement).className).toContain(
      'bakin-signal-danger',
    )
    cleanup()
  })

  it('window unknown → number only, no bar, no percent', () => {
    const { container } = render(
      <ContextMeter stats={{ tokens: 45_300, contextWindow: null, compactionThreshold: null }} />,
    )
    expect(container.textContent).toContain('context 45.3k')
    expect(container.textContent).not.toContain('%')
    expect(container.querySelector(FILL)).toBeNull()
    cleanup()
  })

  it('post-compaction gap → honest unknown with the compaction note', () => {
    const { container } = render(
      <ContextMeter
        stats={{
          tokens: null,
          contextWindow: 272_000,
          compactionThreshold: null,
          lastCompaction: { at: new Date(Date.now() - 120_000).toISOString(), tokensBefore: 253_000 },
        }}
      />,
    )
    expect(container.textContent).toContain('context —')
    expect(container.textContent?.toLowerCase()).toContain('compacted')
    expect(container.querySelector(FILL)).toBeNull()
    cleanup()
  })

  it('nothing honest to show → renders nothing', () => {
    const none = render(<ContextMeter stats={null} />)
    expect(none.container.querySelector('[data-context-meter]')).toBeNull()
    cleanup()
    const unknown = render(<ContextMeter stats={{ tokens: null, contextWindow: null, compactionThreshold: null }} />)
    expect(unknown.container.querySelector('[data-context-meter]')).toBeNull()
    cleanup()
  })

  it('percent floors — 100% appears only when tokens reach the window; 89.x% is not danger', () => {
    const near = render(
      <ContextMeter stats={{ tokens: 271_000, contextWindow: 272_000, compactionThreshold: null }} />,
    )
    expect(near.container.textContent).toContain('(99%)') // 99.63 floors, never a false 100
    cleanup()
    const nearDanger = render(
      <ContextMeter stats={{ tokens: 243_500, contextWindow: 272_000, compactionThreshold: null }} />,
    )
    // 89.5% floors to 89 — highlight, not danger.
    expect((nearDanger.container.querySelector(FILL) as HTMLElement).className).toContain(
      'bakin-signal-highlight',
    )
    cleanup()
  })

  it('contextMeterHasContent is the render-nothing predicate consumers gate separators on', () => {
    expect(contextMeterHasContent(null)).toBe(false)
    expect(contextMeterHasContent({ tokens: null, contextWindow: 272_000, compactionThreshold: null })).toBe(false)
    expect(
      contextMeterHasContent({ tokens: null, contextWindow: null, compactionThreshold: null, lastCompaction: { at: new Date().toISOString() } }),
    ).toBe(true)
    expect(contextMeterHasContent({ tokens: 10, contextWindow: null, compactionThreshold: null })).toBe(true)
  })

  it('fill clamps at 100% even if a runtime misreports', () => {
    const { container } = render(
      <ContextMeter stats={{ tokens: 300_000, contextWindow: 272_000, compactionThreshold: null }} />,
    )
    expect((container.querySelector(FILL) as HTMLElement).style.width).toBe('100%')
    cleanup()
  })

  it('the threshold tick rides the kit marker slot at the reported position', () => {
    const { container } = render(
      // 255,616 / 272,000 = 93.97% → rounds to 94, capped at 99.
      <ContextMeter stats={{ tokens: 45_300, contextWindow: 272_000, compactionThreshold: 255_616 }} />,
    )
    const tick = container.querySelector(TICK) as HTMLElement
    expect(tick.style.insetInlineStart).toBe('94%')
    cleanup()
  })
})
