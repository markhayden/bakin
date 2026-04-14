/**
 * Global vitest setup.
 *
 * Mocks the main-agent resolution module so tests don't leak into the real
 * `~/.openclaw/` state. All test files see `getMainAgentId() === 'main'`
 * unless they override the mock in a per-file `vi.mock()` call.
 *
 * Mocks BOTH the alias path and the re-export in `src/core/` because some
 * production modules still import via relative paths.
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
