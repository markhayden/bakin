// @vitest-environment jsdom
/**
 * Retry scoping (#735): retry re-sends the NEWEST user message, so only the
 * FINAL turn may offer "Try again". Once the boot sweep stamps interrupted
 * turns above drained queue content, mid-transcript error turns are routine —
 * a button there would resend the wrong message.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-retry-scope-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
// AgentTurn/AgentAvatar resolve authors via SDK hooks (live fetch-backed
// stores) — stub them so the render stays data-free.
mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: () => null,
  useAgentColor: () => undefined,
}))

import { render } from '@testing-library/react'
import '../rtl-settle'

import { Conversation } from '../../src/components/conversation/conversation'
import type { ConversationTurn } from '../../src/components/conversation/fold'

const userTurn = (key: string, content: string): ConversationTurn => ({
  kind: 'user',
  key,
  ts: '2026-07-26T10:00:00.000Z',
  content,
})

const errorTurn = (key: string): ConversationTurn => ({
  kind: 'agent',
  key,
  ts: '2026-07-26T10:00:01.000Z',
  items: [{ type: 'error', message: 'Interrupted — the server stopped before this reply finished.' }],
  status: 'error',
})

const completeTurn = (key: string): ConversationTurn => ({
  kind: 'agent',
  key,
  ts: '2026-07-26T10:00:02.000Z',
  items: [{ type: 'text', format: 'markdown', content: 'all good' }],
  status: 'complete',
})

describe('Conversation retry scoping (#735)', () => {
  it('offers Try again ONLY on the final turn — never on a mid-transcript error turn', () => {
    const { getAllByText, unmount } = render(
      <Conversation
        turns={[userTurn('u1', 'first'), errorTurn('e1'), userTurn('u2', 'second'), errorTurn('e2')]}
        onRetry={() => {}}
      />,
    )
    // Two error turns, exactly ONE button — on the last turn.
    expect(getAllByText('Try again')).toHaveLength(1)
    unmount()
  })

  it('no button at all when the final turn is not an error', () => {
    const { queryByText, unmount } = render(
      <Conversation
        turns={[userTurn('u1', 'first'), errorTurn('e1'), userTurn('u2', 'second'), completeTurn('c1')]}
        onRetry={() => {}}
      />,
    )
    expect(queryByText('Try again')).toBeNull()
    unmount()
  })
})
