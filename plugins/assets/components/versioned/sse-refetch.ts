/**
 * Trailing-debounce scheduler for SSE-driven grid refetches (#392).
 *
 * An agent mutating assets in a loop fires one `asset.changed` per write;
 * without coalescing every connected tab refetches the full list per event.
 * A burst of schedule() calls inside the window collapses to ONE flush after
 * the burst settles. `asset.removed` events flag the trash list into the same
 * flush. cancel() (unmount) drops any pending flush.
 */
export const SSE_REFETCH_DEBOUNCE_MS = 300

export interface SseRefetchScheduler {
  /** Coalesce a refetch; `withTrash` folds a trash refetch into the flush. */
  schedule: (withTrash: boolean) => void
  /** Drop any pending flush (component unmount). */
  cancel: () => void
}

export function createSseRefetchScheduler(
  fetchAssets: () => void,
  fetchTrash: () => void,
  debounceMs: number = SSE_REFETCH_DEBOUNCE_MS,
): SseRefetchScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let includeTrash = false

  return {
    schedule(withTrash: boolean) {
      includeTrash ||= withTrash
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const withTrashNow = includeTrash
        includeTrash = false
        fetchAssets()
        if (withTrashNow) fetchTrash()
      }, debounceMs)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      includeTrash = false
    },
  }
}
