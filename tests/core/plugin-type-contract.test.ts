/**
 * Compile-time pins for the T19 type tightening (audit 2026-07 H3).
 *
 * These tests are enforced by `bun run typecheck` (tests/ is in
 * tsconfig.app.json): if a pin regresses, the FILE stops typechecking —
 * the runtime assertions below are trivially true and exist so the file
 * also runs (and fails loudly) under `bun test`.
 */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod'

// Type-only test, but the content-dir mocks are mandatory belt-and-suspenders
// per CLAUDE.md: nothing in this file may ever resolve ~/.bakin or ~/.openclaw.
const testDir = join(tmpdir(), `bakin-test-type-contract-${Date.now()}`)
const mockedContentDir = {
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
}
mock.module('../../src/core/content-dir', () => mockedContentDir)
mock.module('../../packages/core/src/content-dir', () => mockedContentDir)

import { definePlugin } from '../../packages/core/src/routing'
import type { APIRoute as CoreAPIRoute, PluginContextLite } from '../../packages/core/src/routing'
import type { APIRoute as SdkAPIRoute } from '../../packages/sdk/src/routing'
import type { ExecToolDefinition as SdkExecToolDefinition } from '../../packages/sdk/src/types'
import type { ExecToolDefinition as CoreExecToolDefinition } from '../../packages/core/src/plugin-types'

// Non-distributive mutual assignability.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

describe('plugin type contract (T19)', () => {
  it('definePlugin rejects typo\'d keys at compile time', () => {
    // Baseline: a correct definition compiles.
    const ok = definePlugin({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      activate() {},
    })
    expect(ok.id).toBe('demo')

    definePlugin({
      id: 'demo2',
      name: 'Demo 2',
      version: '1.0.0',
      activate() {},
      // @ts-expect-error — typo'd `settingsSchema` must fail typecheck, not silently no-op
      settingSchema: { fields: [] },
    })

    definePlugin({
      id: 'demo3',
      name: 'Demo 3',
      version: '1.0.0',
      activate() {},
      // @ts-expect-error — typo'd lifecycle hook must fail typecheck
      onReadey() {},
    })
  })

  it('exec-tool handlers infer params from the declared zod shape', () => {
    const tool = {
      name: 'bakin_exec_demo_greet',
      description: 'demo',
      parameters: { who: z.string(), times: z.number().optional() },
      handler: async (params) => {
        // Compile-time: params is inferred, not Record<string, unknown>.
        const who: string = params.who
        const times: number | undefined = params.times
        // @ts-expect-error — unknown keys are rejected on the inferred shape
        params.nope
        return { ok: true, who, times }
      },
    } satisfies SdkExecToolDefinition<{ who: z.ZodString; times: z.ZodOptional<z.ZodNumber> }>
    expect(tool.name).toBe('bakin_exec_demo_greet')

    // NOTE deliberately NOT pinned: SDK vs core ExecToolDefinition are NOT
    // mutually assignable — their handler ctx params live on different tiers
    // (reduced runtime facade vs full adapter). That divergence is the
    // two-tier design, not drift. The shape-level inference above is the
    // author-facing contract.
    type _CoreStillGeneric = CoreExecToolDefinition<{ who: z.ZodString }>
    const coreInference: MutuallyAssignable<Parameters<_CoreStillGeneric['handler']>[0], { who: string }> = true
    expect(coreInference).toBe(true)
  })

  it('there is exactly ONE public APIRoute type (SDK re-exports core\'s)', () => {
    type Sdk = SdkAPIRoute<PluginContextLite, undefined, undefined, undefined>
    type Core = CoreAPIRoute<PluginContextLite, undefined, undefined, undefined>
    const routeParity: MutuallyAssignable<Sdk, Core> = true
    expect(routeParity).toBe(true)
  })
})
