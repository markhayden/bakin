# Models Plugin — Deep Reference

Two layers fix the cold-start problem where `openclaw models list --all --json` takes 15–20 s and would otherwise force the UI to show fake data (issue #129).

## Layer 1: Persistent disk cache

Path: `~/.bakin/plugin-settings/models/available.json`. Owned by `plugins/models/lib/models-cache.ts`.

- Atomic tmp+rename writes
- Zod-validated reads; silent drop on corruption / schema drift
- Two-level read: in-memory hit → disk hydrate → live fetch → honest empty-with-error (**never** falls back to fabricated data)

`fetchAvailableModels` returns `{ models, stale: boolean, error? }`. The client surfaces cached data immediately and kicks off a background `POST /api/plugins/models/refresh` when `stale` is true.

`POST /api/plugins/models/gateway/restart` clears both cache layers (memory + disk).

## Layer 2: Curated catalog

Path: `plugins/models/data/known-models.ts`. Bakin-maintained lookup of ~22 popular models — frontier + OSS, LLM + image + video — with descriptions, tier, cost range, and brand-icon slugs.

Merged into each OpenClaw-sourced `AvailableModel` server-side via `getKnownModel()` / `getKnownProvider()`. Unknown models render plain — **no fabrication**.

## Brand icons

`<BrandIcon>` inlines SVG paths from simple-icons.org (CC0) for the 5 brands we have logos for. Unknown slugs render a first-letter chip in the provider's brand color.

## How to extend

- **Add a model:** PR an entry in `known-models.ts`.
- **Add a brand logo:** inline the SVG path in `brand-icon.tsx`.
- **Never:** fabricate model metadata or invent providers — render plain instead.
