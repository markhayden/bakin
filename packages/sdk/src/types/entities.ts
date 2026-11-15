/**
 * Entity references — a dependency-free leaf, so the conversation and
 * registration types can both use it without joining an import cycle.
 */

/**
 * Something a tool call created or changed, reported on its result so the
 * conversation shows a card linking to it. `kind` must be one the tool's
 * manifest entry lists under `reports`.
 */
export interface EntityRef {
  /** Public kind id, `<pluginId>:<kind>` (`projects:project`). */
  kind: string
  /** The entity's id; fills `{id}` in the kind's href. */
  id: string
  /** Its title at the time of the call. Cards never look it up again. */
  title: string
  action: 'created' | 'updated'
  /** Values for a compound route's other placeholders. */
  params?: Record<string, string>
}
