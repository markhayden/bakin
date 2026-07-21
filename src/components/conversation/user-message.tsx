'use client'

import {
  UserMessage as FocusedUserMessage,
  type UserMessageProps,
} from '@makinbakin/sdk/conversation'

/** @deprecated Import `UserMessage` from `@makinbakin/sdk/conversation`. */
export function UserMessage(props: UserMessageProps) {
  return <FocusedUserMessage {...props} />
}

export type { UserMessageProps }
