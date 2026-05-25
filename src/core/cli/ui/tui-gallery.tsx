import { Box, Text, renderToString } from 'ink'
import { createMultiSelectState, MultiSelect, type MultiSelectItem } from './multi-select'
import { CLI_COLORS } from './style-tokens'
import {
  DataTable,
  FindingRows,
  NextActions,
  ProgressMeter,
  ScreenHeader as Header,
  Section,
  SummaryStrip,
  type FindingRow,
} from './tui'

export const GALLERY_SCREENS = [
  'doctor',
  'doctor-full',
  'doctor-fix',
  'doctor-applied',
  'doctor-delegate',
  'plugins',
  'tasks',
  'onboard',
  'onboard-antfly-confirm',
  'onboard-plugin-selection',
  'onboard-agent-selection',
  'onboarding-blocked',
  'error',
] as const

export type GalleryScreen = typeof GALLERY_SCREENS[number] | 'all'

function ActionList({ rows }: { rows: FindingRow[] }) {
  return <FindingRows rows={rows} />
}

function DoctorScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Doctor" subtitle="Offline diagnostics from this machine" meta="mode: offline" />
      <SummaryStrip items={[
        { label: 'errors', value: 0, status: 'ok' },
        { label: 'warnings', value: 4, status: 'warn' },
        { label: 'skipped', value: 3, status: 'skip' },
        { label: 'checks', value: 10 },
      ]} />
      <Section title="Local checks">
        <FindingRows rows={[
          { status: 'ok', label: 'home', message: 'Bakin home directory is initialized at ~/.bakin' },
          { status: 'ok', label: 'settings', message: 'settings.json is present and parses cleanly' },
          { status: 'ok', label: 'search-models', message: 'All 3 Termite models are present' },
          {
            status: 'warn',
            label: 'agent-assets',
            message: '1 agent-package projection needs repair; patch is missing from the runtime workspace.',
            next: 'bakin install agent-assets',
          },
        ]} />
      </Section>
      <Section title="Server checks">
        <FindingRows rows={[
          {
            status: 'skip',
            label: 'runtime',
            message: 'Live runtime reachability requires a running Bakin server.',
            next: 'bakin start, then bakin doctor --full',
          },
          {
            status: 'skip',
            label: 'plugin health',
            message: 'Plugin, workflow, task, and search-index checks run in full mode.',
            detail: 'Offline mode stays useful without hiding the fact that these checks were not executed.',
          },
        ]} />
      </Section>
    </Box>
  )
}

function DoctorFullScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Doctor" subtitle="Fresh server-backed diagnostics" meta="mode: full" />
      <SummaryStrip items={[
        { label: 'errors', value: 1, status: 'fail' },
        { label: 'warnings', value: 2, status: 'warn' },
        { label: 'checks', value: 18 },
      ]} />
      <Section title="Runtime">
        <FindingRows rows={[
          { status: 'ok', label: 'runtime', message: 'OpenClaw is reachable and reports 3 agents' },
          {
            status: 'warn',
            label: 'channels',
            message: 'No approval channel is configured for workflow gates.',
            next: 'bakin settings channels add',
          },
        ]} />
      </Section>
      <Section title="Workflows">
        <FindingRows rows={[
          { status: 'ok', label: 'definitions', message: '7 workflow definitions are registered' },
          {
            status: 'fail',
            label: 'stale-instances',
            message: '2 workflow instances reference tasks that are no longer on the board.',
            detail: 'This can block delegated repair and gate notifications until cleaned up.',
            next: 'bakin doctor --fix',
          },
        ]} />
      </Section>
    </Box>
  )
}

function DoctorFixScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Doctor repair plan" subtitle="Preview only; no changes have been applied" />
      <SummaryStrip items={[
        { label: 'safe', value: 3, status: 'ready' },
        { label: 'manual', value: 1, status: 'warn' },
        { label: 'blocked', value: 0, status: 'ok' },
      ]} />
      <Section title="Safe deterministic repairs">
        <ActionList rows={[
          {
            status: 'ready',
            label: 'tasks.taskboard',
            message: 'Restore missing task board columns.',
            detail: 'update ~/.bakin/tasks/board.json: add todo, in-progress, blocked, done',
          },
          {
            status: 'ready',
            label: 'team.agent-assets',
            message: 'Reproject the patch agent package into the runtime workspace.',
            detail: 'invoke agent package installer in repair mode',
          },
          {
            status: 'ready',
            label: 'health.skill',
            message: 'Refresh the runtime SKILL.md projection for the health plugin.',
            detail: 'update ~/.bakin/skills/health/SKILL.md',
          },
        ]} />
      </Section>
      <Section title="Manual follow-up">
        <ActionList rows={[
          {
            status: 'warn',
            label: 'channels',
            message: 'Approval channel setup requires user credentials and cannot be repaired automatically.',
            next: 'bakin settings channels add',
          },
        ]} />
      </Section>
      <NextActions actions={[
        'Run `bakin doctor --fix --yes` to apply the safe repairs.',
        'Run `bakin doctor --delegate --yes` to create a board task for unresolved manual work.',
      ]} />
    </Box>
  )
}

function DoctorAppliedScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Doctor repair results" subtitle="Safe deterministic repairs applied" />
      <SummaryStrip items={[
        { label: 'applied', value: 3, status: 'applied' },
        { label: 'skipped', value: 1, status: 'skip' },
        { label: 'failed', value: 0, status: 'ok' },
      ]} />
      <Section title="Applied">
        <FindingRows rows={[
          { status: 'applied', label: 'tasks.taskboard', message: 'Added missing board columns and preserved existing tasks.' },
          { status: 'applied', label: 'team.agent-assets', message: 'Reprojected patch agent package into the runtime workspace.' },
          { status: 'applied', label: 'health.skill', message: 'Updated the health plugin runtime skill projection.' },
        ]} />
      </Section>
      <Section title="Verification">
        <FindingRows rows={[
          { status: 'ok', label: 'tasks.taskboard', message: 'Task board is healthy after repair.' },
          { status: 'ok', label: 'team.agent-assets', message: 'All projected agent-package files are present.' },
          {
            status: 'warn',
            label: 'channels',
            message: 'Approval channel still needs manual setup.',
            next: 'bakin doctor --delegate --yes',
          },
        ]} />
      </Section>
    </Box>
  )
}

function DoctorDelegateScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Delegated doctor repair" subtitle="A board task was created for unresolved work" />
      <SummaryStrip items={[
        { label: 'request', value: 'repair-20260517-1422', status: 'sent' },
        { label: 'task', value: 'task-184', status: 'todo' },
        { label: 'agent', value: 'main' },
      ]} />
      <Section title="Repair brief">
        <FindingRows rows={[
          {
            status: 'sent',
            label: 'channels',
            message: 'Configure a workflow approval channel and verify gate notifications.',
            detail: 'The agent receives diagnostic rows, attempted safe repairs, and verification instructions.',
          },
          {
            status: 'todo',
            label: 'task board',
            message: 'The task starts in todo; dispatch will move it to in-progress when the agent picks it up.',
          },
        ]} />
      </Section>
      <NextActions actions={[
        'Watch the board for task-184 moving from todo to in-progress.',
        'Run `bakin doctor repair verify repair-20260517-1422` after the agent reports completion.',
      ]} />
    </Box>
  )
}

function PluginsScreen() {
  const rows = [
    { id: 'tasks', status: 'OK', version: 'core', summary: 'Task board and execution queue' },
    { id: 'workflows', status: 'WARN', version: 'core', summary: '2 stale workflow instances need cleanup' },
    { id: 'assets', status: 'OK', version: 'core', summary: 'Assets indexed and sidecars valid' },
    { id: 'messaging', status: 'READY', version: 'official', summary: 'Available to install from curated catalog' },
  ]

  return (
    <Box flexDirection="column">
      <Header title="Plugins" subtitle="Installed and recommended plugins" />
      <SummaryStrip items={[
        { label: 'installed', value: 8, status: 'ok' },
        { label: 'warnings', value: 1, status: 'warn' },
        { label: 'available', value: 2, status: 'ready' },
      ]} />
      <Section title="Catalog">
        <DataTable
          rows={rows}
          columns={[
            { key: 'status', header: 'STATUS', width: 8, render: row => row.status },
            { key: 'id', header: 'PLUGIN', width: 14, render: row => row.id },
            { key: 'version', header: 'VERSION', width: 10, render: row => row.version },
            { key: 'summary', header: 'SUMMARY', width: 58, render: row => row.summary },
          ]}
        />
      </Section>
      <NextActions actions={[
        'Run `bakin plugins install messaging` to add curated messaging workflows.',
        'Run `bakin doctor --fix --yes` to clean stale workflow instances.',
      ]} />
    </Box>
  )
}

function TasksScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Tasks" subtitle="Board snapshot" />
      <SummaryStrip items={[
        { label: 'todo', value: 3, status: 'todo' },
        { label: 'in progress', value: 1, status: 'run' },
        { label: 'blocked', value: 1, status: 'blocked' },
        { label: 'done today', value: 5, status: 'done' },
      ]} />
      <Section title="Board">
        <FindingRows rows={[
          { status: 'todo', label: 'task-184', message: 'Doctor repair: configure workflow approval channel' },
          { status: 'run', label: 'task-177', message: 'Generate release notes for v0.1.1; assigned to docs' },
          {
            status: 'blocked',
            label: 'task-166',
            message: 'Plugin install smoke test is waiting on the dist-only builder decision.',
            next: 'Resolve plugin builder follow-up',
          },
          { status: 'done', label: 'task-159', message: 'Refresh embedded asset manifest after plugin extraction' },
        ]} />
      </Section>
    </Box>
  )
}

function OnboardScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Onboard" subtitle="Interactive setup in progress" meta="step 7 of 11" />
      <SummaryStrip items={[
        { label: 'complete', value: 6, status: 'ok' },
        { label: 'running', value: 2, status: 'run' },
        { label: 'pending', value: 3, status: 'todo' },
        { label: 'warnings', value: 0, status: 'ok' },
      ]} />
      <Section title="Progress">
        <ProgressMeter label="Setting up this machine" current={7} total={11} percent={64} />
        <Box marginTop={1} flexDirection="column">
          <FindingRows rows={[
            { status: 'ok', label: 'home', message: 'Bakin home ready at ~/.bakin' },
            { status: 'ok', label: 'settings', message: 'settings.json created and validated' },
            { status: 'ok', label: 'runtime', message: 'OpenClaw reachable; main orchestrator agent found' },
            { status: 'ok', label: 'search', message: 'Antfly installed and search index path prepared' },
            { status: 'run', label: 'plugins', message: 'Installing selected official plugins and building their assets.' },
            { status: 'run', label: 'agent-assets', message: 'Projecting selected agent packages into the runtime workspace.' },
            { status: 'todo', label: 'channels', message: 'Approval and notification channels have not run yet.' },
            { status: 'todo', label: 'doctor', message: 'Final health sweep will run after setup completes.' },
          ]} />
        </Box>
      </Section>
      <Section title="Current activity">
        <FindingRows rows={[
          {
            status: 'run',
            label: 'messaging',
            message: 'Building plugin server and client bundles.',
            detail: 'Async job 2 of 4; logs are hidden unless --verbose is enabled.',
          },
          {
            status: 'run',
            label: 'patch',
            message: 'Installing agent package and writing managed runtime context.',
            detail: 'The runtime agent will appear on the board after projection finishes.',
          },
        ]} />
      </Section>
      <Section title="Recent feedback">
        <FindingRows rows={[
          { status: 'ok', label: '10:42:11', message: 'Termite text, image, and embedding models are present.' },
          { status: 'ok', label: '10:42:14', message: 'Tasks, assets, workflows, health, and team plugins are already installed.' },
          { status: 'run', label: '10:42:18', message: 'Installing messaging plugin from the official catalog.' },
          { status: 'todo', label: 'queued', message: 'Recommended agent package selection will be confirmed next.' },
        ]} />
      </Section>
    </Box>
  )
}

function OnboardAntflyConfirmScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Onboard" subtitle="Interactive setup decision" meta="search adapter" />
      <SummaryStrip items={[
        { label: 'decision', value: 1, status: 'warn' },
        { label: 'source', value: 'Homebrew' },
        { label: 'next step', value: 'search models', status: 'todo' },
      ]} />
      <Section title="Decision">
        <FindingRows rows={[
          {
            status: 'warn',
            label: 'search',
            message: 'Antfly is not installed or not reachable.',
            detail: 'Bakin will install Antfly via Homebrew if you continue.',
          },
        ]} />
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold>Install Antfly search adapter?</Text>
            <Text> y/N</Text>
          </Box>
          <Text dimColor>Default: No. Press y to install; press Enter or n to skip.</Text>
        </Box>
      </Section>
      <Section title="Result preview">
        <FindingRows rows={[
          { status: 'run', label: 'yes', message: 'Install Antfly, then continue to Termite model checks.' },
          { status: 'skip', label: 'no', message: 'Skip search setup now; onboarding continues with search-dependent steps marked skipped.' },
        ]} />
      </Section>
    </Box>
  )
}

function OnboardPluginSelectionScreen() {
  const items: MultiSelectItem[] = [
    {
      id: 'messaging',
      label: 'Messaging',
      selected: true,
      description: 'Content planning, calendar items, brainstorming sessions, approvals, and channel delivery.',
    },
    {
      id: 'projects',
      label: 'Projects',
      selected: true,
      description: 'Project specs, checklists, task links, assets, and project-context agent tools.',
    },
  ]

  return (
    <Box flexDirection="column">
      <Header title="Onboard" subtitle="Choose official plugins to install" meta="plugin selection" />
      <SummaryStrip items={[
        { label: 'selected', value: 2, status: 'ready' },
        { label: 'official', value: 2 },
        { label: 'dependencies', value: 4, status: 'ok' },
      ]} />
      <Section title="Plugins">
        <MultiSelect
          title="Install official plugins"
          items={items}
          state={createMultiSelectState(items)}
          onChange={() => {}}
          onSubmit={() => {}}
          showTitle={false}
        />
      </Section>
      <Section title="Install plan">
        <FindingRows rows={[
          { status: 'ok', label: 'tasks', message: 'Core dependency already installed.' },
          { status: 'ok', label: 'assets', message: 'Core dependency already installed.' },
          { status: 'ready', label: 'selected', message: 'Messaging and Projects will be installed from the official catalog.' },
        ]} />
      </Section>
    </Box>
  )
}

function OnboardAgentSelectionScreen() {
  const items: MultiSelectItem[] = [
    {
      id: 'patch',
      label: 'Patch',
      selected: true,
      description: 'Developer agent for API integrations, automation, debugging, and tool extensions.',
    },
    {
      id: 'jessica',
      label: 'Jessica',
      selected: true,
      description: 'Research agent for multi-source discovery, evidence gathering, and synthesis support.',
    },
    {
      id: 'pixel',
      label: 'Pixel',
      description: 'Image artist agent for prompt craft, output iteration, and visual quality.',
    },
    {
      id: 'rolo',
      label: 'Rolo',
      description: 'Video producer agent for video, audio, and finished asset mixing.',
    },
  ]

  return (
    <Box flexDirection="column">
      <Header title="Onboard" subtitle="Choose official agents to install or adopt" meta="agent selection" />
      <SummaryStrip items={[
        { label: 'selected', value: 2, status: 'ready' },
        { label: 'available', value: 4 },
        { label: 'runtime', value: 'ready', status: 'ok' },
      ]} />
      <Section title="Agents">
        <MultiSelect
          title="Install official agents"
          items={items}
          state={createMultiSelectState(items)}
          onChange={() => {}}
          onSubmit={() => {}}
          showTitle={false}
        />
      </Section>
      <Section title="Runtime context">
        <FindingRows rows={[
          { status: 'ok', label: 'main', message: 'runtime main agent is already installed and remains the orchestrator.' },
          { status: 'ready', label: 'selected', message: 'Patch and Jessica will be projected into the runtime workspace.' },
        ]} />
      </Section>
    </Box>
  )
}

function OnboardingBlockedScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Onboarding" subtitle="Step 3 of 8: runtime prerequisite" />
      <SummaryStrip items={[
        { label: 'complete', value: 2, status: 'ok' },
        { label: 'blocked', value: 1, status: 'blocked' },
        { label: 'not run', value: 5, status: 'skip' },
      ]} />
      <Section title="Prerequisite">
        <FindingRows rows={[
          { status: 'ok', label: 'home', message: 'Bakin home ready at ~/.bakin' },
          { status: 'ok', label: 'settings', message: 'settings.json created and validated' },
          {
            status: 'blocked',
            label: 'runtime',
            message: 'No orchestrator agent was found in the configured runtime.',
            detail: 'Bakin requires an active agent runtime before setup can continue.',
            next: 'Start OpenClaw, create an orchestrator agent, then rerun `bakin onboard`.',
          },
        ]} />
      </Section>
      <Section title="Blocked steps">
        <FindingRows rows={[
          { status: 'skip', label: 'search', message: 'Waiting on runtime prerequisite' },
          { status: 'skip', label: 'plugins', message: 'Waiting on runtime prerequisite' },
          { status: 'skip', label: 'agents', message: 'Waiting on runtime prerequisite' },
        ]} />
      </Section>
    </Box>
  )
}

function ErrorScreen() {
  return (
    <Box flexDirection="column">
      <Header title="Command failed" subtitle="plugins install messaging" />
      <SummaryStrip items={[
        { label: 'exit code', value: 1, status: 'fail' },
        { label: 'code', value: 'PLUGIN_BUILD_FAILED' },
      ]} />
      <Section title="Problem">
        <FindingRows rows={[
          {
            status: 'fail',
            label: 'messaging',
            message: 'The plugin imports an undeclared package: nodemailer.',
            detail: 'Plugin builds must declare their own third-party dependencies.',
            next: 'Add nodemailer to the plugin package.json, then rerun the install.',
          },
        ]} />
      </Section>
      <Section title="Debug">
        <FindingRows rows={[
          { status: 'skip', label: 'stack trace', message: 'Hidden by default. Re-run with --verbose for raw build output.' },
        ]} />
      </Section>
    </Box>
  )
}

function screenTitle(screen: GalleryScreen): string {
  return screen === 'all' ? 'all' : screen
}

export function GalleryApp({ screen }: { screen: GalleryScreen }) {
  if (screen === 'all') {
    return (
      <Box flexDirection="column">
        {GALLERY_SCREENS.map((item, index) => (
          <Box key={item} flexDirection="column" marginTop={index === 0 ? 0 : 2}>
            <Text dimColor>--- {item} ---</Text>
            <GalleryApp screen={item} />
          </Box>
        ))}
      </Box>
    )
  }

  switch (screen) {
    case 'doctor':
      return <DoctorScreen />
    case 'doctor-full':
      return <DoctorFullScreen />
    case 'doctor-fix':
      return <DoctorFixScreen />
    case 'doctor-applied':
      return <DoctorAppliedScreen />
    case 'doctor-delegate':
      return <DoctorDelegateScreen />
    case 'plugins':
      return <PluginsScreen />
    case 'tasks':
      return <TasksScreen />
    case 'onboard':
      return <OnboardScreen />
    case 'onboard-antfly-confirm':
      return <OnboardAntflyConfirmScreen />
    case 'onboard-plugin-selection':
      return <OnboardPluginSelectionScreen />
    case 'onboard-agent-selection':
      return <OnboardAgentSelectionScreen />
    case 'onboarding-blocked':
      return <OnboardingBlockedScreen />
    case 'error':
      return <ErrorScreen />
    default:
      return (
        <Box>
          <Text color={CLI_COLORS.fail}>Unknown gallery screen: {screenTitle(screen)}</Text>
        </Box>
      )
  }
}

export function isGalleryScreen(value: string): value is GalleryScreen {
  return value === 'all' || GALLERY_SCREENS.includes(value as typeof GALLERY_SCREENS[number])
}

export function renderGalleryScreen(screen: GalleryScreen, opts: {
  columns?: number
} = {}): string {
  return renderToString(<GalleryApp screen={screen} />, { columns: opts.columns ?? 100 })
}
