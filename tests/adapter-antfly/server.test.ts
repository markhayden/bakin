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
})
