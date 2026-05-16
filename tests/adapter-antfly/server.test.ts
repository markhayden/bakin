import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  checkExternalAntflyStability,
  parseAntflyLogLine,
} from '../../packages/adapter-antfly/src/server'

const realFetch = globalThis.fetch

afterEach(() => {
  ;(globalThis as { fetch: typeof fetch }).fetch = realFetch
})

describe('Antfly server log parsing', () => {
  it('uses the inner Antfly level instead of the child stream level', () => {
    const parsed = parseAntflyLogLine(
      'ts=22:16:17 lvl=info caller=cmd/swarm.go:203 msg="Metadata API server is ready" address=0.0.0.0:8080',
      'warn',
    )

    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('Metadata API server is ready')
    expect(parsed.data).toMatchObject({
      source: 'antfly',
      caller: 'cmd/swarm.go:203',
      address: '0.0.0.0:8080',
    })
  })

  it('demotes transient index reconciliation while a shard is initializing', () => {
    const parsed = parseAntflyLogLine(
      'ts=19:44:56 lvl=warn caller=reconciler/executor.go:300 msg="Failed to add index" shardID=b009cb75eee1aa90 indexName=embeddings error="shard is still initializing"',
      'warn',
    )

    expect(parsed.level).toBe('debug')
    expect(parsed.message).toBe(
      'Antfly reconciler deferred index update until shard initialization completes (indexName=embeddings, shardID=b009cb75eee1aa90)',
    )
    expect(parsed.data).toMatchObject({
      source: 'antfly',
      caller: 'reconciler/executor.go:300',
      shardID: 'b009cb75eee1aa90',
      indexName: 'embeddings',
      error: 'shard is still initializing',
    })
  })

  it('demotes transient schema reconciliation while a shard is initializing', () => {
    const parsed = parseAntflyLogLine(
      'ts=19:44:57 lvl=warn caller=reconciler/executor.go:326 msg="Failed to update schema" shardID=b009cb75eee1aa90 error="shard is still initializing"',
      'warn',
    )

    expect(parsed.level).toBe('debug')
    expect(parsed.message).toBe(
      'Antfly reconciler deferred schema update until shard initialization completes (shardID=b009cb75eee1aa90)',
    )
    expect(parsed.data).toMatchObject({
      source: 'antfly',
      caller: 'reconciler/executor.go:326',
      shardID: 'b009cb75eee1aa90',
      error: 'shard is still initializing',
    })
  })

  it('keeps non-transient warnings visible with useful Antfly fields', () => {
    const parsed = parseAntflyLogLine(
      'ts=19:44:56 lvl=warn caller=reconciler/executor.go:300 msg="Failed to add index" shardID=b009cb75eee1aa90 indexName=embeddings error="invalid vector dimension"',
      'warn',
    )

    expect(parsed.level).toBe('warn')
    expect(parsed.message).toBe(
      'Failed to add index (indexName=embeddings, shardID=b009cb75eee1aa90, error=invalid vector dimension)',
    )
  })

  it('demotes stale shard scans while Antfly metadata catches up', () => {
    const parsed = parseAntflyLogLine(
      'ts=22:18:42 lvl=error caller=scanner msg="Failed to scan shard" shardID=1f50dadf5a77af69 error="shard 1f50dadf5a77af69 not found"',
      'warn',
    )

    expect(parsed.level).toBe('debug')
    expect(parsed.message).toBe(
      'Antfly skipped stale shard scan while metadata catches up (shardID=1f50dadf5a77af69)',
    )
    expect(parsed.data).toMatchObject({
      source: 'antfly',
      caller: 'scanner',
      shardID: '1f50dadf5a77af69',
      error: 'shard 1f50dadf5a77af69 not found',
    })
  })

  it('keeps shard scan errors visible when they are not exact stale-shard misses', () => {
    const parsed = parseAntflyLogLine(
      'ts=22:18:42 lvl=error caller=scanner msg="Failed to scan shard" shardID=1f50dadf5a77af69 error="permission denied"',
      'warn',
    )

    expect(parsed.level).toBe('error')
    expect(parsed.message).toBe(
      'Failed to scan shard (shardID=1f50dadf5a77af69, error=permission denied)',
    )
  })

  it('demotes optional Termite model registry directory warnings', () => {
    const parsed = parseAntflyLogLine(
      'ts=19:54:17 lvl=warn caller=termite/chunker_registry.go:178 msg="Chunker models directory does not exist" dir=/Users/roscoe/.termite/models/chunkers',
      'warn',
    )

    expect(parsed.level).toBe('debug')
    expect(parsed.message).toBe(
      'Antfly skipped optional Termite chunker registry with no local models (dir=/Users/roscoe/.termite/models/chunkers)',
    )
    expect(parsed.data).toMatchObject({
      source: 'antfly',
      caller: 'termite/chunker_registry.go:178',
      dir: '/Users/roscoe/.termite/models/chunkers',
    })
  })

  it('does not trust an external Antfly endpoint that disappears during startup recheck', async () => {
    let calls = 0
    const fetchMock = mock(async () => {
      calls++
      if (calls === 1) {
        return new Response(JSON.stringify({ health: 'healthy' }), { status: 200 })
      }
      throw new Error('connection refused')
    })
    ;(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

    const stability = await checkExternalAntflyStability('http://localhost:8080/api/v1', {
      initialTimeoutMs: 50,
      stableChecks: 1,
      recheckDelayMs: 1,
    })

    expect(stability).toBe('disappeared')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
