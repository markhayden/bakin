/**
 * Compile-time contract between the canonical conversation row types
 * (`@makinbakin/sdk/types`) and the structural copy the dependency-free ui
 * package keeps in `packages/ui/src/conversation/fold.ts`. Private: no barrel
 * re-exports this module; typecheck compiles it, and the public API inventory
 * never sees a new symbol. Either side drifting breaks the build here.
 */
import type { BakinQuestion, ConversationMessage, DisplayAttachment } from '../types/conversation'
import type { BakinQuestion as CoreBakinQuestion, QUESTION_LIMITS } from '@bakin/core/conversation/questions'
import type { QUESTION_RENDER_LIMITS } from '@bakin/ui/conversation/fold'
import type {
  BakinQuestion as UiBakinQuestion,
  ConversationMessage as UiConversationMessage,
  DisplayAttachment as UiDisplayAttachment,
} from '@bakin/ui/conversation'

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const conversationMessageContract: Mutual<UiConversationMessage, ConversationMessage> = true
const displayAttachmentContract: Mutual<UiDisplayAttachment, DisplayAttachment> = true
const bakinQuestionUiContract: Mutual<UiBakinQuestion, BakinQuestion> = true
void bakinQuestionUiContract
const bakinQuestionCoreContract: Mutual<CoreBakinQuestion, BakinQuestion> = true
void bakinQuestionCoreContract
/** The ui render guard enforces exactly the server schema's field limits. */
const questionLimitsContract: Mutual<typeof QUESTION_RENDER_LIMITS, Omit<typeof QUESTION_LIMITS, 'serializedBytes'>> = true
void questionLimitsContract
void conversationMessageContract
void displayAttachmentContract
