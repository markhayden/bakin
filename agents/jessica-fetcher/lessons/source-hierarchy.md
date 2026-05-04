---
title: Source Hierarchy
tags: [core, research, sources]
defaultEnabled: true
---

# Source Hierarchy

How Jessica weights different source types when sources disagree. This isn't a strict order — it's a default that gets adjusted by the question's shape.

## Default ranking (highest → lowest weight)

1. **Primary sources.** The thing itself — the paper, the spec, the API, the original announcement. If you can read the actual document, do that before reading anyone's summary of it.
2. **Direct implementation evidence.** Code in production, runtime behavior, observed outputs. Implementation often reveals what docs got wrong.
3. **Official documentation.** Authoritative on what the team intends; sometimes wrong about what the system actually does.
4. **High-quality practitioner reports.** Engineers writing about real-world use, with specifics and reproducible details. Good blog posts, conference talks, post-mortems.
5. **Community discussion.** GitHub issues, forum threads, Reddit, Hacker News. Excellent for "does this work in practice" questions; weak for "is this technically correct."
6. **Summaries / commentary / news.** Useful for orientation, weak as evidence. Always verify against a higher-tier source before citing.

## When the default flips

The ranking above is a default. Some questions invert it:

- **Operational truth questions** ("does X actually work in production at Y scale?") — practitioner reports often beat official docs. Docs say "supports up to 10k QPS" — three engineers saying "it falls over at 3k" is more useful.
- **Recency-critical questions** (security advisories, model behavior, evolving APIs) — official docs from 8 months ago may be staler than a Reddit thread from yesterday. Date everything.
- **"Is this even legal?" questions** — primary sources are statutes, not blog posts. Skip community discussion entirely; go to the law itself or its official commentary.
- **Cultural / vibe questions** — community discussion IS the primary source. There is no docs page for "is X considered cringe." Go where the people are.

## Confidence calibration

When you report findings, attach a confidence level. Calibration matters more than accuracy — be wrong sometimes, but be wrong with appropriate uncertainty.

| Confidence | Evidence shape                                                     |
|------------|---------------------------------------------------------------------|
| High       | Multiple primary sources agree; reproducible evidence available     |
| Medium     | One primary + multiple secondary sources align                      |
| Low        | Inferred from secondary sources; no primary confirmation            |
| Speculative| Found mentions but can't verify; flag as such                       |

If you're not sure whether something is medium or low, default to low. Overconfident research is worse than no research.

## What kills credibility

- Treating one source as definitive without saying which one and why
- Citing a summary as if it were a primary source
- Hiding disagreement to look more confident
- Rounding "found 2 mentions in passing" up to "the consensus is X"
- Stale dates — citing 2022 numbers when 2025 numbers exist
- "According to [vague gesture]" — name the source or don't claim it
