/**
 * Hermetic-git substrate for plugin lifecycle integration tests.
 *
 * Exposes helpers to spin up a bare git repo in a tmp dir, push commits,
 * and produce a `file://` URL the install/upgrade flows can clone from
 * exactly like a real github source. No network. Fast (~50ms per repo).
 *
 * Skip integration tests that need git when it's not on PATH — emit a
 * clear message via the returned `git()` helper.
 */
import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'

/** Returns true iff `git` is on PATH. Tests use this to skip cleanly. */
export function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  }).toString().trim()
}

/** Run git in a fixture repo and return trimmed stdout. */
export function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  return run('git', args, cwd, env)
}

/**
 * Initialize a bare git repo + a working clone seeded with `files`.
 * Returns the absolute path of the bare repo (use `file://` + this path
 * as the install source) and the working clone path (modify + commit
 * files there to push new commits).
 *
 * The bare repo's default branch is `main` to match modern github
 * defaults. Author/committer identity uses GIT_AUTHOR_/GIT_COMMITTER_
 * env vars so the test doesn't depend on the user's global git config.
 */
export function createBareRepo(
  rootDir: string,
  fixtureName: string,
  files: Record<string, string>,
): { bareRepoPath: string; workingClonePath: string; cloneUrl: string } {
  const bareRepoPath = join(rootDir, `${fixtureName}.git`)
  const workingClonePath = join(rootDir, `${fixtureName}-work`)

  mkdirSync(rootDir, { recursive: true })
  run('git', ['init', '--bare', '-b', 'main', bareRepoPath], rootDir)

  // Seed working clone via init+remote (avoids `clone` needing the bare
  // repo to have an initial commit first).
  mkdirSync(workingClonePath, { recursive: true })
  run('git', ['init', '-b', 'main'], workingClonePath)
  run('git', ['remote', 'add', 'origin', bareRepoPath], workingClonePath)
  configureCommitIdentity(workingClonePath)

  writeFiles(workingClonePath, files)
  run('git', ['add', '-A'], workingClonePath)
  run('git', ['commit', '-m', 'initial fixture'], workingClonePath, commitEnv())
  run('git', ['push', 'origin', 'main'], workingClonePath, commitEnv())

  const cloneUrl = `file://${bareRepoPath}`
  return { bareRepoPath, workingClonePath, cloneUrl }
}

/**
 * Mutate the working clone — overwrite each file in `files`, commit,
 * push to origin/main. Returns the resulting commit sha.
 */
export function pushCommit(
  workingClonePath: string,
  files: Record<string, string>,
  message = 'fixture update',
): string {
  writeFiles(workingClonePath, files)
  run('git', ['add', '-A'], workingClonePath)
  run('git', ['commit', '-m', message], workingClonePath, commitEnv())
  run('git', ['push', 'origin', 'main'], workingClonePath, commitEnv())
  return run('git', ['rev-parse', 'HEAD'], workingClonePath)
}

/**
 * Force-push a divergent history (used to test the rewind-rejection path).
 *
 * Implementation: nuke .git/, reinit, reattach the remote, write fresh
 * files, commit, force-push. The working tree's non-tracked files survive
 * because we only blow away `.git/`; tracked files get overwritten by
 * writeFiles. For the rewind tests this is fine — they always pass the
 * exact set of fixture files they care about.
 */
export function forcePushRewind(
  workingClonePath: string,
  files: Record<string, string>,
  message = 'rewritten history',
): string {
  rmSync(join(workingClonePath, '.git'), { recursive: true, force: true })
  run('git', ['init', '-b', 'main'], workingClonePath)
  // re-derive bare path from working clone — by convention `<name>-work` ↔ `<name>.git`.
  const bareRepoPath = workingClonePath.replace(/-work$/, '.git')
  run('git', ['remote', 'add', 'origin', bareRepoPath], workingClonePath)
  configureCommitIdentity(workingClonePath)
  writeFiles(workingClonePath, files)
  run('git', ['add', '-A'], workingClonePath)
  run('git', ['commit', '-m', message], workingClonePath, commitEnv())
  run('git', ['push', '--force', 'origin', 'main'], workingClonePath, commitEnv())
  return run('git', ['rev-parse', 'HEAD'], workingClonePath)
}

function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
}

function configureCommitIdentity(dir: string): void {
  // Local config so we don't need a global git identity in CI.
  run('git', ['config', 'user.email', 'test@bakin.local'], dir)
  run('git', ['config', 'user.name', 'Bakin Test'], dir)
}

function commitEnv(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: 'Bakin Test',
    GIT_AUTHOR_EMAIL: 'test@bakin.local',
    GIT_COMMITTER_NAME: 'Bakin Test',
    GIT_COMMITTER_EMAIL: 'test@bakin.local',
  }
}

/** Standard fixture plugin manifest + entry, parameterized. */
export function fixturePluginFiles(opts: {
  id: string
  version: string
  permissions?: string[]
}): Record<string, string> {
  return {
    'bakin-plugin.json': JSON.stringify({
      id: opts.id,
      name: opts.id,
      version: opts.version,
            permissions: opts.permissions ?? [],
    }, null, 2),
    'index.ts': `export default { id: '${opts.id}', activate() {} }`,
  }
}

/** Best-effort cleanup. Tests should pair with a real rmSync in afterAll. */
export function cleanupRepo(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true })
}
