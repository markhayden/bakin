/**
 * Teeth fixture: WITHOUT the static-module registration, the SDK's
 * bundler-opaque dynamic import must still fail inside a compiled binary
 * ("Cannot find module './openai-codex.js'"). If a pi SDK or bun upgrade
 * makes this fixture SUCCEED, the workaround in src/bun-static-modules.ts is
 * obsolete — re-evaluate it (same convention as the antfly
 * workaround-regression pins).
 */
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { join } from 'path'

const dir = process.env.PI_AUTH_DIR!
const rt = await ModelRuntime.create({
  authPath: join(dir, 'auth.json'),
  modelsPath: join(dir, 'models.json'),
  modelsStorePath: join(dir, 'models-store.json'),
})
try {
  const auth = await rt.getAuth('openai-codex')
  console.log('AUTH RESULT:', auth ? auth.source : 'undefined')
} catch (e) {
  console.log('FAILED:', (e as Error).message)
}
