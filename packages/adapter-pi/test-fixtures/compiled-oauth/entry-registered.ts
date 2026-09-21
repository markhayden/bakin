/**
 * Compiled-binary fixture (see tests/adapter-pi/compiled-oauth-static.test.ts):
 * WITH the adapter's static-module registration, codex OAuth derivation must
 * succeed inside a `bun build --compile` binary. PI_AUTH_DIR names a dir
 * containing auth.json with a fake openai-codex oauth credential.
 */
import '../../src/bun-static-modules'
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
