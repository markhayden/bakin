/**
 * Brands plugin — shared types (#419).
 *
 * The zod schemas in lib/schemas.ts are the source of truth; this module
 * re-exports their inferred types plus the client-facing response shapes.
 */
export type {
  BrandManifest,
  PortableBrand,
  PaletteEntry,
  TerminologyEntry,
  BrandSource,
} from './lib/schemas'
export type { BrandDocInfo, BrandDocKind, BrandReadResult } from './lib/store'
export type { Completeness, CompletenessItem, CompletenessSummary } from './lib/completeness'

/** Summary shape returned by the brands.list hook and used by pickers. */
export interface BrandSummary {
  id: string
  name: string
  description?: string
}

/** GET /:brandId response shape. */
export interface BrandDetailResponse {
  brand: import('./lib/schemas').BrandManifest
  guidelines: import('./lib/store').BrandDocInfo[]
  lessons: import('./lib/store').BrandDocInfo[]
  fingerprint: string | null
  completeness: import('./lib/completeness').Completeness
}
