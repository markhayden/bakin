/**
 * Re-export from canonical location.
 * All content-dir logic now lives in src/core/content-dir.ts.
 */
export { getContentDir, resetContentDir, initBeaconHome, getBeaconPaths, isUsingBeaconHome } from '../../src/core/content-dir'
export type { BeaconPaths } from '../../src/core/content-dir'
