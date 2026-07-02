/**
 * Startup reconcile for file-backed search content types.
 *
 * The watcher hooks (registerSyncHook / registerUnlinkHook) keep the
 * search index consistent with the filesystem WHILE the server is
 * running. This module catches drift that accumulated WHILE the server
 * was offline:
 *
 *   - Files added on disk that never went through the watcher
 *   - Files deleted on disk that left orphan index entries
 *   - Files edited in place (mtime > indexed mtime)
 *
 * The strategy is mtime-aware so steady-state startup is cheap: we
 * compare each file's filesystem mtime against an `_mtime_ms` field
 * that the helper writes alongside the doc. Files whose mtime matches
 * the index are skipped entirely — no read, no embed, no index call.
 *
 * Plugins using `onSync` / `onUnlink` escape hatches lose the cheap
 * mtime path because the plugin owns doc construction; for those, the
 * reconcile re-invokes the escape hatch for every matched file. The
 * tradeoff is documented at the helper API level.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import type {
  FileBackedContentTypeDefinition,
  FilePatternMapper,
} from '../../packages/core/src/plugin-types'
import { createLogger } from './logger'

const log = createLogger('search-reconcile')

/** Field name used to store filesystem mtime alongside indexed docs. */
export const MTIME_FIELD = '_mtime_ms'

// ---------------------------------------------------------------------------
// Glob matching — minimal subset sufficient for filePatterns
// ---------------------------------------------------------------------------

/**
 * Convert a glob pattern to a regex. Supports:
 *   `**`     → match any path segments (including none)
 *   `*`      → match any non-slash run
 *   `{a,b}`  → alternation
 *   literal segments and dots
 */
