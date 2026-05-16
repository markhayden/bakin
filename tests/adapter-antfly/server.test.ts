import { describe, expect, it } from 'bun:test'
import { parseAntflyLogLine } from '../../packages/adapter-antfly/src/server'

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
})
