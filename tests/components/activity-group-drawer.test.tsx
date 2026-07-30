// @vitest-environment jsdom
/**
 * ActivityGroup collapse behavior + ToolCallDrawer (T3.2) — the tool-call
 * interaction pattern: collapsed human-readable summary header (spinner
 * while live), inline expand to per-call rows, row click → full-detail
 * drawer built on Drawer.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-activity-drawer-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { cleanup, fireEvent, render } from '@testing-library/react'
import '../rtl-settle'

import { ActivityGroup, ToolCallDrawer, humanizeActivity, type ConversationToolCall } from '@makinbakin/sdk/components'

const call = (over: Partial<ConversationToolCall> = {}): ConversationToolCall => ({
  key: over.callId ?? 'c1',
  callId: 'c1',
  toolName: 'web_search',
  status: 'completed',
  summary: 'site:reddit.com openclaw',
  durationMs: 1200,
  ...over,
})

describe('humanizeActivity', () => {
  it('maps known tools, falls back to "Used <tool>", and generalizes mixed groups', () => {
    expect(humanizeActivity([call()])).toBe('Searched the web')
    expect(humanizeActivity([call({ toolName: 'frobnicate' })])).toBe('Used frobnicate')
    expect(humanizeActivity([call(), call({ callId: 'c2', toolName: 'bash' })])).toBe('Used 2 tools')
  })
})

describe('ActivityGroup collapsed header', () => {
  it('collapses by default: header shows label, call count, and total duration; rows hidden', () => {
    const { container } = render(
      <ActivityGroup calls={[call(), call({ callId: 'c2', durationMs: 800 })]} />,
    )
    const header = container.querySelector('button[data-conv-activity-header]')
    expect(header).not.toBeNull()
    expect(header!.textContent).toContain('Searched the web')
    expect(header!.textContent).toContain('2 calls')
    expect(header!.textContent).toContain('2.0s') // 1200 + 800
    expect(container.querySelector('[data-conv-call]')).toBeNull()
  })

  it('spins while any call is running; expanding reveals rows; collapsing hides them again', () => {
    const { container } = render(
      <ActivityGroup calls={[call(), call({ callId: 'c2', status: 'running', durationMs: undefined })]} />,
    )
    expect(container.querySelector('[data-conv-activity-header] .animate-spin')).not.toBeNull()

    const header = container.querySelector('button[data-conv-activity-header]')!
    fireEvent.click(header)
    expect(container.querySelectorAll('[data-conv-call]').length).toBe(2)
    fireEvent.click(header)
    expect(container.querySelector('[data-conv-call]')).toBeNull()
  })

  it('marks a group containing failures', () => {
    const { container } = render(
      <ActivityGroup calls={[call({ status: 'failed' })]} />,
    )
    const header = container.querySelector('[data-conv-activity-header]')
    expect(header!.textContent).toContain('failed')
  })

  it('expanded row click opens the detail callback', () => {
    const opened: string[] = []
    const { container } = render(
      <ActivityGroup calls={[call()]} onOpenCall={(c) => opened.push(c.key)} />,
    )
    fireEvent.click(container.querySelector('button[data-conv-activity-header]')!)
    fireEvent.click(container.querySelector('button[data-conv-call]')!)
    expect(opened).toEqual(['c1'])
    cleanup()
  })
})

describe('ToolCallDrawer', () => {
  it('renders full call detail: name, status, duration, callId, input/output', () => {
    const { baseElement } = render(
      <ToolCallDrawer
        open
        onOpenChange={() => {}}
        call={call({
          inputPreview: '{"query":"site:reddit.com openclaw"}',
          outputPreview: 'Found 3 results',
          metadata: { truncated: true },
        })}
      />,
    )
    const text = baseElement.textContent ?? ''
    expect(text).toContain('web_search')
    expect(text).toContain('completed')
    expect(text).toContain('1.2s')
    expect(text).toContain('c1')
    expect(text).toContain('site:reddit.com openclaw')
    expect(text).toContain('Found 3 results')
    expect(text).toContain('truncated')
    cleanup()
  })
})
