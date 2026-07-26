'use client'

import {
  Composer as FocusedComposer,
  writeComposerDraft,
  type ComposerProps,
} from '@makinbakin/sdk/conversation'

/** @deprecated Import `Composer` from `@makinbakin/sdk/conversation`. */
export function Composer(props: ComposerProps) {
  return <FocusedComposer {...props} />
}

export { writeComposerDraft }
export type {
  ComposerAttachmentItem,
  ComposerAttachments,
  ComposerAttachmentStatus,
  ComposerHandle,
  ComposerProps,
} from '@makinbakin/sdk/conversation'
