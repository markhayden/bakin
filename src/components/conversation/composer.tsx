'use client'

import {
  Composer as FocusedComposer,
  type ComposerProps,
} from '@makinbakin/sdk/conversation'

/** @deprecated Import `Composer` from `@makinbakin/sdk/conversation`. */
export function Composer(props: ComposerProps) {
  return <FocusedComposer {...props} />
}

export type {
  ComposerAttachmentItem,
  ComposerAttachments,
  ComposerAttachmentStatus,
  ComposerProps,
} from '@makinbakin/sdk/conversation'
