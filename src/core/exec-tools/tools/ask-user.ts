/**
 * bakin_exec_ask_user — pose ONE structured question to the user in a live
 * conversation (projects revamp D1/D6).
 *
 * The result carries the minted question; the host parks it as a tool receipt
 * (`@bakin/core/conversation/receipts`) and the turn engine attaches it to the
 * tool row as `metadata.bakinQuestion`. The agent reads only the message.
 * Outside a conversation turn nothing redeems the receipt and the call is inert.
 */
import { z } from 'zod'
import { QUESTION_LIMITS, mintQuestionId, validateBakinQuestionInput } from '@bakin/core/conversation/questions'
import { succeed, fail } from './common'
import { addExecTool } from '../registry'

addExecTool({
  name: 'bakin_exec_ask_user',
  label: 'Asked a question',
  description:
    'Ask the user ONE question in a live conversation, shown as an answerable card. ' +
    'Ask only questions that materially change the outcome; one per turn. Give 2-5 mutually ' +
    'exclusive options and set `recommended` to the option you would pick. The card itself always ' +
    'adds "Not sure — help me choose" and (unless `allowOther` is false) a field for the user\'s own ' +
    'answer, so never add your own "help me choose", "other" or "something else" option. After ' +
    'calling, end your turn and wait for the answer. Do not use outside a conversation with the user.',
  source: 'core',
  parameters: {
    question: z.string().describe(`The question (max ${QUESTION_LIMITS.question} chars)`),
    options: z.array(z.object({
      label: z.string().describe(`Short answer (max ${QUESTION_LIMITS.label} chars)`),
      description: z.string().optional().describe(`Why/what it means (max ${QUESTION_LIMITS.description} chars)`),
    })).describe(`${QUESTION_LIMITS.minOptions}-${QUESTION_LIMITS.maxOptions} mutually exclusive options`),
    recommended: z.number().int().optional().describe('Index of the option you recommend'),
    allowOther: z.boolean().optional().describe("Let the user type their own answer instead of picking an option (default true)"),
  },
  handler: async (params) => {
    const input = validateBakinQuestionInput(params)
    if (!input.ok) return fail(`Invalid question — ${input.error}`)
    return succeed({
      message: "Question posted. End your turn and wait for the user's answer.",
      question: { v: 1, id: mintQuestionId(), ...input.value },
    })
  },
})
