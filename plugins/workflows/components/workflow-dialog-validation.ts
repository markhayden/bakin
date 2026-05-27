export interface WorkflowDialogFieldErrors {
  name?: string
  id?: string
  description?: string
}

export interface WorkflowDialogServerError {
  error: string | null
  fieldErrors: WorkflowDialogFieldErrors
}

const WORKFLOW_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const EMPTY_DRAFT_SCHEMA_MESSAGE = 'Workflow draft creation is using an old server schema that still requires at least one step. Restart Bakin and try again.'

export function hasWorkflowDialogFieldErrors(errors: WorkflowDialogFieldErrors): boolean {
  return Boolean(errors.name || errors.id || errors.description)
}

export function validateWorkflowDialogFields({
  name,
  id,
  nameRequiredMessage = 'Workflow name is required.',
}: {
  name: string
  id: string
  nameRequiredMessage?: string
}): WorkflowDialogFieldErrors {
  const errors: WorkflowDialogFieldErrors = {}
  const trimmedName = name.trim()
  const trimmedId = id.trim()

  if (!trimmedName) errors.name = nameRequiredMessage
  if (!trimmedId) {
    errors.id = 'Workflow id is required.'
  } else if (!WORKFLOW_ID_PATTERN.test(trimmedId)) {
    errors.id = 'Use lowercase letters, numbers, and hyphens.'
  }

  return errors
}

export function clearWorkflowDialogFieldError(
  errors: WorkflowDialogFieldErrors,
  ...fields: Array<keyof WorkflowDialogFieldErrors>
): WorkflowDialogFieldErrors {
  if (fields.every((field) => !errors[field])) return errors
  const next = { ...errors }
  for (const field of fields) delete next[field]
  return next
}

function issueMessage(issue: unknown): string {
  if (typeof issue === 'string') return issue
  if (issue && typeof issue === 'object' && 'message' in issue) {
    return String((issue as { message: unknown }).message)
  }
  return String(issue)
}

function issuePath(issue: unknown): string[] {
  if (!issue || typeof issue !== 'object' || !('path' in issue)) return []
  const path = (issue as { path: unknown }).path
  if (!Array.isArray(path)) return []
  return path.map(String)
}

export function parseWorkflowDialogServerError(
  data: Record<string, unknown>,
  fallback: string,
): WorkflowDialogServerError {
  const fieldErrors: WorkflowDialogFieldErrors = {}
  const messages: string[] = []
  let emptyDraftSchemaError = false

  const addIssue = (issue: unknown) => {
    const message = issueMessage(issue)
    const [field] = issuePath(issue)

    if (field === 'name') {
      fieldErrors.name = message
      return
    }
    if (field === 'id') {
      fieldErrors.id = message
      return
    }
    if (field === 'description') {
      fieldErrors.description = message
      return
    }
    if (field === 'steps' && /too small|>=1|at least one/i.test(message)) {
      emptyDraftSchemaError = true
      return
    }
    if (/workflow must have at least one step/i.test(message)) {
      emptyDraftSchemaError = true
      return
    }

    messages.push(message)
  }

  if (Array.isArray(data.issues)) {
    for (const issue of data.issues) addIssue(issue)
  }
  if (Array.isArray(data.errors)) {
    for (const issue of data.errors) addIssue(issue)
  }

  const serverError = typeof data.error === 'string' ? data.error : ''
  if (/^id is required$/i.test(serverError)) {
    fieldErrors.id = 'Workflow id is required.'
  } else if (
    serverError &&
    serverError !== 'validation failed' &&
    messages.length === 0 &&
    !emptyDraftSchemaError
  ) {
    messages.push(serverError)
  }

  return {
    fieldErrors,
    error: emptyDraftSchemaError
      ? EMPTY_DRAFT_SCHEMA_MESSAGE
      : messages.length > 0
        ? messages.join(', ')
        : hasWorkflowDialogFieldErrors(fieldErrors)
          ? null
          : fallback,
  }
}
