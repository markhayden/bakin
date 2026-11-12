/**
 * Resolver probe — run as a CHILD by the onboarding harness, never
 * imported by a test. It asks the real resolvers where each home is and
 * prints the answers, so the harness can prove every one of them lands
 * inside the throwaway tree (and that nothing leaked into the child's
 * environment).
 */
import { tmpdir, homedir } from 'os'

import { getBakinPaths, getContentDir } from '../../../packages/core/src/content-dir'
import { getOpenClawHome } from '../../../packages/adapter-openclaw/src/home'
import { getPiHome } from '../../../packages/adapter-pi/src/home'
import { antflyHome } from '../../../packages/adapter-antfly/src/paths'

const bakinPaths: Record<string, string> = {}
for (const [key, value] of Object.entries(getBakinPaths())) {
  if (typeof value === 'string') bakinPaths[key] = value
}

console.log(JSON.stringify({
  paths: {
    contentDir: getContentDir(),
    ...Object.fromEntries(Object.entries(bakinPaths).map(([key, value]) => [`bakin.${key}`, value])),
    piHome: getPiHome(),
    openclawHome: getOpenClawHome(),
    searchHome: antflyHome(),
    homedir: homedir(),
    tmpdir: tmpdir(),
  },
  envKeys: Object.keys(process.env).sort(),
  env: {
    BAKIN_URL: process.env.BAKIN_URL ?? null,
    HARNESS_PLANTED: process.env.HARNESS_PLANTED ?? null,
  },
}))
