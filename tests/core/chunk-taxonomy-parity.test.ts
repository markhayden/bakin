/**
 * The SDK's RuntimeChatChunk is a deliberate hand-copy of core's ChatChunk
 * (two-tier type contract — plugins never import @bakin/core). This pin
 * freezes the two unions together at compile time: if either side gains,
 * loses, or reshapes a variant without the other, the assignments below
 * stop typechecking and this file fails to build.
 */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

// Type-only test, but the content-dir mocks are mandatory belt-and-suspenders
// per CLAUDE.md: nothing in this file may ever resolve ~/.bakin or ~/.openclaw.
const testDir = join(tmpdir(), `bakin-test-chunk-parity-${Date.now()}`)
const mockedContentDir = {
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}
mock.module('../../src/core/content-dir', () => mockedContentDir)
mock.module('../../packages/core/src/content-dir', () => mockedContentDir)

import type { ChatChunk, ChatTextFormat } from '../../packages/core/src/adapters/runtime'
import type { RuntimeChatChunk, RuntimeChatTextFormat } from '../../packages/sdk/src/types/runtime'

// Non-distributive mutual assignability: [A] extends [B] AND [B] extends [A].
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

describe('ChatChunk ↔ RuntimeChatChunk parity', () => {
  it('core and SDK chunk unions are mutually assignable', () => {
    const chunkParity: MutuallyAssignable<ChatChunk, RuntimeChatChunk> = true
    const formatParity: MutuallyAssignable<ChatTextFormat, RuntimeChatTextFormat> = true
    expect(chunkParity).toBe(true)
    expect(formatParity).toBe(true)
  })
})
