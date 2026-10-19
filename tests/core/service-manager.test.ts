/** #898 K — the loaded service's pid is trusted only when unambiguous. Pure parsers. */
import { describe, expect, it } from 'bun:test'
import { parseLaunchctlPid, parseSystemdMainPid } from '../../src/core/service-manager'

describe('service-manager pid parsers', () => {
  it('trust only one unambiguous pid', () => {
    expect(parseLaunchctlPid('gui = {\n\tpid = 123\n}')).toBe(123)
    expect(parseLaunchctlPid('a = {\n\tpid = 1\n\tpid = 2\n}')).toBeNull()
    expect(parseLaunchctlPid('a = {\n\tstate = running\n\tcoalition = {\n\t\tpid = 9\n\t}\n}')).toBeNull() // nested, not the job's
    expect(parseLaunchctlPid('state = not running')).toBeNull()
    expect(parseSystemdMainPid('MainPID=456\nActiveState=active')).toBe(456)
    expect(parseSystemdMainPid('MainPID=0')).toBeNull()
  })
})
