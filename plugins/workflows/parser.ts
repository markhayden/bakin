/**
 * YAML workflow definition parser
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import type { WorkflowDefinition } from './types'

const CONTENT_DIR = process.env.CONTENT_DIR || join(process.cwd(), 'content')
const DEFINITIONS_DIR = join(CONTENT_DIR, 'workflows', 'definitions')

/**
 * Parse YAML workflow definition
 * Simple parser - supports basic YAML structure without full YAML library
 */
export function parseYAML(content: string): Record<string, unknown> {
  // For MVP, use a simple line-based parser
  // In production, would use js-yaml
  const lines = content.split('\n')
  const result: Record<string, unknown> = {}
  const stack: { indent: number; obj: Record<string, unknown>; key?: string; arr?: unknown[] }[] = [
    { indent: -1, obj: result },
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('#') || !line.trim()) continue

    const indent = line.search(/\S/)
    const trimmed = line.trim()

    // Pop stack to correct level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const current = stack[stack.length - 1]

    // Array item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim()
      if (!current.arr) {
        current.arr = []
        if (current.key) {
          current.obj[current.key] = current.arr
        }
      }

      if (value.includes(':')) {
        // Object in array
        const obj: Record<string, unknown> = {}
        const [key, val] = value.split(':').map(s => s.trim())
        if (val) {
          obj[key] = parseValue(val)
        }
        current.arr.push(obj)
        stack.push({ indent, obj, arr: undefined, key: undefined })
      } else if (value) {
        current.arr.push(parseValue(value))
      } else {
        // Start of object in array
        const obj: Record<string, unknown> = {}
        current.arr.push(obj)
        stack.push({ indent, obj, arr: undefined, key: undefined })
      }
      continue
    }

    // Key: value pair
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim()
      const value = trimmed.slice(colonIdx + 1).trim()

      if (value) {
        // Simple value
        current.obj[key] = parseValue(value)
      } else {
        // Start of nested object or array
        current.obj[key] = {}
        current.key = key
        stack.push({ indent, obj: current.obj[key] as Record<string, unknown>, key: undefined, arr: undefined })
      }
    }
  }

  return result
}

function parseValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+$/.test(value)) return parseInt(value, 10)
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value)
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Load a workflow definition by name
 */
export function loadDefinition(name: string): WorkflowDefinition | null {
  const filePath = join(DEFINITIONS_DIR, `${name}.yaml`)
  if (!existsSync(filePath)) return null

  const content = readFileSync(filePath, 'utf-8')
  const parsed = parseYAML(content) as unknown as WorkflowDefinition
  return parsed
}

/**
 * List all available workflow definitions
 */
export function listDefinitions(): { name: string; definition: WorkflowDefinition }[] {
  if (!existsSync(DEFINITIONS_DIR)) return []

  return readdirSync(DEFINITIONS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const name = f.replace('.yaml', '')
      const definition = loadDefinition(name)
      return definition ? { name, definition } : null
    })
    .filter((d): d is { name: string; definition: WorkflowDefinition } => d !== null)
}
