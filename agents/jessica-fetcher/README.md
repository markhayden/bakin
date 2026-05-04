# Jessica Fetcher — agent package

Reference agent package for Bakin's research / multi-source discovery agent.

## Layout

```
agents/jessica-fetcher/
├── bakin-package.json
├── workspace/                 SOUL/IDENTITY/AGENTS/TOOLS templates
├── lessons/
│   ├── source-hierarchy.md    (default-enabled)
│   └── parallel-lanes.md      (opt-in)
└── assets/                    avatar.jpg
```

## Notes

- No bundled OpenClaw skills. Jessica works through the open web + the standard OpenClaw fetch tooling; her competitive advantage is the SOUL/AGENTS prose, not specialized tools.
- Default-enabled lesson: `source-hierarchy` (how to weight different source types when they disagree). The `parallel-lanes` lesson is opt-in for tasks that warrant splitting research into parallel sub-questions.
- Allowed tools include the `bakin_exec_search_*` family — Jessica is the agent who most heavily uses Bakin's search-system surface.

## Install

```bash
bakin agents install ./agents/jessica-fetcher
```
