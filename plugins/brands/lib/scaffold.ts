/**
 * Starter guideline scaffolding (#419, spec §3.1, story S1).
 *
 * A new brand must never be a blank canvas: creating one seeds voice.md and
 * style-guide.md with headed sections and authoring hints so the operator
 * knows exactly what content moves the needle. Existing files are never
 * overwritten (import and the builder flow skip scaffolding entirely).
 * Templates are string constants — no runtime file resolution, nothing to
 * embed in the binary.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getBakinPaths } from '../../../src/core/content-dir'

const VOICE_TEMPLATE = `---
description: How this brand talks — tone, personality, sentences we would and wouldn't write
---

# Voice & Tone

<!-- Describe how the brand talks. Three adjectives is a great start
     (e.g. "direct, warm, slightly irreverent"). Delete these hints as
     you fill the sections in — agents read this file verbatim. -->

## Personality

<!-- Who is the brand if it were a person? What does it care about?
     What does it refuse to sound like? -->

## Sentences we would write

<!-- 3-5 real examples of on-brand copy. Concrete examples teach agents
     faster than any adjective list. -->

## Sentences we would NEVER write

<!-- 3-5 counter-examples: the tone, cliches, or hype you refuse.
     ("Revolutionize your workflow!" — if that's not you, say so here.) -->

## Audience

<!-- Who reads this? What do they already know? What do they distrust? -->
`

const STYLE_GUIDE_TEMPLATE = `---
description: Visual + editorial style rules — color usage, imagery, formatting conventions
---

# Style Guide

<!-- Structured colors live in the brand's palette (edit them on the
     brand page — image tools consume them from there). Use this file
     for everything the palette can't say. -->

## Color usage

<!-- When does which palette color apply? Backgrounds vs accents vs text.
     Any forbidden combinations. -->

## Imagery

<!-- Photography vs illustration, mood, composition. When should agents
     use real product screenshots (point at an asset group) vs generated
     art? -->

## Formatting conventions

<!-- Headline capitalization, oxford commas, emoji policy, date formats,
     code style in docs — the small rules that make output feel consistent. -->
`

const TEMPLATES: Array<{ rel: string; content: string }> = [
  { rel: join('guidelines', 'voice.md'), content: VOICE_TEMPLATE },
  { rel: join('guidelines', 'style-guide.md'), content: STYLE_GUIDE_TEMPLATE },
]

/** Seed starter guideline files. Returns the relative paths written (empty on re-run). */
export function scaffoldBrand(brandId: string): string[] {
  const dir = join(getBakinPaths().brands, brandId)
  const written: string[] = []
  for (const t of TEMPLATES) {
    const path = join(dir, t.rel)
    if (existsSync(path)) continue
    mkdirSync(join(dir, 'guidelines'), { recursive: true })
    writeFileSync(path, t.content, 'utf-8')
    written.push(t.rel)
  }
  return written
}
