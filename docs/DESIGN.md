# Bakin Docs Design Charter

This document adapts the Makin Bakin brand for technical documentation. The docs are part of the Bakin product surface, but clarity wins over marketing flourish.

## Naming

- Use `Bakin` for the product and app in prose.
- Use `bakin` for the CLI/binary literal.
- Use exact package names such as `@makinbakin/sdk`.
- Existing logo art may include the apostrophe as a brand asset, but page copy should use `Bakin`.

## Voice

- Technical, human, direct.
- Use light Bakin flavor in intros, CTAs, and empty states.
- Keep procedures, warnings, API contracts, examples, and LLM bundles plain and precise.
- Avoid placeholders, TODOs, and speculative promises in public docs.

## Visual System

- Dark mode only.
- Primary accent: neon pink.
- Secondary accent: electric yellow.
- Green appears for app screenshots or semantic status only, not as the docs brand accent.
- Headings: Space Grotesk.
- Body/UI: Inter.
- Code/metadata: JetBrains Mono.
- Use local/self-hosted fonts. No runtime font CDN.

## Content Quality Checklist

Every public page must have:

- clear audience
- clear task or search intent
- title and meta description
- stable canonical URL
- useful opening paragraph
- scannable headings
- concrete examples where useful
- related links
- version/source context where relevant
- no internal-only assumptions
- no TODOs or placeholder copy
- accessibility-safe media and tables
- explicit LLM inclusion decision

Reference pages must include source path, visibility, stability, schemas/examples where applicable, and release-tag GitHub links once the repo is public.

## LLM Docs

- `/llms.txt` is a concise map with summaries and task routing.
- `/llms-full.txt` is Markdown-flavored plain text with curated comprehensive context.
- `/llms/*.md` contains targeted deep-reference bundles.
- Do not use YAML frontmatter in public LLM bundles.
- Do not include analytics scripts in text or Markdown LLM assets.
