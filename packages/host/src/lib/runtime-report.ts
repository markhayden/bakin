/**
 * Runtime-management page reducers (P3.3) — pure transforms from the
 * /api/runtime/capabilities payload into renderable rows. Kept free of React so the matrix/report logic is
 * unit-testable.
 */

export interface CapabilityRow {
  key: string
  label: string
  /** 'native' | 'shimmed' | 'unavailable' (+ the tool-access style detail). */
  mode: string
  detail?: string
}

const CAPABILITY_LABELS: Record<string, string> = {
  toolCalling: 'Tool calling',
  delivery: 'Channel delivery',
  imageGen: 'Image generation',
  memory: 'Memory',
  sessions: 'Sessions',
  workspaceFiles: 'Workspace files',
}

export interface CapabilitiesPayload {
  toolCalling?: { mode?: string; access?: { style?: string; perTurnToolsMode?: boolean } }
  input?: { imageInput?: boolean; audioInput?: boolean }
  [key: string]: unknown
}

/**
 * `mcp · per-turn tool policy not enforced` — the style plus whether a
 * `toolsMode: 'none'` turn really runs without tools on this runtime (#883
 * honesty; OpenClaw drops the field, Pi enforces it).
 */
function toolAccessDetail(access: { style?: string; perTurnToolsMode?: boolean } | undefined): string | undefined {
  const style = access?.style
  if (!style) return undefined
  if (typeof access?.perTurnToolsMode !== 'boolean') return style
  return `${style} · per-turn tool policy ${access.perTurnToolsMode ? 'enforced' : 'not enforced'}`
}

/** Flatten a CapabilitySet into ordered matrix rows (input modality last). */
export function capabilityRows(capabilities: CapabilitiesPayload | null | undefined): CapabilityRow[] {
  if (!capabilities) return []
  const rows: CapabilityRow[] = []

  const toolCalling = capabilities.toolCalling
  if (toolCalling) {
    rows.push({
      key: 'toolCalling',
      label: CAPABILITY_LABELS.toolCalling,
      mode: toolCalling.mode ?? 'native',
      detail: toolAccessDetail(toolCalling.access),
    })
  }

  for (const [key, label] of Object.entries(CAPABILITY_LABELS)) {
    if (key === 'toolCalling') continue
    const value = capabilities[key]
    if (value && typeof value === 'object' && 'mode' in (value as Record<string, unknown>)) {
      rows.push({ key, label, mode: String((value as { mode: unknown }).mode) })
    }
  }

  const input = capabilities.input
  if (input) {
    const modalities = [
      ...(input.imageInput ? ['image'] : []),
      ...(input.audioInput ? ['audio'] : []),
    ]
    rows.push({
      key: 'input',
      label: 'Model input',
      mode: modalities.length > 0 ? 'native' : 'unavailable',
      detail: modalities.length > 0 ? modalities.join(' + ') : 'text only',
    })
  }

  return rows
}
