/**
 * ConversationReplyToast keeps its two name sources (#809): the avatar shows
 * the agent's display-name override (what the kit avatar shows everywhere),
 * the headline the raw agent name the toast always carried. A click dismisses
 * first, then navigates through the router. Pure client component test: the
 * team hooks and the navigation entry are stubbed at the module boundary.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'

const push = mock((_to: string) => {})
mock.module('../../packages/sdk/src/navigation', () => ({
  useRouter: () => ({ push }),
}))
mock.module('../../plugins/team/hooks/use-agent-store', () => ({
  useAgent: (id: string) => ({ id, name: 'Raw Name', headshot: '/agents/pixel/avatar.webp' }),
  useAgentIdentity: (id: string) => ({ id, name: 'Override Name', imageSrc: '/agents/pixel/avatar.webp', color: '#336699' }),
}))

import { ConversationReplyToast } from '../../packages/sdk/src/conversation/reply-toast'

afterEach(() => { push.mockClear() })

describe('ConversationReplyToast', () => {
  it('avatar carries the display-name override, the headline the raw name; click dismisses then navigates', async () => {
    const onNavigate = mock(() => {})
    await act(async () => {
      render(<ConversationReplyToast agentId="pixel" title="replied" preview="on it" to="/chat?chat=c1" onNavigate={onNavigate} testId={{ attr: 'data-chat-toast', value: 'c1' }} />)
    })
    expect(screen.getByLabelText('Override Name')).toBeDefined()
    expect(screen.getByText('Raw Name replied')).toBeDefined()
    expect(screen.getByText('on it')).toBeDefined()
    const button = screen.getByRole('button')
    expect(button.getAttribute('data-chat-toast')).toBe('c1')
    await act(async () => { fireEvent.click(button) })
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/chat?chat=c1')
  })
})
