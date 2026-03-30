/**
 * Re-export from canonical location.
 * All content-dir logic lives in src/core/content-dir.
 */
export {
  getContentDir,
  resetContentDir,
  initBakinHome,
  getBakinPaths,
  isUsingBakinHome,
} from '../../src/core/content-dir'
export type { BakinPaths } from '../../src/core/content-dir'
