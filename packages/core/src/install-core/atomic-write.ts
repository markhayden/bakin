/**
 * Atomic JSON write — single-homed in ../storage/atomic-write. Re-exported here
 * for the install-core callers (plugin + agent-package lockfiles, whiskit
 * artifacts-index + provenance) that imported it from this path.
 */
export { atomicWriteJson, atomicWriteText, type AtomicWriteOptions } from '../storage/atomic-write'
