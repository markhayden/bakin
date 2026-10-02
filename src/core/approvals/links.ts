/** Deep links that ride approval cards and decision pages. */

export function bakinBaseUrl(): string {
  return process.env.BAKIN_URL || 'http://localhost:3737'
}

/** The board is the inbox (spec D7): every approval opens its task. */
export function taskUrl(taskId: string): string {
  const url = new URL('/tasks', bakinBaseUrl())
  url.searchParams.set('taskId', taskId)
  return url.toString()
}
