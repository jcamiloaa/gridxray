import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import type { GridModel, SceneNode } from './model'
import { voltageColor } from './palette'
import { equipmentTags } from './tags'

const DY = 30 // row pitch
const DX = 34 // lateral indent
const LABEL_W = 150
const BUS_Y = 170
const FEEDER_Y = 230

interface Placed { id: number; x: number; y: number; parent: number | null }

const INK = '#1f2a37'
const UG = '#6c4fa3'

/** Recloser (square with R), sectionalizer (switch blade) or fuse (rectangle with link). */
function EquipmentSymbol({ kind, x, y, horizontal, tag }: { kind: 'recloser' | 'sectionalizer' | 'fuse'; x: number; y: number; horizontal: boolean; tag?: string }) {
  return (
    <g>
      {kind === 'recloser' && (
        <>
          <rect x={x - 7} y={y - 7} width={14} height={14} fill="#fff" stroke={INK} strokeWidth={1.6} />
          <text x={x} y={y + 4} textAnchor="middle" className="sld-sym">R</text>
          {tag && <text x={x + 11} y={y - 8} className="sld-tag sld-tag--feeder">{tag}</text>}
        </>
      )}
      {kind === 'sectionalizer' && (
        <g stroke={INK} strokeWidth={1.6} fill="#fff">
          <circle cx={horizontal ? x - 6 : x} cy={horizontal ? y : y - 6} r={2.2} />
          <line x1={horizontal ? x - 6 : x} y1={horizontal ? y : y - 6} x2={horizontal ? x + 6 : x + 5} y2={horizontal ? y - 5 : y + 6} />
        </g>
      )}
      {kind === 'fuse' && (
        <g stroke={INK} strokeWidth={1.4} fill="#fff">
          <rect x={horizontal ? x - 7 : x - 3.5} y={horizontal ? y - 3.5 : y - 7} width={horizontal ? 14 : 7} height={horizontal ? 7 : 14} />
          <line x1={horizontal ? x - 7 : x} y1={horizontal ? y : y - 7} x2={horizontal ? x + 7 : x} y2={horizontal ? y : y + 7} />
        </g>
      )}
    </g>
  )
}
const MUTED = '#6b7682'
const ACCENT = '#0e6e8c'

/** Breaker: small square on a line. */
function Breaker({ x, y, tag }: { x: number; y: number; tag?: string }) {
  return (
    <g>
      <rect x={x - 6} y={y - 6} width={12} height={12} fill="#fff" stroke={INK} strokeWidth={1.6} />
      {tag && <text x={x + 12} y={y + 4} className="sld-tag">{tag}</text>}
    </g>
  )
}

/** Two-winding transformer: two overlapping circles. */
function Transformer({ x, y, r = 13, vertical = true }: { x: number; y: number; r?: number; vertical?: boolean }) {
  const d = r * 0.7
  return (
    <g fill="none" stroke={INK} strokeWidth={1.6}>
      <circle cx={vertical ? x : x - d / 2} cy={vertical ? y - d / 2 : y} r={r} />
      <circle cx={vertical ? x : x + d / 2} cy={vertical ? y + d / 2 : y} r={r} />
    </g>
  )
}

function SecondarySub({ node, x, y, selected, onSelect }: {
  node: SceneNode; x: number; y: number; selected: boolean; onSelect?: (id: number) => void
}) {
  const color = voltageColor(node.metered ? node.vm : null)
  return (
    <g className="sld-node" onClick={(e) => { e.stopPropagation(); onSelect?.(node.id) }}>
      <line x1={x} y1={y} x2={x + 10} y2={y} stroke={INK} strokeWidth={1.4} />
      <Transformer x={x + 19} y={y} r={6} vertical={false} />
      {selected && <rect x={x + 6} y={y - 11} width={LABEL_W - 4} height={22} rx={5} fill="none" stroke={ACCENT} strokeWidth={1.5} />}
      <circle cx={x + 36} cy={y} r={3.6} fill={color} />
      <text x={x + 44} y={y + 4} className="sld-tag sld-tag--strong">{node.name}</text>
      <text x={x + 92} y={y + 4} className="sld-tag">{node.metered ? (node.vm !== null ? `${node.vm.toFixed(3)} pu` : 'no data') : 'no meter'}</text>
    </g>
  )
}

