/**
 * Discord approval cards (A5/D4/D5): buttoned embeds whose interactions
 * resolve durable Bakin approval records.
 *
 * - The embed FOOTER carries the approvalId (they exceed Discord's 100-char
 *   custom_id limit); interaction payloads include the message, so the flow
 *   is fully restart-safe — no in-memory state is needed to resolve a click.
 * - custom_id stays tiny: `bkap:<optionId>:<flags>` (flags `r` = a reject
 *   modal must require the reason), `bkapm:<optionId>` for modal submits.
 * - Approver allowlist FAILS CLOSED (D4): empty list denies everyone;
 *   unauthorized clicks get an ephemeral reply + delivery.approval_denied
 *   audit and never emit an ApprovalResolveEvent.
 * - Destructive options collect a reason via a Discord modal (D5) — the
 *   first channel surface to honor requireRejectReason honestly.
 * - Discord is transport (D12): the durable record stays the authority;
 *   consumers ignore events for non-pending records.
 */
import type {
  ApprovalOption,
  ApprovalRenderResult,
  ApprovalResolveEvent,
  CancelApprovalArgs,
  CreateApprovalArgs,
  EditApprovalArgs,
  ResolveApprovalArgs,
} from '@bakin/core/adapters/runtime'
import { createLogger } from '@/core/logger'
import { auditDelivery } from '../audit'
import { discordChannelRef } from './refs'

const log = createLogger('delivery-approvals')

const FOOTER_PREFIX = 'approval:'
const BUTTON_PREFIX = 'bkap:'
const MODAL_PREFIX = 'bkapm:'
const REASON_INPUT_ID = 'reason'

/** Discord component/interaction constants (numeric to stay api-types-light). */
const COMPONENT_ACTION_ROW = 1
const COMPONENT_BUTTON = 2
const COMPONENT_TEXT_INPUT = 4
const BUTTON_STYLE: Record<NonNullable<ApprovalOption['variant']> | 'default', number> = {
  primary: 1,
  neutral: 2,
  destructive: 4,
  default: 2,
}
const BUTTON_STYLE_LINK = 5
const TEXT_INPUT_PARAGRAPH = 2
const INTERACTION_MESSAGE_COMPONENT = 3
const INTERACTION_MODAL_SUBMIT = 5

export interface ApprovalSendApi {
  createMessage(channelId: string, payload: Record<string, unknown>): Promise<{ id: string }>
}

/** Interaction-response surface — injectable for tests, bound in client.ts. */
export interface ApprovalApi {
  replyEphemeral(interactionId: string, token: string, content: string): Promise<void>
  updateComponentMessage(interactionId: string, token: string, payload: Record<string, unknown>): Promise<void>
  openModal(interactionId: string, token: string, modal: Record<string, unknown>): Promise<void>
  editMessage(channelId: string, messageId: string, payload: Record<string, unknown>): Promise<void>
}

export interface ApprovalSurfaceDeps {
  api: ApprovalApi
  sendApi: ApprovalSendApi
  /** Live view of settings.integrations.discord.approvers (fail closed). */
  approvers(): string[]
  resolveChannelId(channelRef: string): Promise<string>
}

/** Loosely-typed raw INTERACTION_CREATE payload (gateway shape). */
export interface RawInteraction {
  id: string
  token: string
  type: number
  data?: {
    custom_id?: string
    component_type?: number
    components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }>
  }
  message?: {
    id?: string
    channel_id?: string
    embeds?: Array<{ footer?: { text?: string } }>
  }
  member?: { user?: { id?: string; username?: string } }
  user?: { id?: string; username?: string }
  channel_id?: string
}

export interface ApprovalSurface {
  createApproval(args: CreateApprovalArgs): Promise<ApprovalRenderResult>
  editApproval(args: EditApprovalArgs): Promise<ApprovalRenderResult>
  cancelApproval(args: CancelApprovalArgs): Promise<void>
  resolveApproval(args: ResolveApprovalArgs): Promise<void>
  subscribe(handler: (event: ApprovalResolveEvent) => void): () => void
  handleInteraction(raw: RawInteraction): Promise<void>
}

function approvalIdFromMessage(message: RawInteraction['message']): string | null {
  for (const embed of message?.embeds ?? []) {
    const text = embed.footer?.text
    if (text?.startsWith(FOOTER_PREFIX)) return text.slice(FOOTER_PREFIX.length)
  }
  return null
}

function interactionActor(raw: RawInteraction): { id: string; displayName?: string } | null {
  const user = raw.member?.user ?? raw.user
  if (!user?.id) return null
  return { id: user.id, ...(user.username ? { displayName: user.username } : {}) }
}

function messageIdFromRef(ref: string): string {
  return ref.startsWith('message:') ? ref.slice('message:'.length) : ref
}

