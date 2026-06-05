/**
 * Whiskin build provenance — the `.whiskin/build.json` record stamped into a
 * published artifact at build time and used by the consumer install path +
 * startup verifier to decide whether an artifact is valid for this host.
 *
 * Schema is versioned (WHISKIN_PROVENANCE_VERSION); a host that no longer
 * matches an artifact's `externalsContract` marks it needs-update rather than
 * rebuilding (consumers never build). Part of the Whiskin artifact format
 * (Phase 3). See `.claude/specs/whiskin-plugin-builder.md` (Build Provenance).
 */
import { readFileSync } from 'fs'
import { z } from 'zod'
import { atomicWriteJson } from '@bakin/core/install-core/atomic-write'
import { EXTERNALS_CONTRACT } from './externals'

export const WHISKIN_PROVENANCE_VERSION = 2

/** Filename under the artifact's `.whiskin/` directory. */
export const PROVENANCE_FILENAME = 'build.json'

const ApprovedInstallScriptSchema = z.object({
  package: z.string().min(1),
  version: z.string().min(1),
  reason: z.string().min(1),
})

export const WhiskinBuildProvenanceSchema = z.object({
  version: z.literal(WHISKIN_PROVENANCE_VERSION),
  pluginId: z.string().min(1),
  pluginVersion: z.string().min(1),
  /** Bakin version the artifact was built against. */
  bakinVersion: z.string().min(1),
  /** Resolved compatibility range (from the manifest `bakin` field or stamped at publish). */
  bakinRange: z.string().min(1),
  whiskinVersion: z.string().min(1),
  buildBackend: z.string().min(1),
  platform: z.string().min(1),
  /** Resolved commit SHA for github sources; '' for local. */
  sourceCommitSha: z.string().default(''),
  sourceTreeSha: z.string().min(1),
  manifestSha: z.string().min(1),
  packageLockSha: z.string().optional(),
  externalsContract: z.string().min(1),
  approvedInstallScripts: z.array(ApprovedInstallScriptSchema).default([]),
  outputs: z.object({
    serverEntry: z.string().min(1),
    clientEntry: z.string().optional(),
    clientCss: z.string().optional(),
    /** node_modules paths kept for native/runtime deps the bundle can't inline. */
    runtimeModules: z.array(z.string()).optional(),
  }),
  builtAt: z.string().min(1),
})

export type WhiskinBuildProvenance = z.infer<typeof WhiskinBuildProvenanceSchema>

/** Validate an untrusted value as provenance; throws a ZodError on mismatch. */
export function parseProvenance(raw: unknown): WhiskinBuildProvenance {
  return WhiskinBuildProvenanceSchema.parse(raw)
}

/** Read + validate provenance from disk. */
export function readProvenance(path: string): WhiskinBuildProvenance {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    throw new Error(
      `Whiskin provenance at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return parseProvenance(parsed)
}

/** Validate then atomically write provenance to disk. */
export function writeProvenance(path: string, provenance: WhiskinBuildProvenance): void {
  atomicWriteJson(path, WhiskinBuildProvenanceSchema.parse(provenance))
}

/**
 * True iff this host's externals contract matches the artifact's — i.e. the
 * host still provides the React/SDK surface the artifact was built against. A
 * false result means the artifact needs a newer published build (Phase 9).
 */
export function isExternalsContractCompatible(provenance: WhiskinBuildProvenance): boolean {
  return provenance.externalsContract === EXTERNALS_CONTRACT
}
