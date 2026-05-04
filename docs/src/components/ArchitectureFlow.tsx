import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

type IconProps = { size?: number; color?: string }
type IconComponent = ComponentType<IconProps>

const Icon = ({ children, size = 14, color = 'currentColor' }: IconProps & { children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const IconInterface: IconComponent = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></Icon>
const IconLock: IconComponent = (p) => <Icon {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></Icon>
const IconBeaker: IconComponent = (p) => <Icon {...p}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/></Icon>
const IconSearch: IconComponent = (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></Icon>
const IconBriefcase: IconComponent = (p) => <Icon {...p}><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></Icon>
const IconFlask: IconComponent = (p) => <Icon {...p}><path d="M10 3h4M11 3v6l-4.5 8a2 2 0 0 0 1.7 3h7.6a2 2 0 0 0 1.7-3L13 9V3"/></Icon>
const IconPlug: IconComponent = (p) => <Icon {...p}><path d="M9 2v4M15 2v4M7 6h10v5a5 5 0 0 1-10 0zM12 16v6"/></Icon>

const IconGlobe: IconComponent = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></Icon>
const IconDiscord: IconComponent = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/>
  </svg>
)
const IconSend: IconComponent = (p) => <Icon {...p}><path d="M21 3 11 14M21 3l-7 18-3-7-7-3z"/></Icon>
const IconCode: IconComponent = (p) => <Icon {...p}><path d="m9 8-5 4 5 4M15 8l5 4-5 4"/></Icon>
const IconTerminal: IconComponent = (p) => <Icon {...p}><path d="m5 8 4 4-4 4M12 16h7"/><rect x="2.5" y="4" width="19" height="16" rx="2"/></Icon>
const IconGrid: IconComponent = (p) => <Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Icon>
const IconCrab: IconComponent = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 256 177" fill={color}>
    <path d="M189.788,121.935c0.979-1.54,1.826-3.122,2.508-4.746l30.203-5.299L254,127.64l-31.501-31.501l-28.472,5.695c-0.274-1.494-0.678-2.963-1.198-4.405l23.765-9.164l18.511-24.954l-0.021,0c7.837-10.608,0.296-30.923-17.343-46.089c-11.36-9.775-24.236-15.081-34.424-15.11l23.429,46.906l-39.819-20.17c2.943,8.604,9.401,17.926,18.615,25.84c7.401,6.366,15.434,10.835,22.954,13.19l-5.683,12.513l-15.617,7.321c-7.561-9.231-20.471-16.465-36.19-20.089c0.996-1.225,1.594-2.786,1.594-4.487c0-3.933-3.189-7.122-7.122-7.122c-3.933,0-7.122,3.189-7.122,7.122c0,0.876,0.166,1.71,0.455,2.485c-3.518-0.36-7.125-0.555-10.806-0.555c-3.681,0-7.288,0.195-10.806,0.555c0.289-0.775,0.455-1.61,0.455-2.485c0-3.933-3.189-7.122-7.122-7.122s-7.122,3.189-7.122,7.122c0,1.702,0.598,3.262,1.594,4.487c-15.72,3.624-28.63,10.859-36.192,20.091l-15.621-7.322L47.51,67.885c7.518-2.354,15.548-6.819,22.945-13.179c9.214-7.915,15.672-17.247,18.625-25.86l-39.829,20.17L72.67,2.119C62.471,2.159,49.615,7.455,38.245,17.24c-17.639,15.164-25.177,35.492-17.33,46.095l18.492,24.929l23.769,9.166c-0.521,1.442-0.924,2.91-1.198,4.405l-28.477-5.695L2,127.64l31.501-15.75l30.209,5.3c0.682,1.624,1.529,3.205,2.507,4.745l-32.716,5.706l-15.75,25.594l26.616-16.913l31.468-2.725l4.25,4.809l-13.114,3.016L49.251,159.14l19.651,15.72c0.002,0.003,0.005,0.007,0.008,0.01c0-0.001,0.001-0.002,0.001-0.003l0.028,0.023l-0.013-0.053c0.945-1.698,1.49-3.649,1.49-5.73c0-4.158-2.153-7.807-5.4-9.912l-0.014-0.055l8.86-7.875h17.588l2.255,2.552c1.622,1.836,3.954,2.887,6.405,2.887h55.445c2.45,0,4.782-1.051,6.404-2.887l2.255-2.552h17.927l8.86,7.875l-0.014,0.055c-3.247,2.105-5.4,5.754-5.4,9.912c0,2.081,0.545,4.032,1.49,5.73l-0.013,0.053l0.028-0.023c0.001,0.001,0.001,0.002,0.001,0.003c0.003-0.003,0.005-0.007,0.008-0.01l19.65-15.72l-17.719-17.719l-13.395-3.081l4.217-4.771l31.782,2.752l26.616,16.913l-15.75-25.594L189.788,121.935z"/>
  </svg>
)
const IconHermesH: IconComponent = (p) => (
  <Icon {...p}>
    <path d="M6 4v16M18 4v16M6 12h12" strokeWidth="2.2"/>
  </Icon>
)
const IconAntfly: IconComponent = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill={color}>
    <path d="M39.2842 28.0677C39.2842 34.2626 34.2623 39.2845 28.0674 39.2845H6.10853C5.37819 39.2845 5.01243 38.4015 5.52886 37.885L11.0896 32.3243H28.0674C30.4183 32.3243 32.324 30.4186 32.324 28.0677V11.0898L37.8847 5.5291C38.4012 5.01267 39.2842 5.37843 39.2842 6.10877V28.0677Z"/>
    <path d="M27.2721 24.5018C27.2698 25.2127 26.4103 25.5671 25.9076 25.0645L21.1775 20.3344C20.8653 20.0223 20.8653 19.5162 21.1775 19.2041L25.9377 14.4438C26.4421 13.9395 27.3044 14.2983 27.3022 15.0116L27.2721 24.5018Z"/>
    <path d="M28.3149 6.96011H11.2167C8.86587 6.96012 6.96011 8.86587 6.9601 11.2167V28.3149L1.39945 33.8755C0.883015 34.392 0 34.0262 0 33.2958V11.2167C4.48304e-06 5.02189 5.02189 9.39218e-06 11.2167 0H33.2958C34.0262 0 34.3919 0.883017 33.8755 1.39945L28.3149 6.96011Z"/>
    <path d="M11.8783 15.1175C11.8806 14.4067 12.7401 14.0522 13.2428 14.5549L17.8625 19.1746C18.1747 19.4867 18.1747 19.9928 17.8625 20.3049L13.2134 24.9541C12.709 25.4584 11.8467 25.0996 11.8489 24.3863L11.8783 15.1175Z"/>
  </svg>
)
const IconHeadset: IconComponent = (p) => <Icon {...p}><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="7" rx="1.5"/><rect x="17" y="13" width="4" height="7" rx="1.5"/></Icon>
const IconChart: IconComponent = (p) => <Icon {...p}><path d="M4 20V8M10 20V4M16 20v-7M22 20H2"/></Icon>
const IconChevrons: IconComponent = (p) => <Icon {...p}><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></Icon>
const IconList: IconComponent = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></Icon>
const IconGitBranch: IconComponent = (p) => <Icon {...p}><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M8 12h8"/></Icon>
const IconStar: IconComponent = (p) => <Icon {...p}><path d="m12 3 2.7 5.5 6 .9-4.4 4.3 1 6-5.3-2.8L6.7 19.7l1-6L3.3 9.4l6-.9z"/></Icon>
const IconAnchor: IconComponent = (p) => <Icon {...p}><circle cx="12" cy="5" r="2.2"/><path d="M12 7v14M5 13c0 4 3 7 7 7s7-3 7-7M3 13h4M17 13h4"/></Icon>
const IconBook: IconComponent = (p) => <Icon {...p}><path d="M4 4h11a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h11"/></Icon>
const IconHeart: IconComponent = (p) => <Icon {...p}><path d="M3 11V8a3 3 0 0 1 6 0v8a3 3 0 0 0 6 0v-1M9 12h3M19 8l2 2-2 2"/></Icon>

type ColorKey = 'pink' | 'cyan' | 'violet' | 'emerald' | 'yellow'
type Side = 'l' | 'r' | 't' | 'b'
type Layout = 'flat' | 'grid' | 'grid2'
type EdgeKind = 'direct' | 'data'
type CurveName = 'runtime-to-kits' | 'runtime-to-plugins'

type FlowNodeItem = { icon: IconComponent; label: string; muted?: boolean }
type FlowNode = {
  id: string
  x: number
  y: number
  color: ColorKey
  icon: IconComponent
  title: string
  layout?: Layout
  items: FlowNodeItem[]
}
type FlowEdge = {
  id: string
  from: string
  to: string
  kind: EdgeKind
  bidirectional?: boolean
  fromSide: Side
  toSide: Side
  fromRow?: number
  toRow?: number
  curve?: CurveName
}

const NODES: FlowNode[] = [
  {
    id: 'interface',
    x: 10, y: 165,
    color: 'pink',
    icon: IconInterface,
    title: 'INTERFACE',
    items: [
      { icon: IconGlobe, label: 'Bakin Interface' },
      { icon: IconDiscord, label: 'Discord' },
      { icon: IconSend, label: 'Telegram' },
    ],
  },
  {
    id: 'access',
    x: 265, y: 165,
    color: 'cyan',
    icon: IconLock,
    title: 'ACCESS',
    items: [
      { icon: IconCode, label: 'API' },
      { icon: IconTerminal, label: 'CLI' },
      { icon: IconGrid, label: 'MCP' },
    ],
  },
  {
    id: 'runtime',
    x: 530, y: 70,
    color: 'violet',
    icon: IconBeaker,
    title: 'RUNTIME ADAPTER',
    items: [
      { icon: IconCrab, label: 'OpenClaw' },
      { icon: IconHermesH, label: 'Hermes' },
      { icon: IconChevrons, label: 'Others…', muted: true },
    ],
  },
  {
    id: 'search',
    x: 530, y: 320,
    color: 'violet',
    icon: IconSearch,
    title: 'SEARCH ADAPTER',
    items: [
      { icon: IconAntfly, label: 'Antfly' },
      { icon: IconChevrons, label: 'Others…', muted: true },
    ],
  },
  {
    id: 'kits',
    x: 800, y: 315,
    color: 'emerald',
    icon: IconBriefcase,
    title: 'AGENT KITS',
    layout: 'grid',
    items: [
      { icon: IconCode, label: 'Development' },
      { icon: IconChart, label: 'BizDev' },
      { icon: IconHeadset, label: 'Support' },
      { icon: IconChevrons, label: 'Others…', muted: true },
    ],
  },
  {
    id: 'ingredients',
    x: 490, y: 537,
    color: 'yellow',
    icon: IconFlask,
    title: 'INGREDIENTS',
    layout: 'grid2',
    items: [
      { icon: IconGitBranch, label: 'Workflows' },
      { icon: IconHeart, label: 'Health Checks' },
      { icon: IconStar, label: 'Skills' },
      { icon: IconAnchor, label: 'Hooks' },
      { icon: IconBook, label: 'Lessons' },
      { icon: IconChevrons, label: 'Etc.', muted: true },
    ],
  },
  {
    id: 'plugins',
    x: 800, y: 520,
    color: 'pink',
    icon: IconPlug,
    title: 'PLUGINS',
    layout: 'grid',
    items: [
      { icon: IconList, label: 'Tasks' },
      { icon: IconGitBranch, label: 'Workflows' },
      { icon: IconChevrons, label: 'Etc.', muted: true },
    ],
  },
]

const EDGES: FlowEdge[] = [
  { id: 'if-acc', from: 'interface', to: 'access', kind: 'direct', bidirectional: true, fromSide: 'r', toSide: 'l' },
  { id: 'acc-run', from: 'access', to: 'runtime', kind: 'direct', bidirectional: true, fromSide: 'r', toSide: 'l' },
  { id: 'acc-sea', from: 'access', to: 'search', kind: 'direct', bidirectional: true, fromSide: 'r', toSide: 'l' },
  { id: 'run-plug', from: 'runtime', to: 'plugins', kind: 'data', bidirectional: true, fromSide: 'r', fromRow: 0, toSide: 'r', toRow: 0, curve: 'runtime-to-plugins' },
  { id: 'run-kits', from: 'runtime', to: 'kits', kind: 'data', bidirectional: true, fromSide: 'r', fromRow: 1, toSide: 'r', toRow: 0, curve: 'runtime-to-kits' },
  { id: 'kits-plug', from: 'kits', to: 'plugins', kind: 'direct', bidirectional: true, fromSide: 'b', toSide: 't' },
  { id: 'ing-plug', from: 'ingredients', to: 'plugins', kind: 'direct', bidirectional: true, fromSide: 'r', fromRow: 3, toSide: 'l', toRow: 0 },
  { id: 'ing-kits', from: 'ingredients', to: 'kits', kind: 'direct', bidirectional: true, fromSide: 'r', fromRow: 1, toSide: 'l', toRow: 0 },
  { id: 'sea-kits', from: 'search', to: 'kits', kind: 'direct', bidirectional: true, fromSide: 'r', toSide: 'l' },
]

const COLORS: Record<ColorKey, { stroke: string; fill: string; glow: string; text: string }> = {
  pink:    { stroke: '#ff709e', fill: 'rgba(255,112,158,0.10)', glow: 'rgba(255,112,158,0.35)', text: '#ff89ab' },
  cyan:    { stroke: '#67e8f9', fill: 'rgba(103,232,249,0.10)', glow: 'rgba(103,232,249,0.30)', text: '#a5f3fc' },
  violet:  { stroke: '#a78bfa', fill: 'rgba(167,139,250,0.10)', glow: 'rgba(167,139,250,0.30)', text: '#c4b5fd' },
  emerald: { stroke: '#34d399', fill: 'rgba(52,211,153,0.10)',  glow: 'rgba(52,211,153,0.30)',  text: '#6ee7b7' },
  yellow:  { stroke: '#eaea00', fill: 'rgba(234,234,0,0.10)',   glow: 'rgba(234,234,0,0.28)',   text: '#fde047' },
}

const DOT_SPEED = 180

type Anchor = { x: number; y: number }

function buildPath(p1: Anchor, p2: Anchor, fromSide: Side, toSide: Side, curve?: CurveName): string {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const offFrom = (fromSide === 'l' || fromSide === 'r') ? Math.max(40, Math.abs(dx) * 0.45) : Math.max(40, Math.abs(dy) * 0.45)
  const offTo   = (toSide   === 'l' || toSide   === 'r') ? Math.max(40, Math.abs(dx) * 0.45) : Math.max(40, Math.abs(dy) * 0.45)
  const c1 = { ...p1 }
  const c2 = { ...p2 }
  if (fromSide === 'r') c1.x += offFrom
  if (fromSide === 'l') c1.x -= offFrom
  if (fromSide === 't') c1.y -= offFrom
  if (fromSide === 'b') c1.y += offFrom
  if (toSide === 'r') c2.x += offTo
  if (toSide === 'l') c2.x -= offTo
  if (toSide === 't') c2.y -= offTo
  if (toSide === 'b') c2.y += offTo

  if (curve === 'runtime-to-kits') {
    const sweepX = Math.max(p1.x, p2.x) + 120
    return `M ${p1.x} ${p1.y} C ${sweepX} ${p1.y}, ${sweepX} ${p2.y}, ${p2.x} ${p2.y}`
  }
  if (curve === 'runtime-to-plugins') {
    const sweepX = Math.max(p1.x, p2.x) + 340
    return `M ${p1.x} ${p1.y} C ${sweepX} ${p1.y}, ${sweepX} ${p2.y}, ${p2.x} ${p2.y}`
  }
  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`
}

type FlowNodeBoxProps = {
  node: FlowNode
  isHovered: boolean
  onHover: (id: string | null) => void
  registerRef: (id: string, el: HTMLDivElement | null) => void
}

function FlowNodeBox({ node, isHovered, onHover, registerRef }: FlowNodeBoxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const c = COLORS[node.color]
  const NodeIcon = node.icon

  useEffect(() => {
    registerRef(node.id, ref.current)
  }, [node.id, registerRef])

  const isGrid = node.layout === 'grid'
  const isGrid2 = node.layout === 'grid2'
  const cols = isGrid ? 4 : isGrid2 ? 2 : 1
  const itemWidthGrid = 88
  const widthFlat = 188
  const pad = 18
  const width = isGrid ? cols * itemWidthGrid + (cols + 1) * pad - pad
              : isGrid2 ? cols * itemWidthGrid + (cols - 1) * 8 + pad * 2
              : widthFlat

  const softGlow = c.glow.replace('0.3', '0.18').replace('0.35', '0.2').replace('0.28', '0.16')

  return (
    <div
      ref={ref}
      data-node-id={node.id}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        position: 'absolute',
        left: node.x, top: node.y,
        width,
        background: 'rgba(15,14,14,0.85)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: `1px solid ${c.stroke}`,
        borderRadius: 14,
        padding: pad,
        boxShadow: isHovered
          ? `0 0 0 1px ${c.stroke}, 0 0 32px ${c.glow}, 0 12px 32px rgba(0,0,0,0.5)`
          : `0 0 0 0.5px ${c.stroke}aa, 0 0 18px ${softGlow}, 0 8px 24px rgba(0,0,0,0.45)`,
        userSelect: 'none',
        transition: 'box-shadow 180ms ease',
        zIndex: isHovered ? 10 : 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, marginBottom: 6 }}>
        <div style={{
          width: 24, height: 24,
          borderRadius: 6,
          background: c.fill,
          color: c.stroke,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <NodeIcon size={14} />
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.18em',
          color: c.text,
          fontWeight: 500,
          flex: 1,
        }}>{node.title}</div>
      </div>

      <div style={{
        display: isGrid || isGrid2 ? 'grid' : 'flex',
        flexDirection: 'column',
        gridTemplateColumns: (isGrid || isGrid2) ? `repeat(${cols}, 1fr)` : undefined,
        gap: 6,
      }}>
        {node.items.map((it, i) => {
          const ItemIcon = it.icon
          const inGrid = isGrid || isGrid2
          return (
            <div key={i} data-row-index={i} style={{
              display: 'flex',
              flexDirection: inGrid ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: inGrid ? 'center' : 'flex-start',
              gap: inGrid ? 6 : 10,
              height: inGrid ? 64 : 36,
              padding: inGrid ? '8px 6px' : '0 10px',
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(74,71,71,0.18)',
              borderRadius: 8,
              color: it.muted ? 'rgba(174,170,170,0.55)' : '#ffffff',
              fontFamily: 'var(--font-body)',
              fontSize: inGrid ? 11 : 12,
              fontWeight: 500,
            }}>
              <span style={{
                color: it.muted ? 'rgba(174,170,170,0.5)' : c.text,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: inGrid ? 22 : 16, height: inGrid ? 22 : 16,
                flexShrink: 0,
              }}>
                <ItemIcon size={inGrid ? 16 : 14} />
              </span>
              <span style={{ textAlign: inGrid ? 'center' : 'left', lineHeight: 1.1 }}>{it.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const MIN_SCALE = 0.3
const MAX_SCALE = 3
const ZOOM_STEP = 1.2
const WHEEL_ZOOM_SENSITIVITY = 0.0015
const FIT_PAD = 0.94
const SWEEP_BUFFER_RIGHT = 360
const SWEEP_BUFFER_TOP = 40
const SWEEP_BUFFER_BOTTOM = 40

export default function ArchitectureFlow() {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const naturalBoundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const [hovered, setHovered] = useState<string | null>(null)
  const [edgeAnchors, setEdgeAnchors] = useState<Record<string, { a1: Anchor; a2: Anchor }>>({})
  const [pathLengths, setPathLengths] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!canvasRef.current) return
    const canvasRect = canvasRef.current.getBoundingClientRect()
    const refs = nodeRefs.current
    const newAnchors: Record<string, { a1: Anchor; a2: Anchor }> = {}
    type LocalRect = { left: number; top: number; width: number; height: number }
    const toCanvas = (r: DOMRect): LocalRect => ({
      left: r.left - canvasRect.left,
      top:  r.top - canvasRect.top,
      width: r.width,
      height: r.height,
    })
    const anchorFor = (nodeEl: HTMLDivElement, side: Side, row?: number): Anchor => {
      const boxRect = toCanvas(nodeEl.getBoundingClientRect())
      let rowRect: LocalRect | null = null
      if (row !== undefined && row !== null) {
        const rowEl = nodeEl.querySelector(`[data-row-index="${row}"]`) as HTMLElement | null
        if (rowEl) rowRect = toCanvas(rowEl.getBoundingClientRect())
      }
      const r = rowRect || boxRect
      switch (side) {
        case 'l': return { x: boxRect.left, y: r.top + r.height / 2 }
        case 'r': return { x: boxRect.left + boxRect.width, y: r.top + r.height / 2 }
        case 't': return { x: r.left + r.width / 2, y: boxRect.top }
        case 'b': return { x: r.left + r.width / 2, y: boxRect.top + boxRect.height }
      }
    }
    EDGES.forEach((edge) => {
      const fromEl = refs[edge.from]
      const toEl = refs[edge.to]
      if (!fromEl || !toEl) return
      newAnchors[edge.id] = {
        a1: anchorFor(fromEl, edge.fromSide, edge.fromRow),
        a2: anchorFor(toEl, edge.toSide, edge.toRow),
      }
    })
    setEdgeAnchors(newAnchors)
  }, [])

  useEffect(() => {
    const lens: Record<string, number> = {}
    EDGES.forEach((edge) => {
      const el = document.getElementById(`edgepath-${edge.id}`) as SVGPathElement | null
      if (el && typeof el.getTotalLength === 'function') lens[edge.id] = el.getTotalLength()
    })
    setPathLengths(lens)
  }, [edgeAnchors])

  const fitView = useCallback(() => {
    const stage = stageRef.current
    const bounds = naturalBoundsRef.current
    if (!stage || !bounds) return
    const stageRect = stage.getBoundingClientRect()
    let { minX, minY, maxX, maxY } = bounds
    EDGES.forEach((edge) => {
      const el = document.getElementById(`edgepath-${edge.id}`) as SVGGraphicsElement | null
      if (!el || typeof el.getBBox !== 'function') return
      try {
        const b = el.getBBox()
        if (b.width === 0 && b.height === 0) return
        minX = Math.min(minX, b.x)
        minY = Math.min(minY, b.y)
        maxX = Math.max(maxX, b.x + b.width)
        maxY = Math.max(maxY, b.y + b.height)
      } catch {}
    })
    maxX += SWEEP_BUFFER_RIGHT
    minY -= SWEEP_BUFFER_TOP
    maxY += SWEEP_BUFFER_BOTTOM
    const contentW = maxX - minX
    const contentH = maxY - minY
    if (contentW <= 0 || contentH <= 0) return
    const scaleW = (stageRect.width * FIT_PAD) / contentW
    const scaleH = (stageRect.height * FIT_PAD) / contentH
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(scaleW, scaleH)))
    setScale(next)
    setPan({
      x: (stageRect.width - next * (minX + maxX)) / 2 + 50,
      y: (stageRect.height - next * (minY + maxY)) / 2,
    })
  }, [])

  const centeredRef = useRef(false)
  useEffect(() => {
    if (centeredRef.current) return
    const stage = stageRef.current
    const refs = nodeRefs.current
    if (!stage || Object.keys(refs).length < NODES.length) return
    const stageRect = stage.getBoundingClientRect()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    Object.values(refs).forEach((el) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      minX = Math.min(minX, r.left - stageRect.left)
      minY = Math.min(minY, r.top - stageRect.top)
      maxX = Math.max(maxX, r.right - stageRect.left)
      maxY = Math.max(maxY, r.bottom - stageRect.top)
    })
    naturalBoundsRef.current = { minX, minY, maxX, maxY }
    centeredRef.current = true
    fitView()
  }, [edgeAnchors, fitView])

  useEffect(() => {
    if (!centeredRef.current) return
    const handle = () => fitView()
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [fitView])

  const zoomBy = useCallback((factor: number, pivot?: { x: number; y: number }) => {
    const stage = stageRef.current
    if (!stage) return
    const stageRect = stage.getBoundingClientRect()
    const cx = pivot?.x ?? stageRect.width / 2
    const cy = pivot?.y ?? stageRect.height / 2
    setScale((prev) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev * factor))
      if (next === prev) return prev
      const ratio = next / prev
      setPan((p) => ({
        x: cx - (cx - p.x) * ratio,
        y: cy - (cy - p.y) * ratio,
      }))
      return next
    })
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = stage.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)
      zoomBy(factor, { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    nodeRefs.current[id] = el
  }, [])

  const enterFullscreen = useCallback(() => {
    stageRef.current?.requestFullscreen?.()
  }, [])

  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; pointerId: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const onStageMouseDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-node-id]')) return
    if (target.closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, pointerId: e.pointerId }
    setIsDragging(true)
  }, [pan.x, pan.y])

  const onStageMouseMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) })
  }, [])

  const onStageMouseUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setIsDragging(false)
  }, [])

  return (
    <section className="architecture-flow not-content" aria-label="Bakin agent architecture diagram">
      <div
        ref={stageRef}
        className="architecture-flow__stage"
        onPointerDown={onStageMouseDown}
        onPointerMove={onStageMouseMove}
        onPointerUp={onStageMouseUp}
        onPointerCancel={onStageMouseUp}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div className="architecture-flow__grid-haze" aria-hidden="true" />
        <div
          ref={canvasRef}
          style={{
            position: 'absolute',
            transformOrigin: '0 0',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            willChange: 'transform',
            width: 0, height: 0,
          }}
        >
          <svg
            style={{
              position: 'absolute',
              left: -2000, top: -2000,
              width: 6000, height: 6000,
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <defs>
              <marker id="arrow-pink" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 Z" fill="#ff709e" />
              </marker>
              <marker id="arrow-pink-soft" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 Z" fill="#ff89ab" />
              </marker>
            </defs>
            <g transform="translate(2000, 2000)">
              {EDGES.map((edge) => {
                const a = edgeAnchors[edge.id]
                if (!a) return null
                const path = buildPath(a.a1, a.a2, edge.fromSide, edge.toSide, edge.curve)
                const isHi = !!hovered && (edge.from === hovered || edge.to === hovered)
                const stroke = edge.kind === 'direct' ? '#ff709e' : '#ff89ab'
                const baseOpacity = hovered ? (isHi ? 1 : 0.22) : 0.92
                const pathId = `edgepath-${edge.id}`
                const markerName = edge.kind === 'direct' ? 'arrow-pink' : 'arrow-pink-soft'
                const len = pathLengths[edge.id]
                const dur = len ? `${(2 * len / DOT_SPEED).toFixed(2)}s` : null
                return (
                  <g key={edge.id} style={{ transition: 'opacity 200ms ease' }} opacity={baseOpacity}>
                    <path d={path} fill="none"
                          stroke={stroke}
                          strokeWidth={isHi ? 8 : 5.5}
                          strokeOpacity={isHi ? 0.35 : 0.18}
                          strokeLinecap="round"
                          style={{ filter: 'blur(2px)' }}
                    />
                    <path id={pathId} d={path} fill="none"
                          stroke={stroke}
                          strokeWidth={isHi ? 2.8 : 2.2}
                          strokeLinecap="round"
                          markerEnd={`url(#${markerName})`}
                          markerStart={edge.bidirectional ? `url(#${markerName})` : undefined}
                    />
                    {edge.bidirectional && dur ? (
                      <circle key={dur} r={isHi ? 4 : 3.2} fill={stroke}
                              style={{ filter: `drop-shadow(0 0 4px ${stroke})` }}>
                        <animateMotion
                          dur={dur}
                          repeatCount="indefinite"
                          keyTimes="0;0.5;1"
                          keyPoints="0;1;0"
                          calcMode="linear"
                        >
                          <mpath xlinkHref={`#${pathId}`} />
                        </animateMotion>
                      </circle>
                    ) : null}
                  </g>
                )
              })}
            </g>
          </svg>

          {NODES.map((n) => (
            <FlowNodeBox
              key={n.id}
              node={n}
              isHovered={hovered === n.id}
              onHover={setHovered}
              registerRef={registerRef}
            />
          ))}
        </div>
        <div className="architecture-flow__controls" aria-label="Diagram controls">
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/></svg>
          </button>
          <button type="button" aria-label="Fit view" title="Fit view" onClick={fitView}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
          </button>
          <button type="button" aria-label="Open fullscreen" title="Open fullscreen" onClick={enterFullscreen}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>
        </div>
      </div>
    </section>
  )
}
