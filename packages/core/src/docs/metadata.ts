export type ContractVisibility = 'public' | 'internal' | 'experimental'

export type ContractStability = 'stable' | 'beta' | 'experimental' | 'deprecated'

export type HookKind = 'rpc' | 'event' | 'waterfall'

export interface SchemaLike<T = unknown> {
  parse(data: unknown): T
  safeParse?(data: unknown): { success: true; data: T } | { success: false; error: unknown }
}

export interface SourceLocation {
  file: string
  symbol?: string
  line?: number
}

export interface DocsExample {
  title: string
  description?: string
  code?: string
  request?: unknown
  response?: unknown
  test?: 'automated' | 'schema' | 'illustrative'
  reason?: string
}

export interface ContractMetadata {
  summary: string
  description: string
  visibility: ContractVisibility
  stability: ContractStability
  since?: string
  deprecated?: {
    since?: string
    removeIn?: string
    replacement?: string
  }
  source?: SourceLocation
  examples?: DocsExample[]
  related?: string[]
}

export interface RouteContract<Input = unknown, Output = unknown> extends ContractMetadata {
  kind: 'route'
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  input?: SchemaLike<Input>
  output?: SchemaLike<Output>
  permissions?: string[]
}

export interface CliCommandContract extends ContractMetadata {
  kind: 'cli'
  name: string
  usage: string
  options?: Array<{
    name: string
    description: string
    value?: string
    required?: boolean
  }>
  environment?: string[]
}

export interface HookContract<Input = unknown, Output = unknown> extends ContractMetadata {
  kind: 'hook'
  name: string
  hookKind: HookKind
  input?: SchemaLike<Input>
  output?: SchemaLike<Output>
}

export interface SlotContract<Props = unknown> extends ContractMetadata {
  kind: 'slot'
  name: string
  props?: SchemaLike<Props>
  renderLocation: string
  ordering?: string
  fallback?: string
}

export interface ExecToolContract<Input = unknown, Output = unknown> extends ContractMetadata {
  kind: 'exec-tool'
  name: string
  input?: SchemaLike<Input>
  output?: SchemaLike<Output>
  permissions?: string[]
}

export type PublicContract =
  | RouteContract
  | CliCommandContract
  | HookContract
  | SlotContract
  | ExecToolContract

export function defineRouteContract<const T extends RouteContract>(contract: T): T {
  return contract
}

export function defineCliCommandContract<const T extends CliCommandContract>(contract: T): T {
  return contract
}

export function defineHookContract<const T extends HookContract>(contract: T): T {
  return contract
}

export function defineSlotContract<const T extends SlotContract>(contract: T): T {
  return contract
}

export function defineExecToolContract<const T extends ExecToolContract>(contract: T): T {
  return contract
}
