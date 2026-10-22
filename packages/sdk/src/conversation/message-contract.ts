/**
 * Compile-time contract between the canonical conversation row types
 * (`@makinbakin/sdk/types`) and the structural copy the dependency-free ui
 * package keeps in `packages/ui/src/conversation/fold.ts`. Private: no barrel
 * re-exports this module; typecheck compiles it, and the public API inventory
 * never sees a new symbol. Either side drifting breaks the build here.
 */
import type { ConversationMessage, DisplayAttachment } from '../types/conversation'
import type {
  ConversationMessage as UiConversationMessage,
  DisplayAttachment as UiDisplayAttachment,
} from '@bakin/ui/conversation'

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const conversationMessageContract: Mutual<UiConversationMessage, ConversationMessage> = true
const displayAttachmentContract: Mutual<UiDisplayAttachment, DisplayAttachment> = true
void conversationMessageContract
void displayAttachmentContract
