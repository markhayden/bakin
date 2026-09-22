import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '../../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-job-list-${process.pid}-${Date.now()}`)
const paths = () => ({ root: testDir, db: join(testDir, 'bakin.db') })
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts), resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))
mock.module('@/core/watcher', () => ({ registerSyncHook: mock(), registerUnlinkHook: mock() }))
mock.module('@makinbakin/sdk/hooks', () => ({ useAgent: () => ({ id: 'chef', name: 'Chef' }) }))
import { JobList } from '../../../plugins/schedule/components/job-list'
import type { ScheduleJob } from '@makinbakin/sdk/hooks'

afterEach(cleanup)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('Schedule table narrow action parity', () => {
  it('uses separated kit rows with the same actions and named schedule metadata', async () => {
    const onSelect = mock()
    const onDelete = mock()
    const job: ScheduleJob = {
      id: 'daily', displayName: 'Daily editorial review', agentId: 'chef',
      humanSchedule: 'Every day at 9am', paused: false, enabled: true,
      isBakinJob: true, allowOverlap: false, maxFailures: 3, consecutiveFailures: 0,
    }
    render(<JobList jobs={[job]} onSelect={onSelect} onDelete={onDelete}
      onPause={mock()} onResume={mock()} onRunNow={mock()} onEdit={mock()}
      onDuplicate={mock()} onAdopt={mock()} onRestoreNative={mock()} onSkipNext={mock()} />)
    const list = screen.getByRole('list', { name: 'Scheduled jobs' })
    expect(list.getAttribute('data-variant')).toBe('separated')
    expect(within(list).getByText('Schedule')).toBeDefined()
    const trigger = within(list).getByRole('button', { name: 'Actions for Daily editorial review' })
    fireEvent.click(trigger)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('daily')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
