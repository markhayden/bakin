/**
 * Global vitest setup.
 *
 * Mocks the main-agent resolution module so tests don't leak into the real
 * `~/.openclaw/` state. All test files see `getMainAgentId() === 'main'`
 * unless they override the mock in a per-file `vi.mock()` call.
 *
 * Mocks BOTH the alias path and the re-export in `src/core/` because some
 * production modules still import via relative paths.
 *
 * Test-data leak protection works in two layers:
 *  1. Runtime guards in content-dir.ts and openclaw-home.ts throw if
 *     any test run resolves to the real ~/.bakin/ or ~/.openclaw/.
 *  2. Individual tests must mock those modules or set BAKIN_HOME /
 *     OPENCLAW_HOME to a temp directory.
 * We do NOT force-set BAKIN_HOME/OPENCLAW_HOME here because tests that
 * vi.mock('os', …) to redirect homedir() rely on env vars being unset.
 */
import { vi } from 'vitest'

const mainAgentMock = {
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}

vi.mock('@bakin/core/main-agent', () => mainAgentMock)
vi.mock('../../packages/core/src/main-agent', () => mainAgentMock)
vi.mock('../../../src/core/main-agent', () => mainAgentMock)
vi.mock('../../src/core/main-agent', () => mainAgentMock)
vi.mock('./main-agent', () => mainAgentMock)
