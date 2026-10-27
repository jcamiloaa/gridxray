import type { MouseEvent } from 'react'
import { route, type Vec2 } from './layout'
import type { GridModel } from './model'
import { palette, voltageColor } from './palette'

/** Top-down overview with the camera's footprint; click to move the view there. */
export function Minimap({ model, pos, footprint, onNavigate }: {
  model: GridModel; pos: Map<number, Vec2>; footprint: Vec2[] | null; onNavigate: (x: number, z: number) => void
}) {
  const pts = [...pos.values()]
  const pad = 6
  const x0 = Math.min(...pts.map((p) => p[0])) - pad - 4
  const z0 = Math.min(...pts.map((p) => p[1])) - pad
  const w = Math.max(...pts.map((p) => p[0])) - x0 + pad
  const h = Math.max(...pts.map((p) => p[1])) - z0 + pad

  const click = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const s = Math.max(w / r.width, h / r.height) // preserveAspectRatio="xMidYMid meet"
    const ox = (r.width * s - w) / 2
    const oz = (r.height * s - h) / 2
    onNavigate(x0 - ox + (e.clientX - r.left) * s, z0 - oz + (e.clientY - r.top) * s)
  }

  return (
    <div className="minimap" aria-label="Minimap">
      <svg viewBox={`${x0} ${z0} ${w} ${h}`} onClick={click} role="img">
        <title>Minimap: click to move the view</title>
        {model.edges.map((e) => (
          <polyline key={`${e.from}-${e.to}`} points={route(pos.get(e.from)!, pos.get(e.to)!).map((p) => p.join(',')).join(' ')}
            fill="none" stroke={palette.flow} strokeWidth={0.6} opacity={0.75} />
        ))}
        {model.substations.map((s) => {
          const [x, z] = pos.get(s.id)!
          return <rect key={s.id} x={x - 3.6} y={z - 2.7} width={7.2} height={5.4} rx={0.6} fill={palette.ink} />
        })}
        {model.nodes.map((n) => {
          const [x, z] = pos.get(n.id)!
          return <circle key={n.id} cx={x} cy={z} r={0.9} fill={n.metered ? voltageColor(n.vm) : '#b8c0c9'} />
        })}
        {footprint && (
          <polygon points={footprint.map((p) => p.join(',')).join(' ')} fill="rgba(14,110,140,.12)"
            stroke={palette.accent} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    </div>
  )
}
