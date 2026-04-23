/**
 * Sample user plugin — client entry (fixture for #147 TE14).
 *
 * Imports `registerSlot` from @bakin/sdk/slots and React hooks from
 * `react` so the smoke test can assert the externals survive the build.
 */
import { registerSlot } from '@bakin/sdk/slots'
import { useMemo } from 'react'
import { jsx } from 'react/jsx-runtime'

function SamplePage(props: { agent?: string }): ReturnType<typeof jsx> {
  const label = useMemo(() => `Sample plugin (${props.agent ?? 'no agent'})`, [props.agent])
  return jsx('div', { children: label })
}

registerSlot('sample.page', SamplePage)

export const navItems = []
