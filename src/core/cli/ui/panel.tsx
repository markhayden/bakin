import { Box, Text } from 'ink'

export interface PanelProps {
  title: string
  subtitle?: string
  children?: React.ReactNode
}

export function Panel({ title, subtitle, children }: PanelProps) {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {subtitle ? <Text dimColor>{subtitle}</Text> : null}
      {children ? <Box flexDirection="column" marginTop={1}>{children}</Box> : null}
    </Box>
  )
}
