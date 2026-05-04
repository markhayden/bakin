---
title: Parallel Research Lanes
tags: [research, parallelism, synthesis]
defaultEnabled: false
---

# Parallel Research Lanes

When and how to split a research question into parallel lanes. Wrong call wastes time; right call cuts research time in half.

## When to parallelize

Split into lanes when:
- The question naturally decomposes into independent sub-questions
- The sub-questions hit different source types (docs vs forums vs code)
- Each lane will take more than ~5 minutes solo
- You can hold the synthesis intent in mind while gathering

## When NOT to parallelize

Stay in one lane when:
- The question is small (under 5 minutes total)
- The sub-questions chain — answer to lane 1 changes the question for lane 2
- You're not sure what the question actually is yet — wide single-pass first
- The synthesis would be obvious from any one lane alone

Premature parallelization fragments findings and produces multi-track noise instead of one good answer.

## Standard lane templates

**For technical questions** (4 lanes):
1. **Official docs lane** — what the team intends
2. **Implementation/code lane** — what the code actually does
3. **Community lane** — operator reports, gotchas, war stories
4. **Comparison lane** — adjacent tools / alternatives, for context

**For market/competitive questions** (3 lanes):
1. **Direct sources** — company sites, product pages, pricing
2. **Practitioner discussion** — Reddit, HN, niche forums
3. **Industry analyst lane** — published reports (paywall + summaries)

**For "is X reliable" questions** (3 lanes):
1. **Failure mode lane** — issue trackers, incident reports, post-mortems
2. **Success case lane** — case studies, testimonials (skeptically read)
3. **Comparison lane** — how it stacks vs alternatives users mention

## Synthesis discipline

Every lane MUST roll up into one synthesis. Symptoms of a bad parallelization:
- Final report has 3 sections that don't reference each other
- Different lanes cite contradicting evidence with no resolution
- Reader can't tell what's the answer vs what's the appendix

Fix: spend the last ~20% of the research time forcing the lanes together. What does the union say? Where do they disagree? What's the ONE finding the user takes away?

## Time-boxing

Split the budget BEFORE starting any lane:
- Total budget = T
- Per-lane budget = T × 0.6 / N (lanes overrun; pad)
- Synthesis budget = T × 0.4

Synthesis takes longer than people think. Underbudgeting it leaves you with a pile of unsorted findings.

## When a lane comes back empty

If a lane produces nothing usable, that IS a finding. Report:
- "No primary sources found on this dimension"
- "Community discussion exists but lacks specifics"
- "Implementation evidence absent — closed-source"

Empty lanes still inform the synthesis — they tell the user what's NOT known, which is research too.
