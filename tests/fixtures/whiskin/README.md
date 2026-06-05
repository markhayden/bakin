# Whiskin source-only plugin fixtures

Source-only plugin trees (no committed `dist/`) used by the Whiskin build,
publish, and consumer-install phases. They are inert source until a phase
actually builds them:

- `pure-server/` — server-only plugin (no client bundle).
- `server-client/` — server + `client.tsx` (exercises the client build).
- `with-dep/` — declares a pure-JS npm dependency (`bun install` path).

These are intentionally minimal and structurally match a real plugin
(`bakin-plugin.json` + `index.ts` + optional `client.tsx` + `package.json`).
They are first exercised by the shared build backend (Phase 2) and the consumer
install path (Phase 6); expect their shape to be tightened when those land.

See `.claude/specs/whiskin-plugin-builder-plan.md` (Phase 0).
