/**
 * bakin_exec_ask_user — pose ONE structured question to the user in a live
 * conversation (projects revamp D1/D6).
 *
 * The result is deliberately a short token message: neither runtime transport
 * carries structured tool output, so the turn engine looks the token up in
 * the registry and attaches the full question as `metadata.bakinQuestion`.
 * Outside a conversation turn nothing enriches the row and the call is inert.
 */
import { z } from 'zod'
import {
  QUESTION_LIMITS,
  mintQuestionId,
  questionRegistry,
  questionToken,
  validateBakinQuestionInput,
} from '@bakin/core/conversation/questions'
import { succeed, fail } from './common'
import { addExecTool } from '../registry'

addExecTool({
  name: 'bakin_exec_ask_user',
  label: 'Asked a question',
  description:
    'Ask the user ONE question in a live conversation, shown as an answerable card. ' +
    'Ask only questions that materially change the outcome; one per turn. Give 2-5 mutually ' +
    'exclusive options and set `recommended` to the option you would pick. After calling, end ' +
    'your turn and wait for the answer. Do not use outside a conversation with the user.',
  source: 'core',
  parameters: {
    question: z.string().describe(`The question (max ${QUESTION_LIMITS.question} chars)`),
    options: z.array(z.object({
      label: z.string().describe(`Short answer (max ${QUESTION_LIMITS.label} chars)`),
      description: z.string().optional().describe(`Why/what it means (max ${QUESTION_LIMITS.description} chars)`),
    })).describe(`${QUESTION_LIMITS.minOptions}-${QUESTION_LIMITS.maxOptions} mutually exclusive options`),
    recommended: z.number().int().optional().describe('Index of the option you recommend'),
    allowOther: z.boolean().optional().describe('Offer a free-text "Something else" answer (default true)'),
  },
  handler: async (params) => {
    const input = validateBakinQuestionInput(params)
    if (!input.ok) return fail(`Invalid question — ${input.error}`)
    const id = mintQuestionId()
    questionRegistry.put({ v: 1, id, ...input.value })
    return succeed({
      message: `${questionToken(id)} posted. End your turn and wait for the user's answer.`,
    })
  },
})
