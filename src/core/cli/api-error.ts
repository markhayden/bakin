function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function issueMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(issue => {
      if (typeof issue === 'string') return issue.trim()
      if (!isRecord(issue)) return ''
      return textField(issue.message) || textField(issue.error) || textField(issue.detail)
    })
    .filter(Boolean)
}

export function extractApiErrorMessage(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return ''

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return trimmed
  }

  if (typeof parsed === 'string') return parsed.trim()
  if (!isRecord(parsed)) return trimmed

  const primary = textField(parsed.error) || textField(parsed.message) || textField(parsed.detail)
  const issues = issueMessages(parsed.issues)
  if (primary && issues.length > 0) return `${primary}: ${issues.join('; ')}`
  if (primary) return primary
  if (issues.length > 0) return issues.join('; ')
  return trimmed
}

export function formatApiError(status: number, body: string, options: { prefix?: string } = {}): string {
  const prefix = options.prefix ?? 'HTTP'
  const message = extractApiErrorMessage(body)
  return message ? `${prefix} ${status}: ${message}` : `${prefix} ${status}`
}