export function globToRegex(pattern: string): RegExp {
  let re = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` consumes any number of segments (including zero)
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 3
          continue
        }
        re += '.*'
        i += 2
        continue
      }
      re += '[^/]*'
      i += 1
      continue
    }
    if (ch === '{') {
      const close = pattern.indexOf('}', i)
      if (close === -1) {
        re += '\\{'
        i += 1
        continue
      }
      const alts = pattern.slice(i + 1, close).split(',').map(a => a.replace(/[.+^$()|[\]\\]/g, '\\$&'))
      re += `(?:${alts.join('|')})`
      i = close + 1
      continue
    }
    if (ch === '.' || ch === '+' || ch === '^' || ch === '$' || ch === '(' || ch === ')' || ch === '|' || ch === '[' || ch === ']' || ch === '\\') {
      re += '\\' + ch
      i += 1
      continue
    }
    re += ch
    i += 1
  }
  return new RegExp('^' + re + '$')
}

export function matchesAnyPattern(rel: string, patterns: string[]): boolean {
  const normalized = rel.split(sep).join('/')
  for (const p of patterns) {
    if (globToRegex(p).test(normalized)) return true
  }
  return false
}

export function findMatchingMapper(
  rel: string,
  mappers: FilePatternMapper[],
): FilePatternMapper | undefined {
  const normalized = rel.split(sep).join('/')
  for (const m of mappers) {
    if (globToRegex(m.pattern).test(normalized)) return m
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Filesystem walker
// ---------------------------------------------------------------------------

interface FsEntry {
  rel: string
  fullPath: string
  mtimeMs: number
}

/**
 * Walk `contentDir` and yield every file whose relative path matches
 * one of the include patterns and none of the excludes. Skips dotfiles
 * and dotdirs except when explicitly named in a pattern (matches the
 * watcher's behavior).
 */
export function walkFiles(
  contentDir: string,
  includePatterns: string[],
  excludePatterns: string[] = [],
  opts?: { onDirError?: (dir: string, err: unknown) => void },
): FsEntry[] {
  const out: FsEntry[] = []
  const includeRegexes = includePatterns.map(globToRegex)
  const excludeRegexes = excludePatterns.map(globToRegex)

  function recurse(dir: string): void {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as unknown as import('fs').Dirent[]
    } catch (err) {
      opts?.onDirError?.(dir, err)
      return
    }
    for (const entry of entries) {
      const name = String(entry.name)
      const full = join(dir, name)
      const rel = relative(contentDir, full).split(sep).join('/')

      if (name.startsWith('.')) continue
      if (excludeRegexes.some(r => r.test(rel))) continue

      if (entry.isDirectory()) {
        recurse(full)
        continue
      }
      if (entry.isFile() && includeRegexes.some(r => r.test(rel))) {
        try {
          const st = statSync(full)
          out.push({ rel, fullPath: full, mtimeMs: st.mtimeMs })
        } catch {
          // racing delete; skip
        }
      }
    }
  }

  recurse(contentDir)
  return out
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  table: string
  scanned: number
  indexed: number
  removed: number
  skipped: number
  errors: number
}

export interface ReconcileDeps {
  /** Index a doc into the underlying search adapter. */
  index: (key: string, doc: Record<string, unknown>) => Promise<void>
  /** Remove a doc from the underlying search adapter. */
  remove: (key: string) => Promise<void>
  /**
   * Scan the underlying table for existing keys + their indexed mtime.
   * Defaults to an empty scan in tests. Production callers should pass the
   * active SearchAdapter scan implementation.
   */
  scanIndex?: (tableName: string) => AsyncGenerator<{ key: string; mtimeMs: number }>
}

async function* defaultScanIndex(
  tableName: string,
): AsyncGenerator<{ key: string; mtimeMs: number }> {
  void tableName
  yield* []
}

function normalizeVirtualMtime(value: unknown): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

/**
 * Reconcile the search index for one file-backed content type against
 * the current state of `contentDir`. Idempotent.
 *
 * Default flow (no escape hatch):
 *   1. Walk fs, build map of rel→{key, mtime}
 *   2. Scan index, build map of key→indexedMtime
 *   3. For each fs entry whose key is missing or whose mtime > indexedMtime,
 *      read the file, build the doc via mapper.fileToDoc, attach _mtime_ms,
 *      call deps.index.
 *   4. For each indexed key absent from the fs map, call deps.remove.
 *
 * Escape-hatch flow (def.onSync set):
 *   1. Walk fs, call def.onSync(rel, content) for every match.
 *   2. (Orphan removal still runs, using mapper.fileToId to translate
 *      fs rel → key for set membership.)
 */
export async function performStartupReconcile(
  def: FileBackedContentTypeDefinition,
  contentDir: string,
  deps: ReconcileDeps,
): Promise<ReconcileResult> {
  const tableName = def.table.startsWith('bakin_') ? def.table : `bakin_${def.table}`
  const result: ReconcileResult = {
    table: tableName,
    scanned: 0,
    indexed: 0,
    removed: 0,
    skipped: 0,
    errors: 0,
  }

  const includePatterns = def.filePatterns.map(p => p.pattern)
  let walkIncomplete = false
  const fsEntries = walkFiles(contentDir, includePatterns, def.excludePatterns ?? [], {
    onDirError: (dir, err) => {
      walkIncomplete = true
      log.warn('Reconcile fs walk could not read a directory', err, { table: tableName, dir })
    },
  })
  result.scanned = fsEntries.length

  // Build fs key→entry map (mapper.fileToId can return null to skip).
  const fsByKey = new Map<string, { entry: FsEntry; mapper: FilePatternMapper }>()
  for (const entry of fsEntries) {
    const mapper = findMatchingMapper(entry.rel, def.filePatterns)
    if (!mapper) continue
    const key = mapper.fileToId(entry.rel)
    if (key === null) continue
    fsByKey.set(key, { entry, mapper })
  }

  // Build index key→mtime map.
  const indexedMtimes = new Map<string, number>()
  const scanFn = deps.scanIndex ?? defaultScanIndex
  try {
    for await (const { key, mtimeMs } of scanFn(tableName)) {
      indexedMtimes.set(key, mtimeMs)
    }
  } catch (err) {
    log.warn('Index scan failed during reconcile', err, { table: tableName })
  }

  const useEscapeHatch = typeof def.onSync === 'function'
  const reconciledVirtualKeys = new Set<string>()

  if (def.preserveVirtualDocuments && typeof def.reindex === 'function') {
    for await (const item of def.reindex()) {
      const { key, doc } = item
      if (!key || fsByKey.has(key)) continue
      try {
        if (!await def.verifyExists(key)) {
          continue
        }
        const virtualMtime = normalizeVirtualMtime(item.mtimeMs)
        // Skip only when the content type actually provides a freshness stamp.
        // Without this guard, a stamp-less doc reads as 0 on both sides
        // (0 === 0) and would be skipped on every boot after the first —
        // permanently stale. Stamp-less virtual docs keep the pre-stamp
        // behavior: re-indexed every boot.
        if (item.mtimeMs != null && indexedMtimes.has(key) && indexedMtimes.get(key) === virtualMtime) {
          reconciledVirtualKeys.add(key)
          result.skipped++
          continue
        }
        await deps.index(key, { ...doc, [MTIME_FIELD]: virtualMtime })
        reconciledVirtualKeys.add(key)
        result.indexed++
      } catch (err) {
        log.warn('Reconcile virtual index failed', err, { table: tableName, key })
        result.errors++
      }
    }
  }

  for (const [key, { entry, mapper }] of fsByKey) {
    const indexedMtime = indexedMtimes.get(key) ?? 0
    const drift = !indexedMtimes.has(key) || entry.mtimeMs > indexedMtime
    if (!drift) {
      result.skipped++
      continue
    }
    try {
      let content = ''
      if (!entry.rel.startsWith('assets/') || entry.rel.endsWith('.meta.json')) {
        content = readFileSync(entry.fullPath, 'utf-8')
      }
      if (useEscapeHatch) {
        await def.onSync!(entry.rel, content)
        result.indexed++
        continue
      }
      const doc = await mapper.fileToDoc(entry.rel, content)
      if (doc === null) {
        result.skipped++
        continue
      }
      await deps.index(key, { ...doc, [MTIME_FIELD]: entry.mtimeMs })
      result.indexed++
    } catch (err) {
      log.warn('Reconcile index failed', err, { table: tableName, key })
      result.errors++
    }
  }

  // Orphans: indexed keys that no longer exist on disk. A partial fs walk
  // MUST NOT reach this loop's conclusions: if any directory read failed,
  // files under it are missing from fsByKey and every row they back would be
  // deleted as a phantom orphan. Skip orphan removal for this boot — the next
  // clean walk removes real orphans.
  const orphanCandidates = walkIncomplete ? [] : Array.from(indexedMtimes.keys())
  if (walkIncomplete) {
    log.warn('Skipping orphan removal: fs walk was incomplete this boot', { table: tableName })
  }
  for (const indexedKey of orphanCandidates) {
    // Zombie row guard: an empty/nullish key came out of the index. This
    // shouldn't happen in normal writes, but a pre-existing bad row in the
    // underlying store (e.g. a legacy doc with a blank _key) would cause
    // `deps.remove('')` to throw "nonempty key required" on every startup.
    // Skip with a warning so operators know a zombie exists without failing
    // the reconcile.
    if (!indexedKey) {
      log.warn('Reconcile skipped zombie index row with empty key', { table: tableName })
      continue
    }
    if (fsByKey.has(indexedKey)) continue
    if (reconciledVirtualKeys.has(indexedKey)) continue
    try {
      if (def.preserveVirtualDocuments && await def.verifyExists(indexedKey)) {
        result.skipped++
        continue
      }
      // Escape-hatch and default paths both delegate to deps.remove. The
      // plugin can observe the removal through its own bookkeeping if it
      // registered an onUnlink hook.
      await deps.remove(indexedKey)
      result.removed++
    } catch (err) {
      log.warn('Reconcile remove failed', err, { table: tableName, key: indexedKey })
      result.errors++
    }
  }

  log.info('Startup reconcile complete', {
    table: tableName,
    scanned: result.scanned,
    indexed: result.indexed,
    removed: result.removed,
    skipped: result.skipped,
    errors: result.errors,
  })

  return result
}
