/**
 * ConversationTurnRow parity pin (#735, same pattern as chunk-taxonomy-parity):
 * the SDK's row union is a deliberate hand-copy of core's (two-tier type
 * contract — plugins never import @bakin/core). If either side gains, loses,
 * or reshapes a variant without the other, the assignments below stop
 * typechecking and this file fails to build.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Type-only test, but the content-dir mocks are mandatory belt-and-suspenders
// per CLAUDE.md: nothing in this file may ever resolve ~/.bakin or ~/.openclaw.
const testDir = join(tmpdir(), `bakin-test-row-parity-${Date.now()}`)
const mockedContentDir = {
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}
mock.module('../../src/core/content-dir', () => mockedContentDir)
mock.module('../../packages/core/src/content-dir', () => mockedContentDir)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { ConversationTurnRow as CoreRow } from '../../src/core/conversation-turns'
import type { ConversationTurnRow as SdkRow } from '../../packages/sdk/src/types/conversation-turns'

// Non-distributive mutual assignability: [A] extends [B] AND [B] extends [A].
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

describe('ConversationTurnRow ↔ SDK ConversationTurnRow parity', () => {
  it('core and SDK row unions are mutually assignable', () => {
    const rowParity: MutuallyAssignable<CoreRow, SdkRow> = true
    expect(rowParity).toBe(true)
  })
})
