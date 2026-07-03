# DRAFT upstream issue — antflydb/antfly

File with: `gh issue create --repo antflydb/antfly --title "..." --body-file <this section>`
After filing, update the issue references in:
- `plugins/assets/lib/search-doc.ts` (EMBED_SAFE_RE comment)
- `tests/plugins/assets/search-doc.test.ts` (webp test name)
- `tests/integration/antfly/workaround-regressions.test.ts` (webp pin)

---

**Title:** Media embedding: a WebP/BMP media_url fails the entire batch with 500 ImageDecodeFailed

## Summary

The image embed pipeline decodes **PNG, JPEG, and GIF only** — `decode()` in
`zig/pkg/inference/src/pipelines/image.zig` falls through to
`error.ImageDecodeFailed` for anything else. When a `remoteMedia`-templated
embeddings index encounters a WebP (or BMP) `media_url`, the **entire batch
write fails with HTTP 500** ("batch failed"):

```
{"level":"err","msg":"public table batch failed table=... err=error.ImageDecodeFailed"}
```

Two problems compound here:

1. **Format coverage.** WebP is the default output of many image pipelines
   (browsers, sharp, image CDNs). No WebP decode means a large share of
   real-world images can't ride the media leg at all.
2. **Blast radius.** One undecodable image fails the *whole* batch — sibling
   documents AND the failing document's own text fields never land. A client
   can't tell a poisoned payload (permanent, will never succeed) from an
   engine hiccup (transient, retry) because both are 500s, so durable write
   queues retry a row that can never succeed.

## Repro (v0.2.0-rc.17, also main @6538c07)

1. Create a table with an embeddings index:
   `template: '{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}'`,
   embedder `antflydb/clipclap`.
2. `POST /db/v1/tables/<t>/batch` with one insert whose `media_url` points at
   a `.webp` file.
3. → HTTP 500 "batch failed"; log shows `error.ImageDecodeFailed`. Docs in
   the same batch without media are also rejected.

## Asks (either helps, both would be great)

- WebP decode support in the image pipeline (or a documented supported-format
  list so clients can gate).
- Per-document error semantics for batch writes: index what's indexable,
  report per-doc failures (or at minimum a 4xx with the offending doc key)
  instead of a wholesale 500 — so clients can classify permanent-vs-transient
  correctly.

## Workaround we're shipping

Bakin points `media_url` at a pre-generated JPEG rendition instead of
originals and drops media for undecodable no-rendition files — pinned by a
regression test that fails when this is fixed upstream.
