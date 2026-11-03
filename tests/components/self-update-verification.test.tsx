/** The browser verification hook (#1007 D7.11): idle until a handoff, then the shared verifier's outcome. */
import { describe, expect, it, mock, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-self-update-hook-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { act, cleanup, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { actRender } from '../rtl-settle'
import { renderHook } from '@testing-library/react'
import { useSelfUpdateVerification } from '../../packages/sdk/src/hooks/use-self-update-verification'

const realFetch = globalThis.fetch
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

function answers(list: Array<{ version: string; bootId: string; state: 'starting' | 'serving' }>) {
  let index = 0
  globalThis.fetch = (async (url: string | URL | Request) => {
    expect(String(url)).toBe('/api/version')
    const answer = list[Math.min(index, list.length - 1)]!
    index += 1
    return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

describe('useSelfUpdateVerification', () => {
  it('is idle without a handoff, verifying once given one, and reports verified with the summary line', async () => {
    answers([{ version: '0.1.0', bootId: 'old', state: 'serving' }, { version: '0.1.1', bootId: 'new', state: 'starting' }, { version: '0.1.1', bootId: 'new', state: 'serving' }])
    const { result, rerender } = await actRender(() => renderHook(({ handoff }) => useSelfUpdateVerification(handoff, { pollMs: 1 }), { initialProps: { handoff: null as { expectedVersion: string; oldBootId: string } | null } }))
    expect(result.current).toEqual({ status: 'idle' })
    await act(async () => { rerender({ handoff: { expectedVersion: '0.1.1', oldBootId: 'old' } }) })
    expect(result.current.status).toBe('verifying')
    await waitFor(() => expect(result.current.status).toBe('verified'))
    expect(result.current).toMatchObject({ status: 'verified', version: '0.1.1', bootId: 'new', summary: 'verified 0.1.1' })
  })

  it('reports a wrong version as such, and a fresh handoff restarts the verification', async () => {
    answers([{ version: '0.1.0', bootId: 'new', state: 'serving' }])
    const { result, rerender } = await actRender(() => renderHook(({ handoff }) => useSelfUpdateVerification(handoff, { pollMs: 1 }), { initialProps: { handoff: { expectedVersion: '0.1.1', oldBootId: 'old' } } }))
    await waitFor(() => expect(result.current.status).toBe('wrong-version'))
    expect(result.current).toMatchObject({ summary: 'wrong version 0.1.0 (expected 0.1.1)' })
    answers([{ version: '0.1.2', bootId: 'newer', state: 'serving' }])
    // The fresh handoff re-keys the verification; with an immediate answer it lands inside the same act.
    await act(async () => { rerender({ handoff: { expectedVersion: '0.1.2', oldBootId: 'new' } }) })
    await waitFor(() => expect(result.current.status).toBe('verified'))
    expect(result.current).toMatchObject({ version: '0.1.2', bootId: 'newer', handoff: { expectedVersion: '0.1.2', oldBootId: 'new' }, summary: 'verified 0.1.2' })
  })
})
