import { describe, expect, it } from 'bun:test'
import type { NetworkInterfaceInfo } from 'os'
import { findCgnatIPv4 } from '../../src/core/network-address'

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` }
}
function v6(address: string): NetworkInterfaceInfo {
  return { address, netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/64`, scopeid: 0 }
}

describe('findCgnatIPv4', () => {
  it('finds the address inside 100.64.0.0/10 (Margo\'s Tailscale address)', () => {
    expect(findCgnatIPv4({ en0: [v4('192.168.1.235')], utun4: [v4('100.80.53.60')] })).toBe('100.80.53.60')
  })

  it('accepts both ends of the range', () => {
    expect(findCgnatIPv4({ a: [v4('100.64.0.0')] })).toBe('100.64.0.0')
    expect(findCgnatIPv4({ a: [v4('100.127.255.255')] })).toBe('100.127.255.255')
  })

  it('rejects addresses just outside the range', () => {
    expect(findCgnatIPv4({ a: [v4('100.63.255.255')], b: [v4('100.128.0.0')], c: [v4('101.64.0.1')] })).toBeNull()
  })

  it('skips internal interfaces and IPv6', () => {
    expect(findCgnatIPv4({ lo0: [v4('100.100.100.100', true)], utun4: [v6('fd7a:115c:a1e0::1')] })).toBeNull()
  })

  it('returns null when nothing matches or there are no interfaces', () => {
    expect(findCgnatIPv4({ en0: [v4('10.0.0.5')] })).toBeNull()
    expect(findCgnatIPv4({})).toBeNull()
    expect(findCgnatIPv4({ en0: undefined })).toBeNull()
  })

  it('is deterministic across interface ordering', () => {
    const one = { utun9: [v4('100.90.0.1')], utun2: [v4('100.70.0.1')] }
    const two = { utun2: [v4('100.70.0.1')], utun9: [v4('100.90.0.1')] }
    expect(findCgnatIPv4(one)).toBe('100.70.0.1')
    expect(findCgnatIPv4(two)).toBe('100.70.0.1')
  })
})
