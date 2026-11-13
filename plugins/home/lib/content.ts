/**
 * Home's curated content: starters and personality presets. Copy a person
 * wrote, kept as data so changing it is never a code change. Validated at
 * load; a malformed file is a startup error, never a silently empty Home.
 */
import { z } from 'zod'
import raw from '../content/home-content.json'

/**
 * What a home must have for a starter to be offered.
 *  - `capability`: a capability slug that must be ready (installed, key set)
 *  - `imageProvider`: a provider that can make images is usable
 *  - `agent`: a specific agent is on the roster
 *  - `attachment`: the person must attach a file; decided in the composer,
 *    never by the server, and never a reason to install something
 */
const starterNeedsSchema = z.object({
  capability: z.string().min(1).optional(),
  imageProvider: z.literal(true).optional(),
  agent: z.string().min(1).optional(),
  attachment: z.literal(true).optional(),
}).strict()

const starterSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(40),
  description: z.string().min(1).max(90),
  /** What is sent to the main agent when the starter is picked. */
  prompt: z.string().min(1),
  needs: starterNeedsSchema,
}).strict()

const personalitySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(40),
  /** One line in this voice, shown so the choice is audible. */
  sample: z.string().min(1).max(140),
  /** The short line stored as the agent's vibe. */
  vibe: z.string().min(1).max(60),
  /** The personality text written for the agent. */
  soul: z.string().min(1),
}).strict()

export const homeContentSchema = z.object({
  version: z.literal(1),
  starters: z.array(starterSchema).min(1),
  personalities: z.array(personalitySchema).min(1),
}).strict().superRefine((content, ctx) => {
  for (const key of ['starters', 'personalities'] as const) {
    const seen = new Set<string>()
    for (const [index, entry] of content[key].entries()) {
      if (seen.has(entry.id)) ctx.addIssue({ code: 'custom', path: [key, index, 'id'], message: `duplicate id "${entry.id}"` })
      seen.add(entry.id)
    }
  }
})

export type HomeContent = z.infer<typeof homeContentSchema>
export type Starter = HomeContent['starters'][number]
export type StarterNeeds = Starter['needs']
export type PersonalityPreset = HomeContent['personalities'][number]

export function parseHomeContent(value: unknown): HomeContent {
  return homeContentSchema.parse(value)
}

/** The shipped content, validated once at module load. */
export const HOME_CONTENT: HomeContent = parseHomeContent(raw)
