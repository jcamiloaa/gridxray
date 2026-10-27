// Where GridXray fits: a line-art schematic of the supply chain, from generation to the customer,
// with the voltage profile underneath and GridXray's scope framed like a scan.

export interface ChainCopy {
  scope: string
  scopeSub: string
  stages: [string, string][] // name, spec: generation, step-up, transmission, HV/MV, MV, secondary, LV
  profile: string
}

const G = 250 // ground line
const SCOPE = { x0: 588, x1: 1046 }
const INK = '#cfc9bf'
const FILL = '#17171b'
const AMBER = '#ff8a3d'

type P = [number, number]

/** Conductor between attachment points, sagging like a real span. */
function catenary(pts: P[]) {
  return pts.map(([x, y], i) => {
    if (!i) return `M${x} ${y}`
    const [px, py] = pts[i - 1]
    const sag = Math.min(26, Math.abs(x - px) * 0.08)
    return `Q${(px + x) / 2} ${Math.max(py, y) + sag} ${x} ${y}`
  }).join(' ')
}

function Tower({ x, h = 150 }: { x: number; h?: number }) {
  const top = G - h
  const zig: string[] = []
  for (let i = 0; i < 5; i++) {
    const y0 = G - (i * h * 0.75) / 5
    const y1 = G - ((i + 1) * h * 0.75) / 5
    const w0 = 22 - (16 * (G - y0)) / h
    const w1 = 22 - (16 * (G - y1)) / h
    zig.push(`M${x - w0} ${y0} L${x + w1} ${y1} M${x + w0} ${y0} L${x - w1} ${y1}`)
  }
  return (
    <g stroke={INK} strokeWidth={1.3} fill="none" strokeLinejoin="round">
      <path d={`M${x - 22} ${G} L${x - 6} ${top} L${x + 6} ${top} L${x + 22} ${G}`} />
      <path d={zig.join(' ')} strokeOpacity={0.55} />
      <path d={`M${x - 36} ${top + 20} H${x + 36} M${x - 28} ${top + 46} H${x + 28} M${x - 6} ${top + 20} L${x - 20} ${top + 46} M${x + 6} ${top + 20} L${x + 20} ${top + 46}`} />
      {[-34, 34, -26, 26].map((dx, i) => <line key={i} x1={x + dx} y1={top + (i < 2 ? 20 : 46)} x2={x + dx} y2={top + (i < 2 ? 30 : 56)} strokeOpacity={0.7} />)}
    </g>
  )
}

function Pole({ x, h = 108, arm = 22 }: { x: number; h?: number; arm?: number }) {
  return (
    <g stroke={INK} strokeWidth={1.4} fill="none">
      <line x1={x} y1={G} x2={x} y2={G - h} />
      <line x1={x - arm} y1={G - h + 6} x2={x + arm} y2={G - h + 6} />
      {[-arm + 4, 0, arm - 4].map((dx) => <line key={dx} x1={x + dx} y1={G - h + 6} x2={x + dx} y2={G - h} strokeOpacity={0.7} />)}
    </g>
  )
}

function Transformer({ x, w = 40, h = 34, fins = 5 }: { x: number; w?: number; h?: number; fins?: number }) {
  return (
    <g stroke={INK} strokeWidth={1.3}>
      <rect x={x - w / 2} y={G - h} width={w} height={h} rx={2} fill={FILL} />
      {Array.from({ length: fins }, (_, i) => {
        const fx = x - w / 2 + ((i + 1) * w) / (fins + 1)
        return <line key={i} x1={fx} y1={G - h + 6} x2={fx} y2={G - 5} strokeOpacity={0.5} />
      })}
      {[-10, 0, 10].map((dx) => <rect key={dx} x={x + dx - 2.5} y={G - h - 14} width={5} height={14} rx={1.5} fill={FILL} />)}
    </g>
  )
}

