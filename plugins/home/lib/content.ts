/**
 * Home's curated content: starters, personality presets, suggestions, the tour and each page's introduction. Copy a person
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
  /**
   * Offered only while this holds. The avatar starter is for an agent with no
   * face yet; once it has one, the plain image starter takes its place.
   */
  when: z.enum(['main-agent-has-avatar', 'main-agent-has-no-avatar']).optional(),
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

const slug = z.string().regex(/^[a-z0-9-]+$/)

/**
 * When a suggestion applies. Each kind is one fact about the home that an
 * existing engine already answers; none of them reads a message.
 *  - `capability-missing`: no installed pack provides the capability
 *  - `capability-needs-key`: a pack provides it, and a required key is not set
 *  - `no-image-provider`: no provider that can make images is usable
 *  - `agent-missing`: a specific agent is not on the roster
 *  - `only-main-agent`: the roster is the main agent alone
 *  - `plugin-missing`: a plugin is not loaded
 *  - `checklist-todo`: a setup checklist item is in the `todo` state
 */
const suggestionConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('capability-missing'), capability: slug }).strict(),
  z.object({ kind: z.literal('capability-needs-key'), capability: slug }).strict(),
  z.object({ kind: z.literal('no-image-provider') }).strict(),
  z.object({ kind: z.literal('agent-missing'), agent: slug }).strict(),
  z.object({ kind: z.literal('only-main-agent') }).strict(),
  z.object({ kind: z.literal('plugin-missing'), plugin: slug }).strict(),
  z.object({ kind: z.literal('checklist-todo'), item: z.string().min(1) }).strict(),
])

/** Pages a suggestion never sends anyone to: a spend limit or a brand is a choice, never a to-do. */
const NEVER_SUGGESTED = ['/spend', '/brands'] as const

const suggestionSchema = z.object({
  id: slug,
  title: z.string().min(1).max(50),
  /** One sentence: what the person gets. */
  payoff: z.string().min(1).max(120),
  /** One step, taken on a page that already exists. */
  action: z.object({
    label: z.string().min(1).max(30),
    href: z.string().regex(/^\/[^/]/, 'must be a path inside Bakin').refine(
      (href) => !NEVER_SUGGESTED.some((path) => href === path || href.startsWith(`${path}/`) || href.startsWith(`${path}?`)),
      'spend limits and brands are never suggested',
    ),
  }).strict(),
  when: suggestionConditionSchema,
}).strict()

/** The icons a tour slide may use; the page maps each name to a drawing. */
export const TOUR_ICONS = ['MessageSquare', 'CheckSquare', 'Users', 'FolderOpen', 'CalendarClock', 'HeartPulse'] as const

/** One slide of the tour: an area of Bakin, in a few sentences. */
const tourSlideSchema = z.object({
  id: slug,
  /** The area's name, as the sidebar writes it. */
  title: z.string().min(1).max(30),
  icon: z.enum(TOUR_ICONS),
  /** Two or three sentences: what the area is for. */
  body: z.string().min(1).max(260),
  /** One thing to do there first. */
  first: z.string().min(1).max(100),
  /** The slide's illustration, a picture the host serves. */
  image: z.string().regex(/^\/tour-[a-z-]+\.jpg$/, 'must be a tour illustration the host serves'),
  /** The area's own page. */
  href: z.string().regex(/^\/[a-z][a-z0-9-]*$/, 'must be a top-level page'),
}).strict()

/** What a page says about itself the first time someone opens it. `id` is the page's plugin. */
const pageIntroductionSchema = z.object({
  id: slug,
  title: z.string().min(1).max(60),
  /** Two sentences: what the page is for and what happens on it. */
  body: z.string().min(1).max(200),
  /** The page's picture, one the host serves. */
  image: z.string().regex(/^\/tour-[a-z-]+\.jpg$/, 'must be an illustration the host serves'),
}).strict()

export const homeContentSchema = z.object({
  version: z.literal(1),
  starters: z.array(starterSchema).min(1),
  personalities: z.array(personalitySchema).min(1),
  suggestions: z.array(suggestionSchema),
  tour: z.array(tourSlideSchema).min(1),
  pageIntroductions: z.array(pageIntroductionSchema),
}).strict().superRefine((content, ctx) => {
  for (const key of ['starters', 'personalities', 'suggestions', 'tour', 'pageIntroductions'] as const) {
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
export type Suggestion = HomeContent['suggestions'][number]
export type SuggestionCondition = Suggestion['when']
export type TourSlide = HomeContent['tour'][number]
export type PageIntroduction = HomeContent['pageIntroductions'][number]

export function parseHomeContent(value: unknown): HomeContent {
  return homeContentSchema.parse(value)
}

/** The shipped content, validated once at module load. */
export const HOME_CONTENT: HomeContent = parseHomeContent(raw)
