/**
 * Global bun:test setup.
 *
 * 1. Registers happy-dom so component tests have document/window.
 * 2. Mocks the main-agent module at its canonical path so tests don't
 *    read the real ~/.openclaw/ state.
 *
 * Test-data leak protection works in two layers:
 *  1. Runtime guards in content-dir.ts and openclaw-home.ts throw if
 *     any test run resolves to the real ~/.bakin/ or ~/.openclaw/.
 *  2. Individual tests must mock those modules or set BAKIN_HOME /
 *     OPENCLAW_HOME to a temp directory.
 * We do NOT force-set BAKIN_HOME/OPENCLAW_HOME here because tests that
 * mock `os` to redirect homedir() rely on env vars being unset.
 */
import GlobalRegistrator from '@happy-dom/global-registrator'
import { mock } from 'bun:test'

GlobalRegistrator.register()

const mainAgentMock = {
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}

mock.module('@bakin/core/main-agent', () => mainAgentMock)