export function createApprovalSurface(deps: ApprovalSurfaceDeps): ApprovalSurface {
  const handlers = new Set<(event: ApprovalResolveEvent) => void>()

  function emit(event: ApprovalResolveEvent): void {
    for (const handler of handlers) {
      try {
        handler(event)
      } catch (err) {
        log.error('Approval event handler failed', err, { approvalId: event.approvalId })
      }
    }
  }

  function isApprover(userId: string): boolean {
    return deps.approvers().includes(userId)
  }

  async function editCard(
    deliveries: ResolveApprovalArgs['deliveries'],
    payload: Record<string, unknown>,
  ): Promise<void> {
    for (const delivery of deliveries) {
      const channelId = await deps.resolveChannelId(delivery.channelId)
      await deps.api.editMessage(channelId, messageIdFromRef(delivery.ref), payload)
    }
  }

  return {
    async createApproval(args) {
      const { title, body, options, context } = args.request
      const requireReason = context?.requireRejectReason === true
      const approvalUrl = typeof context?.approvalUrl === 'string' ? context.approvalUrl : null
      // Flags ride the custom_id so clicks are stateless across restarts:
      // 'd' = destructive (always collects a reason via modal, D5),
      // 'r' = the reason input is required (requireRejectReason).
      const buttons: Array<Record<string, unknown>> = options.map(option => ({
        type: COMPONENT_BUTTON,
        style: BUTTON_STYLE[option.variant ?? 'default'],
        label: option.label,
        custom_id: `${BUTTON_PREFIX}${option.id}:${option.variant === 'destructive' ? (requireReason ? 'dr' : 'd') : ''}`,
      }))
      if (approvalUrl) {
        buttons.push({ type: COMPONENT_BUTTON, style: BUTTON_STYLE_LINK, label: 'Review in Bakin', url: approvalUrl })
      }
      const payload = {
        embeds: [{
          title,
          description: body,
          color: 0x3b82f6,
          footer: { text: `${FOOTER_PREFIX}${args.approvalId}` },
        }],
        components: [{ type: COMPONENT_ACTION_ROW, components: buttons }],
      }
      const deliveries = []
      for (const channelRef of args.channels) {
        const channelId = await deps.resolveChannelId(channelRef)
        const message = await deps.sendApi.createMessage(channelId, payload)
        deliveries.push({ channelId: channelRef, ref: `message:${message.id}`, renderedAt: new Date().toISOString() })
      }
      auditDelivery('delivery.approval_rendered', { approvalId: args.approvalId, channels: args.channels })
      return { deliveries }
    },

    async editApproval(args) {
      if (args.patch.body) {
        await editCard(args.deliveries, {
          embeds: [{
            description: args.patch.body,
            footer: { text: `${FOOTER_PREFIX}${args.approvalId}` },
          }],
        })
      }
      return { deliveries: args.deliveries }
    },

    async cancelApproval(args) {
      await editCard(args.deliveries, {
        content: `🚫 Approval cancelled${args.reason ? ` — ${args.reason}` : ''}`,
        components: [],
      })
    },

    async resolveApproval(args) {
      const { selectedOption, actor } = args.response
      const who = actor.displayName ?? actor.id
      await editCard(args.deliveries, {
        content: `✅ Decision recorded: **${selectedOption === 'approve' ? 'Approve' : selectedOption}** by ${who}`,
        components: [],
      })
    },

    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },

    async handleInteraction(raw) {
      const customId = raw.data?.custom_id ?? ''
      const isButton = raw.type === INTERACTION_MESSAGE_COMPONENT && customId.startsWith(BUTTON_PREFIX)
      const isModal = raw.type === INTERACTION_MODAL_SUBMIT && customId.startsWith(MODAL_PREFIX)
      if (!isButton && !isModal) return

      const approvalId = approvalIdFromMessage(raw.message)
      if (!approvalId) return // not one of our cards — leave it alone

      const actor = interactionActor(raw)
      const channelRef = discordChannelRef(raw.message?.channel_id ?? raw.channel_id ?? '')
      if (!actor || !isApprover(actor.id)) {
        auditDelivery('delivery.approval_denied', { approvalId, actor: actor?.id ?? 'unknown', channel: channelRef })
        await deps.api.replyEphemeral(raw.id, raw.token, 'You are not authorized to decide this approval.')
        return
      }

      if (isButton) {
        const [optionId, flags = ''] = customId.slice(BUTTON_PREFIX.length).split(':')
        if (flags.includes('d')) {
          // Destructive option → collect the reason via modal (D5).
          await deps.api.openModal(raw.id, raw.token, {
            custom_id: `${MODAL_PREFIX}${optionId}`,
            title: 'Reject reason',
            components: [{
              type: COMPONENT_ACTION_ROW,
              components: [{
                type: COMPONENT_TEXT_INPUT,
                custom_id: REASON_INPUT_ID,
                style: TEXT_INPUT_PARAGRAPH,
                label: 'Why is this rejected?',
                required: flags.includes('r'),
                max_length: 1000,
              }],
            }],
          })
          return
        }
        emit({
          approvalId,
          channelId: channelRef,
          response: {
            selectedOption: optionId,
            respondedAt: new Date().toISOString(),
            actor: { type: 'human', ...actor },
          },
        })
        await deps.api.updateComponentMessage(raw.id, raw.token, { components: [] })
        return
      }

      // Modal submit — collect the typed reason.
      const optionId = customId.slice(MODAL_PREFIX.length)
      const comment = raw.data?.components
        ?.flatMap(row => row.components ?? [])
        .find(component => component.custom_id === REASON_INPUT_ID)?.value?.trim()
      emit({
        approvalId,
        channelId: channelRef,
        response: {
          selectedOption: optionId,
          respondedAt: new Date().toISOString(),
          actor: { type: 'human', ...actor },
          ...(comment ? { comment } : {}),
        },
      })
      await deps.api.updateComponentMessage(raw.id, raw.token, { components: [] })
    },
  }
}
