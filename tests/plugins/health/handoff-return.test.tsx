/**
 * Handoff return verification (self-healing 1.4c, Codex r1 #12): the
 * arming lives outside any row, and the page-level hook reruns ONCE per
 * arming — on mount (back from the Terminal route), on window focus (back
 * from the operator's own shell) or when the tab becomes visible — and never
 * without a handoff having been taken.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import '../../rtl-settle'

import { armHandoffReturn, disarmHandoffReturn, isHandoffReturnArmed, resetHandoffReturnForTests, useHandoffReturn } from '@bakin/health/components/handoff-return'

function Page({ onReturn }: { onReturn: () => void }) {
  useHandoffReturn(onReturn)
  return <div>health</div>
}

afterEach(() => { cleanup(); resetHandoffReturnForTests() })

describe('useHandoffReturn', () => {
  it('an unarmed page reruns nothing on mount, focus or visibility', () => {
    const onReturn = mock()
    render(<Page onReturn={onReturn} />)
    act(() => { window.dispatchEvent(new Event('focus')) })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(onReturn).not.toHaveBeenCalled()
  })

  it('mounting with an armed handoff IS the return (back from /terminal): one rerun, then disarmed', () => {
    armHandoffReturn('health:runtime:credentials')
    const onReturn = mock()
    render(<Page onReturn={onReturn} />)
    expect(onReturn).toHaveBeenCalledTimes(1)
    expect(isHandoffReturnArmed('health:runtime:credentials')).toBe(false)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('a handoff armed while mounted reruns on the next focus or visible tab, once per arming', () => {
    const onReturn = mock()
    render(<Page onReturn={onReturn} />)
    armHandoffReturn('a')
    armHandoffReturn('b')
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(onReturn).toHaveBeenCalledTimes(1) // two armed incidents, ONE rerun of the checks
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(onReturn).toHaveBeenCalledTimes(1)
    armHandoffReturn('c')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(onReturn).toHaveBeenCalledTimes(2)
  })

  it('a disarmed handoff (the terminal failed to open) reruns nothing; listeners go with the page', () => {
    const onReturn = mock()
    const view = render(<Page onReturn={onReturn} />)
    armHandoffReturn('x')
    disarmHandoffReturn('x')
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(onReturn).not.toHaveBeenCalled()
    view.unmount()
    armHandoffReturn('y')
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(onReturn).not.toHaveBeenCalled()
    expect(isHandoffReturnArmed('y')).toBe(true) // waits for the page to mount again
  })
})
