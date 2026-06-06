/**
 * Tag normalization — the single source of truth for every path that writes
 * tags (metadata PATCH, global tag ops, bulk apply, createAsset, upload,
 * assets_save). Tags double as the folder namespace in the UI, so consistency
 * matters: "Hello World" and "hello-world" must be the same folder.
 */

/**
 * Normalize one tag: trim, lowercase, collapse internal whitespace to hyphens,
 * then strip everything outside [a-z0-9-]. The charset restriction keeps tags
 * safe as URL params and search facet tokens (Antfly filter queries
 * string-interpolate values), and makes the UI's `__untagged__` filter
 * sentinel structurally uncreatable (underscores are stripped).
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

/** Normalize a tag list: per-tag normalize, drop empties, dedupe (first-seen order). */
export function normalizeTags(tags: string[]): string[] {
  const out: string[] = []
  for (const raw of tags) {
    const tag = normalizeTag(raw)
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}
