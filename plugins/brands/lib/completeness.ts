/**
 * Kit completeness — the ONE definition of "how finished is this brand".
 *
 * A pure checklist over the manifest + guideline doc contents; the list route
 * summarizes it per brand (cards) and the detail route returns the full
 * checklist (the Overview "finish your kit" card). Doc checks measure real
 * authored content: the scaffold templates are all headings + HTML comments,
 * so stripping those leaves ~nothing until someone actually writes.
 */
import type { BrandManifest } from './schemas'

export interface CompletenessItem {
  key: string
  /** Plain-language checklist label ("Add a logo"). */
  label: string
  done: boolean
  /** Why it matters / what to do — tooltip + checklist hint copy. */
  hint: string
  /** Detail-page tab that fixes it (jump-link target). */
  fixTab: 'identity' | 'guidelines' | 'assets'
}

export interface Completeness {
  percent: number
  items: CompletenessItem[]
}

/** Summary shape carried per brand on the list response. */
export interface CompletenessSummary {
  percent: number
  missing: string[]
}

/** Frontmatter, headings, HTML comments, and list-marker-only lines are scaffold noise, not authored content. */
function authoredLength(doc: string | null): number {
  if (!doc) return 0
  return doc
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim().length
}

/** A doc counts as authored once it has this much non-scaffold text. */
const AUTHORED_MIN_CHARS = 80

export function computeCompleteness(
  manifest: BrandManifest,
  docs: { voice: string | null; styleGuide: string | null },
): Completeness {
  const referenceAssets =
    manifest.assetGroups.reduce((n, g) => n + g.assetIds.length, 0) + (manifest.defaultImageReferences?.length ?? 0)

  const items: CompletenessItem[] = [
    {
      key: 'logo',
      label: 'Add a logo',
      done: manifest.logos.length > 0,
      hint: 'The face of the brand — shown on cards and picked up by image tools.',
      fixTab: 'assets',
    },
    {
      key: 'palette',
      label: 'Set at least 3 colors',
      done: manifest.palette.length >= 3,
      hint: 'Agents pull these exact values into everything they generate.',
      fixTab: 'identity',
    },
    {
      key: 'description',
      label: 'Write a description',
      done: Boolean(manifest.description?.trim()),
      hint: 'One or two sentences on what this brand is — the first thing agents read.',
      fixTab: 'identity',
    },
    {
      key: 'voice',
      label: 'Fill in the voice guide',
      done: authoredLength(docs.voice) >= AUTHORED_MIN_CHARS,
      hint: 'How the brand talks — included with every branded task.',
      fixTab: 'guidelines',
    },
    {
      key: 'style-guide',
      label: 'Fill in the style guide',
      done: authoredLength(docs.styleGuide) >= AUTHORED_MIN_CHARS,
      hint: 'Color usage, imagery, and formatting rules agents follow.',
      fixTab: 'guidelines',
    },
    {
      key: 'rules',
      label: 'Add at least one rule',
      done: (manifest.rules?.length ?? 0) > 0,
      hint: "Hard do's and don'ts — always injected, never optional.",
      fixTab: 'identity',
    },
    {
      key: 'terminology',
      label: 'Add terminology',
      done: (manifest.terminology?.length ?? 0) > 0,
      hint: 'Say-this-not-that words agents must get right.',
      fixTab: 'identity',
    },
    {
      key: 'reference-assets',
      label: 'Add reference assets',
      done: referenceAssets > 0,
      hint: 'Screenshots and imagery agents browse and image tools reference.',
      fixTab: 'assets',
    },
  ]

  const done = items.filter((i) => i.done).length
  return { percent: Math.round((done / items.length) * 100), items }
}

export function summarizeCompleteness(c: Completeness): CompletenessSummary {
  return { percent: c.percent, missing: c.items.filter((i) => !i.done).map((i) => i.key) }
}
