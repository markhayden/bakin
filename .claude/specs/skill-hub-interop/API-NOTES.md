# ClawHub API — Observed Reality (T0, verified live 2026-07-27)

Everything below was verified against the live service with curl. These observed
shapes — not the docs — are what `clawhub-client.ts` zod schemas pin (`.passthrough()`,
consumed fields only).

## Base + identity

- Base URL: `https://clawhub.ai` (constant in code; settings override for tests only).
- `/.well-known/clawhub.json` exists (`{apiBase, authBase, minCliVersion, registry}`)
  but we do NOT consume it (D9 — no discovery plumbing).
- Skill page URL (the paste-a-link input): `https://clawhub.ai/{owner}/skills/{slug}`.
- Rate limits observed in headers: `ratelimit-limit: 1200` (download), reads 3000/min
  per docs. Anonymous access sufficient for everything we consume.

## Endpoints we consume (the whole integration)

### 1. Listing/lookup — `GET /api/v1/skills/{slug}` and `GET /api/v1/skills?sort=downloads&limit=N`
- List response: `{ items: [{ slug, displayName, summary, description, topics[],
  tags: {latest}, stats: {comments, downloads, installs, stars, versions},
  createdAt, updatedAt, latestVersion: {version, createdAt, changelog, license},
  metadata }] }`
- **Ambiguous slug behavior (multiple publishers share a slug):** detail/version
  endpoints return `{ code: "AMBIGUOUS_SKILL_SLUG", message, slug, matches: [{
  ownerHandle, slug, ref: "@{owner}/{slug}", url }] }`. The CLI/UI surface this as an
  owner picker. NOTE: `@owner/slug` does NOT work as a path or `slug=` query value —
  disambiguation is via the separate `owner` query param (below).

### 2. Download — `GET /api/v1/download?slug={slug}[&owner={ownerHandle}][&version=|&tag=]`
- Success: `200`, `content-type: application/zip`, body is the bundle ZIP.
- Ambiguous bare slug: `409` with PLAIN TEXT body ("Ambiguous skill slug …") — not
  JSON. Resolve owner via endpoint 1, retry with `&owner=`.
- Unknown slug: `404` plain text.
- Integrity: docs promise `X-ClawHub-Artifact-Sha256`/`Digest` headers; observed
  responses did not always include them → verify WHEN PRESENT, never fabricate
  verification status when absent (label "hash not provided by hub" in preview).
- ZIP layout: files at archive root (`SKILL.md`, `scripts/...`) — no wrapping
  top-level directory observed.

### 3. Verdict — `GET /api/v1/skills/{slug}/scan` (same ambiguity rules)
This is the REAL trust surface. `GET /skills/{slug}/moderation` returned plain-text
"Moderation details unavailable" (likely authed/mod-only) — do not consume it.
Observed scan shape:
```jsonc
{
  "skill": { "slug", "displayName" },
  "version": { "version", "createdAt" },
  "moderation": {
    "scope": "skill",
    "sourceVersion": { "version", "createdAt" },
    "matchesRequestedVersion": true,
    "isPendingScan": false,
    "isMalwareBlocked": false,
    "isSuspicious": false,
    "isHiddenByMod": false,
    "isRemoved": false
  },
  "security": {
    "status": "suspicious",          // observed values: "suspicious"; assume "clean"/"malicious" family
    "hasWarnings": true,
    "checkedAt": 1780090485057,
    "sha256hash": "…",
    "virustotalUrl": "…",
    "scanners": {
      "vt":          { "status": "clean", "normalizedStatus": "clean" },
      "skillspector": { "status": "suspicious", "score": 100, "severity": "CRITICAL",
                        "recommendation": "DO_NOT_INSTALL", "issueCount": 10 },
      "llm":         { "status": "suspicious", "verdict": "suspicious",
                        "confidence": "high", "summary": "…" }
    }
  }
}
```
Live proof the gate matters: `skillscan` (~180k downloads, #7 by downloads) is itself
flagged `security.status: "suspicious"`, skillspector `DO_NOT_INSTALL`.

### Gate policy derived from observed fields (T9)
- REFUSE (hard, no override): `moderation.isMalwareBlocked || isSuspicious ||
  isHiddenByMod || isRemoved`, or `security.status` ∈ {suspicious, malicious}, or any
  scanner `recommendation: "DO_NOT_INSTALL"`.
- REFUSE (fail-closed, D5): scan response doesn't parse to the consumed shape
  (unrecognized semantics ≠ unreachable).
- WARN + proceed with consent: `moderation.isPendingScan: true` ("hub scan pending"),
  scan endpoint UNREACHABLE (network) → "unverified — hub unreachable", download
  lacking the sha header → "hash not provided by hub".

### 4. Versions — `GET /api/v1/skills/{slug}/versions`
`{ items: [{ version, createdAt, changelog, changelogSource }], nextCursor }`.
Consumed only to resolve an explicit `@version` ref to an existing version (and by
tests); latest resolution rides the download endpoint's default.

## Not consumed (deliberately)
`/api/v1/search`, `/packages*`, `/plugins*`, `/resolve`, `/skills/{slug}/file`,
`/undelete`, bulk exports, npm-compat endpoints, `.well-known`. If a need appears,
it's an "Ask first" boundary (SPEC §6).

## Fixture policy
Content fixtures live as DIRECTORIES under `tests/fixtures/skill-bundles/` (see
`README.md` there). Hostile ZIPs (path traversal, symlink escape, absolute paths) are
GENERATED in-test by a helper — no crafted binary archives in git. Scan/listing JSON
fixtures are sanitized captures of the observed shapes above.