const House = ({ x }: { x: number }) => (
  <g stroke={INK} strokeWidth={1.3} fill={FILL} strokeLinejoin="round">
    <path d={`M${x - 18} ${G} V${G - 26} L${x} ${G - 42} L${x + 18} ${G - 26} V${G} Z`} />
    <rect x={x - 5} y={G - 14} width={10} height={14} fill="none" strokeOpacity={0.7} />
  </g>
)

/** Log-scale voltage profile: y for a voltage in kV. */
const PY0 = 346
const PY1 = 446
const vy = (kv: number) => PY1 - ((Math.log10(kv) - Math.log10(0.2)) / (Math.log10(400) - Math.log10(0.2))) * (PY1 - PY0)

export function ChainDiagram({ copy }: { copy: ChainCopy }) {
  const conductor: P[] = [[124, G - 44], [230, G - 48], [380, G - 130], [520, G - 130], [626, G - 92]]
  const inScope: P[] = [[722, G - 70], [790, G - 102], [890, G - 102], [980, G - 50]]
  const lv: P[] = [[980, G - 50], [1064, G - 66], [1110, G - 30], [1170, G - 30]]
  const xs = [96, 230, 450, 656, 840, 975, 1180]
  const steps: [number, number, number][] = [[84, 230, 15], [230, 640, 110], [640, 980, 20], [980, 1180, 0.4]]
  const profile = steps.map(([a, b, kv], i) => `${i ? 'L' : 'M'}${a} ${vy(kv)} L${b} ${vy(kv)}`).join(' ')

  return (
    <svg className="lx-chain-svg" viewBox="0 0 1200 466" role="img" aria-label={`${copy.scope}: ${copy.scopeSub}`}>
      <defs>
        <linearGradient id="lx-scope-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={AMBER} stopOpacity="0.1" />
          <stop offset="1" stopColor={AMBER} stopOpacity="0.02" />
        </linearGradient>
        <pattern id="lx-chain-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0V24" fill="none" stroke="#ffffff" strokeOpacity="0.035" />
        </pattern>
      </defs>
      <rect width="1200" height="466" fill="url(#lx-chain-grid)" />

      {/* GridXray scope, framed with the same registration corners as the product scans */}
      <rect x={SCOPE.x0} y={34} width={SCOPE.x1 - SCOPE.x0} height={G + 60 - 34} fill="url(#lx-scope-fill)" />
      <g stroke={AMBER} strokeWidth={2} fill="none">
        <path d={`M${SCOPE.x0} 50 V34 H${SCOPE.x0 + 16} M${SCOPE.x1 - 16} 34 H${SCOPE.x1} V50`} />
        <path d={`M${SCOPE.x0} ${G + 44} V${G + 60} H${SCOPE.x0 + 16} M${SCOPE.x1 - 16} ${G + 60} H${SCOPE.x1} V${G + 44}`} />
      </g>
      <text x={SCOPE.x0 + 22} y={58} className="lx-chain-scope">{copy.scope}</text>
      <text x={SCOPE.x0 + 22} y={76} className="lx-chain-sub">{copy.scopeSub}</text>

      <line x1={20} y1={G} x2={1180} y2={G} stroke={INK} strokeOpacity={0.35} />

      {/* generation */}
      <g stroke={INK} strokeWidth={1.3} fill={FILL} strokeLinejoin="round">
        <rect x={36} y={G - 58} width={86} height={58} />
        <rect x={52} y={G - 112} width={10} height={54} />
        <path d={`M132 ${G} C138 ${G - 30} 136 ${G - 58} 141 ${G - 82} H171 C176 ${G - 58} 174 ${G - 30} 180 ${G} Z`} />
        {[0, 1, 2].map((i) => <rect key={i} x={48 + i * 22} y={G - 40} width={12} height={10} fill="none" strokeOpacity={0.6} />)}
        <path d={`M150 ${G - 92} q6 -8 0 -16 q-6 -8 2 -16`} fill="none" strokeOpacity={0.35} />
      </g>
      <Transformer x={230} />
      <Tower x={380} />
      <Tower x={520} />

      {/* HV/MV substation: gantry, power transformer, switchgear busbar, fence */}
      <g stroke={INK} strokeWidth={1.3} fill="none">
        <path d={`M614 ${G} V${G - 96} M638 ${G} V${G - 96} M606 ${G - 92} H646`} />
        <path d={`M600 ${G} V${G - 14} H732 V${G}`} strokeOpacity={0.45} strokeDasharray="2 4" />
        <rect x={696} y={G - 74} width={30} height={74} fill={FILL} />
        <line x1={692} y1={G - 70} x2={730} y2={G - 70} stroke={AMBER} strokeWidth={2.4} />
      </g>
      <Transformer x={667} w={44} h={40} fins={6} />

      <Pole x={790} />
      <Pole x={890} />
      {/* secondary substation kiosk */}
      <g stroke={INK} strokeWidth={1.3} fill={FILL} strokeLinejoin="round">
        <rect x={952} y={G - 48} width={56} height={48} />
        <path d={`M946 ${G - 48} H1014`} />
        <path d={`M983 ${G - 36} l-7 12 h6 l-3 11 l9 -14 h-6 l4 -9 z`} fill={AMBER} stroke="none" />
      </g>
      <Pole x={1064} h={72} arm={14} />
      <House x={1110} />
      <House x={1170} />

      {/* conductors: muted outside the scope, energised inside it */}
      <g fill="none" strokeLinecap="round">
        <path d={catenary(conductor)} stroke={INK} strokeOpacity={0.55} strokeWidth={1.2} />
        <path d={catenary(conductor)} stroke={AMBER} strokeOpacity={0.6} strokeWidth={1.6} className="lx-chain-flow" />
        <path d={`M626 ${G - 92} L652 ${G - 54} M682 ${G - 54} L696 ${G - 70}`} stroke={AMBER} strokeWidth={1.6} />
        <path d={catenary(inScope)} stroke={AMBER} strokeOpacity={0.3} strokeWidth={6} />
        <path d={catenary(inScope)} stroke="#ffb27a" strokeWidth={1.8} />
        <path d={catenary(inScope)} stroke="#fff1e3" strokeWidth={1.8} className="lx-chain-flow" />
        <path d={catenary(lv)} stroke={INK} strokeOpacity={0.55} strokeWidth={1.2} />
        <path d={catenary(lv)} stroke={AMBER} strokeOpacity={0.45} strokeWidth={1.4} className="lx-chain-flow" />
      </g>

      {/* stage labels */}
      {copy.stages.map(([name, spec], i) => (
        // the last stage hugs the right edge so long labels never run into the secondary substation's
        <g key={i} textAnchor={i === copy.stages.length - 1 ? 'end' : 'middle'}>
          <text x={xs[i]} y={G + 26} className={i >= 3 && i <= 5 ? 'lx-chain-name lx-chain-name--on' : 'lx-chain-name'}>{name}</text>
          <text x={xs[i]} y={G + 42} className="lx-chain-spec">{spec}</text>
        </g>
      ))}

      {/* voltage profile, log scale */}
      <line x1={20} y1={PY0 - 34} x2={1180} y2={PY0 - 34} stroke="#ffffff" strokeOpacity={0.08} />
      <text x={20} y={PY0 - 12} className="lx-chain-axis lx-chain-axis--title">{copy.profile}</text>
      {[110, 20, 0.4].map((kv) => (
        <g key={kv}>
          <line x1={84} y1={vy(kv)} x2={1180} y2={vy(kv)} stroke="#ffffff" strokeOpacity={0.06} />
          <text x={20} y={vy(kv) + 4} className="lx-chain-axis">{kv} kV</text>
        </g>
      ))}
      <path d={profile} fill="none" stroke={INK} strokeOpacity={0.5} strokeWidth={1.4} />
      <path d={`M640 ${vy(110)} V${vy(20)} H980 V${vy(0.4)}`} fill="none" stroke={AMBER} strokeWidth={2.4} />
      <rect x={640} y={vy(20) - 9} width={340} height={18} fill={AMBER} fillOpacity={0.08} />
    </svg>
  )
}
