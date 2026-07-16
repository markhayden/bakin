export interface RequestDeadlineOptions {
  onTimeout?: () => void
  timeoutError?: () => Error
}

/** Bound a promise without allowing a late result to settle the caller twice. */
export function withDeadline<T>(
  pending: Promise<T>,
  timeoutMs: number | undefined,
  options: RequestDeadlineOptions = {},
): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0) return pending
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      options.onTimeout?.()
      reject(options.timeoutError?.() ?? new Error(`Request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    void pending.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
