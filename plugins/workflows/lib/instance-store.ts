/**
 * Workflow Instance Store
 *
 * JSON-state-on-disk for workflow instances plus the gate-notified tracking
 * file. Everything here is parameterized by a contentDir and carries no
 * workflow semantics — pure persistence.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import type { WorkflowInstance } from '../types'
import { getContentDir } from './content-dir'

export function generateId(): string {
  return 'wf_' + randomBytes(6).toString('hex')
}

function getInstancesDir(contentDir: string): string {
  return join(contentDir, 'workflows', 'instances')
}

function getInstancePath(contentDir: string, taskId: string): string {
  return join(getInstancesDir(contentDir), `${taskId}.json`)
}

// ─── Instance Persistence ───────────────────────────────────────────────────

export function loadInstance(taskId: string, contentDir?: string): WorkflowInstance | null {
  const dir = contentDir || getContentDir()
  const path = getInstancePath(dir, taskId)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8')) as WorkflowInstance
}

export function saveInstance(instance: WorkflowInstance, contentDir?: string): void {
  const dir = contentDir || getContentDir()
  const instancesDir = getInstancesDir(dir)
  if (!existsSync(instancesDir)) mkdirSync(instancesDir, { recursive: true })
  instance.updatedAt = new Date().toISOString()
  // Atomic: this is the engine's state file — a crash mid-write must never
  // leave a truncated instance behind.
  atomicWriteJson(getInstancePath(dir, instance.taskId), instance)
}

/** Delete a task's workflow instance file. Returns whether one existed. */
/**
 * Record a sticky per-step `team:<id>` resolution (#611). First write wins —
 * a concurrent resolution (or a re-dispatch racing a slow router) reuses the
 * recorded pick instead of overwriting it. Returns the EFFECTIVE resolution.
 */
export function recordStepTeamResolution(
  taskId: string,
  stepId: string,
  resolution: { agentId: string; team: string; reason: string },
  contentDir?: string,
): { agentId: string; team: string; reason: string; at: string } | null {
  const instance = loadInstance(taskId, contentDir)
  if (!instance) return null
  const existing = instance.teamResolutions?.[stepId]
  if (existing) return existing
  const recorded = { ...resolution, at: new Date().toISOString() }
  instance.teamResolutions = { ...instance.teamResolutions, [stepId]: recorded }
  saveInstance(instance, contentDir)
  return recorded
}

export function deleteInstance(taskId: string, contentDir?: string): boolean {
  const dir = contentDir || getContentDir()
  const path = getInstancePath(dir, taskId)
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}

/**
 * List active workflow instances.
 */
export function listInstances(
  statusFilter?: string,
  contentDir?: string
): WorkflowInstance[] {
  const dir = contentDir || getContentDir()
  const instancesDir = getInstancesDir(dir)
  if (!existsSync(instancesDir)) return []

  const files = readdirSync(instancesDir).filter((f: string) => f.endsWith('.json'))

  const instances: WorkflowInstance[] = []
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(instancesDir, file), 'utf-8')) as WorkflowInstance
      if (!statusFilter || data.status === statusFilter) {
        instances.push(data)
      }
    } catch {
      // Skip corrupt instance files
    }
  }

  return instances
}

// ─── Gate Notification Tracking ──────────────────────────────────────────────

function getNotifiedGatesPath(contentDir: string): string {
  return join(contentDir, 'workflows', '.notified-gates.json')
}

function loadNotifiedGates(contentDir: string): Record<string, string> {
  const p = getNotifiedGatesPath(contentDir)
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
  } catch { /* start fresh */ }
  return {}
}

function saveNotifiedGates(data: Record<string, string>, contentDir: string): void {
  const p = getNotifiedGatesPath(contentDir)
  const dir = join(contentDir, 'workflows')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  atomicWriteJson(p, data)
}

export function isGateNotified(taskId: string, stepId: string, contentDir?: string): boolean {
  const dir = contentDir || getContentDir()
  const gates = loadNotifiedGates(dir)
  return `${taskId}:${stepId}` in gates
}

export function markGateNotified(taskId: string, stepId: string, contentDir?: string): void {
  const dir = contentDir || getContentDir()
  const gates = loadNotifiedGates(dir)
  gates[`${taskId}:${stepId}`] = new Date().toISOString()
  saveNotifiedGates(gates, dir)
}

export function clearGateNotified(taskId: string, stepId: string, contentDir?: string): void {
  const dir = contentDir || getContentDir()
  const gates = loadNotifiedGates(dir)
  delete gates[`${taskId}:${stepId}`]
  saveNotifiedGates(gates, dir)
}
