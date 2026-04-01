# Phase 7: Workflow Editor UI

**Status:** Spec only — not yet implemented
**Dependencies:** Phase 5 workflows audit (complete)

## Problem

Workflow definitions are currently authored as YAML files on disk. There is no UI for creating or editing them. This means only users comfortable with YAML syntax and the workflow schema can define workflows. A visual editor would make workflow authoring accessible from the browser.

## Scope

A full-page editor at `/workflows/[id]/edit` (or `/workflows/new` for creation) that allows building workflow definitions visually.

## Editor Components

### Step Palette
A sidebar or toolbar with draggable step types:
- **Agent Step** — assign an agent, write a task prompt, pick a skill, define expected outputs
- **Gate Step** — configure approval requirements, notification channels, preview steps, approve/reject paths
- **Output Step** — select channels, write content templates, set schedule
- **Parallel Group** — container that executes child steps concurrently
- **Sub-Workflow** — reference another workflow definition by ID

### Canvas (ReactFlow)
- Enable `nodesConnectable={true}` to allow users to draw edges between steps
- Drag steps from palette onto canvas to add them
- Click a step to open its configuration panel
- Visual validation: highlight invalid connections (e.g., cycles, missing dependencies)
- Auto-layout option (top-to-bottom sequential flow)

### Step Configuration Panel
When a step is selected, a right-side panel (or drawer) shows its full configuration:

**Agent step form:**
- Agent picker (AgentSelect component)
- Task description (textarea, markdown supported)
- Skill selector (dropdown of available skills from `/api/plugins/workflows/skills`)
- Expected outputs editor (add/remove output fields with id, type, path)
- Denied tools list (multi-select or tag input)
- Dependencies (select from prior steps)

**Gate step form:**
- Description textarea
- Approval required toggle
- Notification channels editor (channel type + target)
- Preview steps selector (multi-select from prior steps)
- On-approve target (select next step)
- On-reject configuration: goto target step, note_to_agent toggle

**Output step form:**
- Agent picker (optional)
- Skill selector (optional)
- Channel list editor
- Content template editor (key-value pairs, value is textarea)
- Schedule expression input (cron syntax)

**Parallel group:**
- Drag child steps into the group
- Show contained steps list

### Validation
Before saving, validate the definition using the existing `validateDefinition()` from `parser.ts`:
- All steps have unique IDs
- No circular dependencies
- Gate `on_reject.goto` references exist
- `dependsOn` references exist
- Sub-workflow references resolve

### Serialization
- Serialize the ReactFlow graph + step configurations back to a `WorkflowDefinition` object
- Convert to YAML using `js-yaml` and write to disk via a new API route
- Support both creating new definitions and editing existing ones

## API Routes Needed

| Route | Method | Description |
|-------|--------|-------------|
| `/definitions` | POST | Create a new workflow definition |
| `/definitions/:name` | PUT | Update an existing workflow definition |
| `/definitions/:name` | DELETE | Delete a workflow definition |
| `/skills` | GET | List available skills for the skill picker |

## UI/UX Considerations

- Start with a simple linear editor (steps in order, top to bottom) before attempting full freeform graph editing
- Show a YAML preview toggle so advanced users can see/edit the raw YAML
- Undo/redo support (ReactFlow has built-in history APIs)
- Keyboard shortcuts: Delete to remove selected step, Cmd+S to save
- Dirty state tracking with unsaved changes warning

## Out of Scope (for initial version)

- Live collaboration / multi-user editing
- Workflow versioning (track changes over time)
- Template marketplace (share/import workflows)
- Conditional branching beyond gate approve/reject paths
- Workflow variables / input parameter UI
