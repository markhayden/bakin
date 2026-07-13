---
title: Branding
description: Structured brand definitions — voice, palette, rules, and reference assets injected per-task so agent output stays on brand.
---

The Branding plugin (the paintbrush in the sidebar) gives a multi-brand Bakin
instance a machine-readable source of truth for each brand: how it talks, what
colors it uses, which rules are absolute, and which real assets (logos, product
screenshots) agents should reference. Link a brand to a task — or to a project,
and let its tasks inherit — and every dispatch for that work carries the brand
with it.

## Creating a brand

**New Brand** offers three paths:

- **Build my brand** — answer a short questionnaire and an agent drafts the
  whole kit (voice, style guide, palette, rules) for you to review.
- **From a website** — give it a name, your site or style-guide links, and an
  agent. The agent reads the links and extracts palette, voice, and
  terminology automatically.
- **Import** — bring in an existing kit from GitHub or a folder on disk
  (preview first; nothing is written until you confirm).

The agentic paths land you on the new draft with a banner linking the drafting
task — drafts are invisible to real work until you review and **publish**.
Every brand card shows a **completeness** meter (logo, palette, description,
voice, style guide, rules, terminology, reference assets); the brand's
Overview has the same checklist with jump links to finish the kit.

## Editing

Everything manifest-backed (name, description, palette, rules, terminology,
asset references) stages into one draft — a save bar appears when anything is
unsaved and commits it all at once. Guideline and lesson docs open in a
dedicated full-width editor at `/brands/<id>/docs/...` with its own save.
Deleting a brand lives at the bottom of Settings and requires typing the brand
id.

## What a brand is

A brand is a folder under `~/.bakin/brands/<id>/`:

- **`brand.json`** — the structured half, for machines: a color palette,
  absolute **rules** ("Never use emojis"), terminology do/don'ts, logo slots,
  named **asset groups** pointing at managed assets, and up to four default
  image references.
- **`guidelines/*.md`** — the freeform half, for agents: `voice.md` and
  `style-guide.md` are scaffolded with authoring hints when you create a
  brand. Write how the brand talks; agents read these verbatim.
- **`lessons/*.md`** — learnings that accumulate from real work ("thread
  format flopped on LinkedIn"). The most relevant lessons ride along on
  future tasks automatically.

## Linking and inheritance

Tasks take an optional brand in the task dialog. Resolution is lazy, at
dispatch time: the task's own brand wins; otherwise the nearest parent task's
brand (subtasks inherit); otherwise the project's brand. Re-brand a project
and every un-overridden task follows — no re-stamping.

## What the agent sees

Every branded dispatch opens with a **brand card**: a compliance header, the
absolute rules, palette, terminology, and a map of the deeper guideline docs
and asset groups (with fetch instructions). The card is byte-budgeted
(`dispatch.maxBrandContextBytes`, default 12 KB) — whatever doesn't fit is
listed with a visible omission marker, and agents pull it on demand with the
`bakin_exec_brands_*` tools. The brand detail page shows exactly how many
bytes your card adds to each dispatch.

Image generation takes a `brandId` parameter: the palette merges into the
prompt, your designated reference images attach automatically, and every
render records which brand — and which *version* of the brand — produced it.

## When things go wrong (loudly, never silently)

Delete a brand that pending tasks use and those tasks visibly wait — badged
on the board, with a browser notification linking to the filtered view — and
resume automatically the moment the brand exists again. A brand-linked task
is never dispatched brandless. The `brands.integrity` doctor check flags
dangling asset references, tasks pointing at missing brands, and forgotten
drafts. Each task's detail shows its effective brand, where it came from, and
a record of every brand injection.

## Sharing brands

Brands round-trip through a portable folder format (`brand.json` with relative
file paths + guidelines + lessons + assets), so a brand kit maintained in a
GitHub repo imports directly: `bakin brands import github:user/repo` (preview
first, provenance recorded, `bakin brands check <id>` detects upstream drift).

## CLI

`bakin brands {list, get <id>, import <source>, check <id>, export <id> <dir>, remove <id>}`
