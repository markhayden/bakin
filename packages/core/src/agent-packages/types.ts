/**
 * Public type surface for the agent-packages core lib.
 * Re-exports the canonical types from each module so consumers can do
 *   import type { Manifest, Lockfile, InstalledByMarker } from '@bakin/core/agent-packages/types'
 * without reaching into individual files.
 */
export type {
  Manifest,
  AgentManifest,
  SkillPackManifest,
  WorkflowPackManifest,
  LessonPackManifest,
  Dependency,
  PackageKind,
  ParseResult,
} from './manifest'