/** Professional single-line diagram of the modelled network, using the same tags as the 3D view. */
export function SingleLine({ model, selected, onSelect }: {
  model: GridModel; selected?: number | null; onSelect?: (id: number | null) => void
}) {
  const tags = useMemo(() => equipmentTags(model), [model])
  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model])
  const kindOf = useMemo(() => new Map(model.edges.map((e) => [e.to, e.kind])), [model]) // node -> its feeding line kind
  const devicesAt = useMemo(() => {
    const m = new Map<number, string[]>()
    for (const d of model.devices) {
      const label = `${tags.devices.get(d.id)} · ${d.kind === 'capacitor' ? `${d.rating.toFixed(0)} kvar` : `${(d.rating / 1000).toFixed(1)} MW PV`}`
      m.set(d.node, [...(m.get(d.node) ?? []), label])
    }
    return m
  }, [model, tags])

  const drawing = useMemo(() => {
    const children = new Map<number, number[]>()
    for (const e of model.edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to])
    const size = new Map<number, number>()
    const sizeOf = (n: number): number => {
      if (!size.has(n)) size.set(n, 1 + (children.get(n) ?? []).reduce((s, k) => s + sizeOf(k), 0))
      return size.get(n)!
    }
    const placed: Placed[] = []
    const systems: { root: number; x: number; busX0: number; busX1: number; feeders: { tag: string; x: number }[] }[] = []
    let cursorX = 40
    let maxY = FEEDER_Y

    for (const s of model.substations) {
      const sysX = cursorX
      const feeders: { tag: string; x: number }[] = []
      const heads = tags.feeders.filter((f) => f.root === s.id)
      if (model.topologyKnown) {
        for (const f of heads) {
          const x0 = cursorX + 20
          let row = 0
          let maxIndent = 0
          // laterals first (indented to the right), the largest child continues the trunk below
          const place = (n: number, x: number, parent: number | null) => {
            const y = FEEDER_Y + row++ * DY
            placed.push({ id: n, x, y, parent })
            maxIndent = Math.max(maxIndent, x - x0)
            const kids = [...(children.get(n) ?? [])].sort((a, b) => sizeOf(a) - sizeOf(b))
            const trunk = kids.pop()
            for (const k of kids) place(k, x + DX, n)
            if (trunk !== undefined) place(trunk, x, n)
          }
          place(f.head, x0, null)
          feeders.push({ tag: f.tag, x: x0 })
          maxY = Math.max(maxY, FEEDER_Y + row * DY)
          cursorX = x0 + maxIndent + LABEL_W + 30
        }
      } else {
        // topology unknown: secondary substations listed without connections
        const nodes = model.nodes.filter((_, i) => i % model.substations.length === systems.length)
        const perCol = 14
        nodes.forEach((n, i) => {
          placed.push({ id: n.id, x: cursorX + 30 + Math.floor(i / perCol) * (LABEL_W + 40), y: FEEDER_Y + 20 + (i % perCol) * DY, parent: null })
        })
        maxY = Math.max(maxY, FEEDER_Y + 20 + Math.min(perCol, nodes.length) * DY)
        cursorX += 30 + Math.ceil(nodes.length / perCol) * (LABEL_W + 40) + 20
      }
      const busX1 = Math.max(cursorX - 30, sysX + 220)
      systems.push({ root: s.id, x: sysX, busX0: sysX, busX1, feeders })
      cursorX = busX1 + 90
    }
    const pos = new Map(placed.map((p) => [p.id, p]))
    return { placed, pos, systems, width: cursorX + 40, height: maxY + 60 }
  }, [model, tags])

  /* ---- pan & zoom via the viewBox ---- */
  // start readable: left margin for overlays, and no more than ~1300 x 760 units in view
  const full = useMemo(() => ({ x: -260, y: -70, w: Math.min(drawing.width + 260, 1300), h: Math.min(drawing.height + 90, 760) }), [drawing])
  const [view, setView] = useState(full)
  // Collapsed by default so the key never hides the diagram itself.
  const [legend, setLegend] = useState(false)
  useEffect(() => setView(full), [full])
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const toView = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect()
    const s = Math.max(view.w / r.width, view.h / r.height)
    return { s, x: view.x + (clientX - r.left - (r.width - view.w / s) / 2) * s, y: view.y + (clientY - r.top - (r.height - view.h / s) / 2) * s }
  }
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const p = toView(e.clientX, e.clientY)
    const f = e.deltaY > 0 ? 1.15 : 1 / 1.15
    setView((v) => ({ x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w: v.w * f, h: v.h * f }))
  }
  const onDown = (e: PointerEvent<SVGSVGElement>) => { drag.current = { x: e.clientX, y: e.clientY } }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    const { s } = toView(e.clientX, e.clientY)
    const dx = (e.clientX - drag.current.x) * s
    const dy = (e.clientY - drag.current.y) * s
    drag.current = { x: e.clientX, y: e.clientY }
    setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
  }

  const tieAnchor = (id: number) => {
    const p = drawing.pos.get(id)
    return p ? { x: p.x + LABEL_W - 4, y: p.y } : null
  }

  return (
    <div className="sld-wrap">
      <svg ref={svg} className="sld" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} onWheel={onWheel}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null }}
        onPointerLeave={() => { drag.current = null }} onClick={() => onSelect?.(null)} role="img"
        aria-label="Single-line diagram">
        <defs>
          <pattern id="sld-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="#e6ebf0" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x={view.x - 2000} y={view.y - 2000} width={view.w + 4000} height={view.h + 4000} fill="url(#sld-grid)" />

        {drawing.systems.map((sys) => {
          const sub = model.substations.find((s) => s.id === sys.root)!
          const tx = sys.x + 60
          return (
            <g key={sys.root}>
              {/* HV supply, transformer, MV busbar */}
              <text x={tx + 16} y={-4} className="sld-tag">110 kV supply</text>
              <line x1={tx} y1={-10} x2={tx} y2={BUS_Y} stroke={INK} strokeWidth={1.8} />
              <Breaker x={tx} y={28} tag="CB-HV" />
              <rect x={tx - 16} y={50} width={32} height={60} fill="#fff" stroke="none" />
              <Transformer x={tx} y={80} />
              <text x={tx + 24} y={76} className="sld-tag sld-tag--strong">{tags.transformer.get(sys.root)}</text>
              <text x={tx + 24} y={90} className="sld-tag">110/20 kV · 25 MVA</text>
              <Breaker x={tx} y={135} tag="CB-MV" />
              <line x1={sys.busX0} y1={BUS_Y} x2={sys.busX1} y2={BUS_Y} stroke={INK} strokeWidth={5} strokeLinecap="square" />
              <text x={sys.busX0} y={BUS_Y - 10} className="sld-title">{sub.name}</text>
              <text x={sys.busX1} y={BUS_Y + 18} className="sld-tag" textAnchor="end">MV busbar · 20 kV</text>
              {sys.feeders.map((f) => (
                <g key={f.tag}>
                  <line x1={f.x} y1={BUS_Y} x2={f.x} y2={FEEDER_Y - 8} stroke={INK} strokeWidth={1.6} />
                  <Breaker x={f.x} y={BUS_Y + 26} tag={`CB-${f.tag}`} />
                  <text x={f.x + 12} y={BUS_Y + 46} className="sld-tag sld-tag--feeder">{f.tag}</text>
                </g>
              ))}
              {!model.topologyKnown && (
                <text x={sys.busX0 + 30} y={FEEDER_Y - 8} className="sld-tag sld-tag--warn">Feeder connections unknown: to be discovered</text>
              )}
            </g>
          )
        })}

        {/* feeder lines: down the trunk, right to each lateral; underground cables in purple dashes */}
        {drawing.placed.map((p) => {
          if (p.parent === null) return null
          const q = drawing.pos.get(p.parent)!
          const ug = kindOf.get(p.id) === 'underground'
          return <path key={`l${p.id}`} d={`M${q.x} ${q.y} V${p.y} H${p.x}`} fill="none" stroke={ug ? UG : INK}
            strokeWidth={ug ? 1.8 : 1.4} strokeDasharray={ug ? '9 3' : undefined} />
        })}
        {/* feeder heads from the busbar */}
        {drawing.systems.flatMap((sys) => sys.feeders).map((f) => {
          const head = tags.feeders.find((x) => x.tag === f.tag)!.head
          const p = drawing.pos.get(head)
          if (!p) return null
          const ug = kindOf.get(head) === 'underground'
          return <line key={`h${f.tag}`} x1={f.x} y1={FEEDER_Y - 8} x2={f.x} y2={p.y} stroke={ug ? UG : INK}
            strokeWidth={ug ? 1.8 : 1.4} strokeDasharray={ug ? '9 3' : undefined} />
        })}
        {/* switching and protection equipment, drawn on the section feeding each node */}
        {model.equipment.map((e, i) => {
          const child = drawing.pos.get(e.a)?.parent === e.b ? e.a : e.b
          const p = drawing.pos.get(child)
          if (!p) return null
          const q = p.parent !== null ? drawing.pos.get(p.parent)! : null
          const lateral = q && q.x !== p.x
          const x = lateral ? p.x - 14 : p.x
          const y = lateral ? p.y : p.y - 15
          return <EquipmentSymbol key={i} kind={e.kind} x={x} y={y} horizontal={!!lateral}
            tag={e.kind === 'recloser' ? tags.reclosers.find((r) => (r.a === e.a && r.b === e.b))?.tag : undefined} />
        })}
        {model.topologyKnown ? null : drawing.placed.map((p) => (
          <line key={`u${p.id}`} x1={p.x} y1={p.y - 12} x2={p.x} y2={p.y} stroke={MUTED} strokeWidth={1.2} strokeDasharray="3 3" />
        ))}

        {/* tie switches (normally open) */}
        {tags.ties.map((t, i) => {
          const a = tieAnchor(t.a)
          const b = tieAnchor(t.b)
          if (!a || !b) return null
          const xm = Math.max(a.x, b.x) + 24 + i * 10
          const ym = (a.y + b.y) / 2
          const color = t.closed ? '#17a673' : '#d64545'
          return (
            <g key={t.tag}>
              <path d={`M${a.x} ${a.y} H${xm} V${b.y} H${b.x}`} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray={t.closed ? undefined : '5 4'} />
              <rect x={xm - 7} y={ym - 9} width={14} height={18} fill="#fff" />
              <line x1={xm} y1={ym + 8} x2={t.closed ? xm : xm + 8} y2={ym - 8} stroke={color} strokeWidth={2} />
              <text x={xm + 12} y={ym + 4} className="sld-tag" fill={color}>{t.tag} · {t.closed ? 'closed' : 'N.O.'}</text>
            </g>
          )
        })}

        {drawing.placed.map((p) => (
          <g key={p.id}>
            {p.parent !== null || model.topologyKnown ? <circle cx={p.x} cy={p.y} r={2.4} fill={INK} /> : null}
            <SecondarySub node={byId.get(p.id)!} x={p.x} y={p.y} selected={selected === p.id} onSelect={onSelect ?? undefined} />
            {devicesAt.get(p.id)?.map((label, i) => (
              <text key={label} x={p.x + 44} y={p.y + 15 + i * 11} className="sld-tag sld-tag--device">{label}</text>
            ))}
          </g>
        ))}
      </svg>
      {!legend ? (
        <button type="button" className="sld-legend-toggle" onClick={() => setLegend(true)} aria-expanded={false}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h2M10 6h10M4 12h2M10 12h10M4 18h2M10 18h10" /></svg>
          Legend
        </button>
      ) : (
      <div className="sld-legend card" role="dialog" aria-label="Single-line diagram legend">
        <span className="sld-legend__head"><b>Single-line diagram</b>
          <button type="button" className="sld-legend__close" onClick={() => setLegend(false)} aria-label="Hide legend">×</button></span>
        <span><svg width="22" height="14"><rect x="5" y="1" width="12" height="12" fill="#fff" stroke={INK} strokeWidth="1.6" /></svg>Circuit breaker</span>
        <span><svg width="22" height="14"><circle cx="8" cy="7" r="5.5" fill="none" stroke={INK} strokeWidth="1.4" /><circle cx="14" cy="7" r="5.5" fill="none" stroke={INK} strokeWidth="1.4" /></svg>Transformer · SS = secondary substation</span>
        <span><svg width="22" height="14"><line x1="2" y1="7" x2="20" y2="7" stroke={INK} strokeWidth="1.6" /></svg>Overhead line</span>
        <span><svg width="22" height="14"><line x1="2" y1="7" x2="20" y2="7" stroke={UG} strokeWidth="1.8" strokeDasharray="9 3" /></svg>Underground cable</span>
        <span><svg width="22" height="14"><rect x="4" y="0" width="14" height="14" fill="#fff" stroke={INK} strokeWidth="1.4" /><text x="11" y="11" textAnchor="middle" className="sld-sym">R</text></svg>Recloser · fuse ▭ · sectionalizer ⟋</span>
        <span><svg width="22" height="14"><line x1="2" y1="7" x2="20" y2="7" stroke="#d64545" strokeWidth="1.6" strokeDasharray="4 3" /></svg>Open point: tie or open switch (N.O.)</span>
        <span className="muted">Tags match the 3D view. Scroll to zoom, drag to pan.</span>
      </div>
      )}
    </div>
  )
}
