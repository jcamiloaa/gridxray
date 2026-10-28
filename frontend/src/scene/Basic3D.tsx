import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { along, SPEED, streetPath } from './crewPath'
import type { CalloutSpec } from './GridScene'
import { layout, route, type Vec2 } from './layout'
import type { GridModel, Overlay } from './model'
import { palette, voltageColor } from './palette'

type V3 = [number, number, number]

interface Box { c: V3; w: number; d: number; h: number; wall: string; roof: string; id?: number; dot?: string }

/**
 * Basic but real 3D view drawn with Canvas 2D: used when WebGL is missing or was lost.
 * Orbit by dragging, zoom with the wheel; same callouts and selection as the WebGL scene.
 */
export function Basic3D({ model, selected = null, onSelect, callouts = [], activeCallout = null, onCalloutHover,
  showLabels = true, autoRotate = false, children, overlay }: {
  model: GridModel; selected?: number | null; onSelect?: (id: number | null) => void
  callouts?: CalloutSpec[]; activeCallout?: number | null; onCalloutHover?: (n: number | null) => void
  showLabels?: boolean; autoRotate?: boolean; children?: ReactNode; overlay?: Overlay
}) {
  const { t } = useI18n()
  // the field crew, read by the render loop: truck on the streets, then the photo flash at the site
  const crew = useRef<{ c: NonNullable<Overlay['crew']>; t0: number; texts: Record<string, string> } | null>(null)
  const c = overlay?.crew
  if (!c) crew.current = null
  else if (crew.current?.c.visit !== c.visit || crew.current.c.stage !== c.stage || crew.current.c.outdated !== c.outdated) {
    crew.current = {
      c, t0: crew.current?.c.visit === c.visit ? crew.current.t0 : performance.now(),
      texts: {
        drive: t('Crew driving to {node}').split('{node}').join(c.name), photo: t('Taking the photo · Muse Image'),
        segment: t('Segmenting the equipment · SAM 3.1'), read: t('Reading the switch · Muse Spark'),
        done: c.outdated ? t('Record outdated') : t('Field visit done'),
      },
    }
  }
  const canvas = useRef<HTMLCanvasElement>(null)
  const badges = useRef<(HTMLButtonElement | null)[]>([])
  const view = useRef({ yaw: -0.75, pitch: 0.62, zoom: 1, spin: autoRotate, active: activeCallout, selected, hover: false })
  view.current.spin = autoRotate
  view.current.active = activeCallout
  view.current.selected = selected

  const scene = useMemo(() => {
    const pos = layout(model)
    const at = (id: number) => pos.get(id)!
    const all = [...pos.values()]
    const xs = all.map((p) => p[0])
    const zs = all.map((p) => p[1])
    const bounds = { x0: Math.min(...xs) - 4, x1: Math.max(...xs) + 4, z0: Math.min(...zs) - 4, z1: Math.max(...zs) + 4 }
    const lines = (a: number, b: number) => route(at(a), at(b)).map(([x, z]): V3 => [x, 0.25, z])
    const cables = model.edges.map((e) => lines(e.from, e.to))
    const ties = model.ties.map((t) => ({ pts: lines(t.a, t.b), closed: t.closed }))
    const boxes: Box[] = []
    for (const s of model.substations) {
      const [x, z] = at(s.id)
      boxes.push({ c: [x, 0, z], w: 7, d: 5.4, h: 0.25, wall: '#cfd5db', roof: palette.concrete })
      boxes.push({ c: [x - 0.6, 0.25, z + 0.4], w: 2.2, d: 1.8, h: 1.9, wall: '#6b7682', roof: palette.transformer })
      boxes.push({ c: [x + 1.95, 0.25, z + 1.2], w: 0.35, d: 3.4, h: 1.2, wall: '#c27a3a', roof: '#b06a2c' })
    }
    for (const n of model.nodes) {
      const [x, z] = at(n.id)
      boxes.push({ c: [x, 0, z], w: 1.3, d: 1.1, h: 1.15, wall: palette.wall, roof: palette.roof, id: n.id,
        dot: n.metered ? voltageColor(n.vm) : '#a7b0ba' })
    }
    const root = model.substations[0] ? at(model.substations[0].id) : ([0, 0] as Vec2)
    const mid = (a: number, b: number): V3 => {
      const p = route(at(a), at(b))
      const [x, z] = p.length === 3 ? p[1] : [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2]
      return [x, 2.6, z]
    }
    const inner = model.edges.filter((e) => !model.substations.some((s) => s.id === e.from))
    const metered = model.nodes.find((n) => n.metered && n.vm !== null)
    // The kiosk badge goes on the secondary substation farthest from the others' anchors.
    const far = (id: number) => Math.hypot(at(id)[0] - root[0], at(id)[1] - root[1])
    const plain = [...model.nodes].filter((n) => n !== metered).sort((a, c) => far(c.id) - far(a.id))[0]
    const anchors: Record<CalloutSpec['target'], V3 | null> = {
      hv: [root[0] - 6, 6.5, root[1]],
      transformer: [root[0] - 0.6, 3.2, root[1] + 0.4],
      busbar: [root[0] + 1.95, 2.4, root[1] + 1.2],
      feeder: inner[0] ? mid(inner[0].from, inner[0].to) : null,
      kiosk: plain ? [at(plain.id)[0], 2.8, at(plain.id)[1]] : null,
      meter: metered ? [at(metered.id)[0], 2.4, at(metered.id)[1]] : null,
      tie: model.ties[0] ? mid(model.ties[0].a, model.ties[0].b) : null,
      flow: inner.length > 2 ? mid(inner[inner.length - 1].from, inner[inner.length - 1].to) : null,
    }
    const hv: V3[] = [[root[0] - 6, 0, root[1]], [root[0] - 6, 6, root[1]]]
    return { pos, bounds, cables, ties, boxes, anchors, hv, root }
  }, [model])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    let raf = 0
    let w = 0
    let h = 0
    let dpr = 1
    const resize = () => {
      const r = el.getBoundingClientRect()
      w = r.width
      h = r.height
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    const { bounds: b } = scene
    const cx = (b.x0 + b.x1) / 2
    const cz = (b.z0 + b.z1) / 2
    const span = Math.max(b.x1 - b.x0, b.z1 - b.z0)
    let project: (p: V3) => [number, number, number] = () => [0, 0, 0]

    const face = (pts: [number, number, number][], fill: string, stroke = 'rgba(15, 27, 42, .18)') => {
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      ctx.strokeStyle = stroke
      ctx.lineWidth = 0.8
      ctx.stroke()
    }
    const shade = (hex: string, k: number) => {
      const n = parseInt(hex.slice(1), 16)
      const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
      return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`
    }
    const poly = (pts: V3[]) => {
      ctx.beginPath()
      pts.map(project).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    }

    // Orbit and zoom state, read by the render loop.
    let dragging = false
    let moved = 0
    let lx = 0
    let ly = 0

    let last = performance.now()
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const v = view.current
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (v.spin && !dragging && !v.hover) v.yaw += dt * 0.12
      const s = (Math.min(w, h * 1.6) / span) * 0.92 * v.zoom
      const cy = Math.cos(v.yaw)
      const sy = Math.sin(v.yaw)
      const sp = Math.sin(v.pitch)
      const cp = Math.cos(v.pitch)
      project = ([x, y, z]) => {
        const rx = (x - cx) * cy - (z - cz) * sy
        const rz = (x - cx) * sy + (z - cz) * cy
        return [w / 2 + rx * s, h / 2 + (rz * sp - y * cp) * s, rz * cp + y * sp]
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = palette.backdrop
      ctx.fillRect(0, 0, w, h)

      // Ground plate with a light street grid.
      face([[b.x0, 0, b.z0], [b.x1, 0, b.z0], [b.x1, 0, b.z1], [b.x0, 0, b.z1]].map((p) => project(p as V3)), palette.ground, '#d3dae2')
      ctx.strokeStyle = palette.grid
      ctx.lineWidth = 1
      for (let x = Math.ceil(b.x0); x <= b.x1; x += 2) { poly([[x, 0, b.z0], [x, 0, b.z1]]); ctx.stroke() }
      for (let z = Math.ceil(b.z0); z <= b.z1; z += 2) { poly([[b.x0, 0, z], [b.x1, 0, z]]); ctx.stroke() }

      // Cables with energy flowing along them; ties dashed when open.
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const c of scene.cables) {
        ctx.setLineDash([])
        ctx.strokeStyle = palette.cable
        ctx.lineWidth = 2
        poly(c); ctx.stroke()
        ctx.setLineDash([5, 9])
        ctx.lineDashOffset = -now / 40
        ctx.strokeStyle = palette.flow
        ctx.lineWidth = 2.4
        poly(c); ctx.stroke()
      }
      for (const t of scene.ties) {
        ctx.setLineDash(t.closed ? [] : [5, 4])
        ctx.lineDashOffset = 0
        ctx.strokeStyle = t.closed ? palette.cable : palette.insulator
        ctx.lineWidth = 1.8
        poly(t.pts); ctx.stroke()
      }
      ctx.setLineDash([])
      // HV line coming in to the substation.
      ctx.strokeStyle = palette.steelDark
      ctx.lineWidth = 2
      poly(scene.hv); ctx.stroke()
      poly([scene.hv[1], [scene.root[0] - 0.6, 2.2, scene.root[1] + 0.4]]); ctx.stroke()

      // Buildings and equipment as extruded boxes, far to near.
      const sorted = scene.boxes.map((bx) => ({ bx, d: project(bx.c)[2] })).sort((a, c) => a.d - c.d)
      for (const { bx } of sorted) {
        const [x, y, z] = bx.c
        const hw = bx.w / 2
        const hd = bx.d / 2
        const base: V3[] = [[x - hw, y, z - hd], [x + hw, y, z - hd], [x + hw, y, z + hd], [x - hw, y, z + hd]]
        const top = base.map(([a, , c]): V3 => [a, y + bx.h, c])
        const sides = [0, 1, 2, 3].map((i) => {
          const j = (i + 1) % 4
          const pts = [base[i], base[j], top[j], top[i]].map(project)
          return { pts, d: (pts[0][2] + pts[1][2]) / 2, k: i % 2 ? 0.82 : 0.92 }
        }).sort((a, c) => a.d - c.d)
        for (const sd of sides) face(sd.pts, shade(bx.wall, sd.k))
        const isSel = bx.id !== undefined && bx.id === view.current.selected
        face(top.map(project), bx.roof, isSel ? palette.accent : 'rgba(15, 27, 42, .25)')
        if (bx.dot) {
          const [px, py] = project([x + 0.35, y + bx.h + 0.25, z - 0.25])
          ctx.beginPath(); ctx.arc(px, py, Math.max(2.5, s * 0.22), 0, 7)
          ctx.fillStyle = bx.dot; ctx.fill()
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke()
        }
        if (isSel) {
          const [px, py] = project([x, y, z])
          ctx.beginPath(); ctx.ellipse(px, py, s * 1.4, s * 1.4 * Math.sin(view.current.pitch), 0, 0, 7)
          ctx.strokeStyle = palette.accent; ctx.lineWidth = 2; ctx.stroke()
        }
      }
      if (showLabels && model.nodes.length <= 40) {
        ctx.font = '600 11px Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        for (const n of model.nodes) {
          const [x, z] = scene.pos.get(n.id)!
          const [px, py] = project([x, 2.2, z])
          ctx.fillStyle = 'rgba(255, 255, 255, .85)'
          const tw = ctx.measureText(n.name).width + 8
          ctx.fillRect(px - tw / 2, py - 9, tw, 14)
          ctx.fillStyle = palette.ink
          ctx.fillText(n.name, px, py + 2)
        }
      }

      const cr = crew.current
      const site = cr && scene.pos.get(cr.c.node)
      if (cr && site) {
        const path = streetPath(scene.pos.get(cr.c.from ?? -1), site)
        const { at: [tx, tz], heading, done } = along(path, cr.c.stage === 'done' ? 1e9 : ((now - cr.t0) / 1000) * SPEED)
        // truck: an oriented box with a blinking beacon
        const dx = Math.sin(heading) * 1.0
        const dz = Math.cos(heading) * 1.0
        const ox = Math.cos(heading) * 0.55
        const oz = -Math.sin(heading) * 0.55
        const foot: V3[] = [[tx - dx - ox, 0.6, tz - dz - oz], [tx + dx - ox, 0.6, tz + dz - oz], [tx + dx + ox, 0.6, tz + dz + oz], [tx - dx + ox, 0.6, tz - dz + oz]]
        face(foot.map(project), '#f4f6f8', '#f26b1d')
        const [bx, by] = project([tx + dx * 0.6, 0.85, tz + dz * 0.6])
        ctx.beginPath(); ctx.arc(bx, by, Math.max(2, s * 0.14), 0, 7)
        ctx.fillStyle = Math.sin(now / 80) > 0 ? '#ffb020' : '#8a6a2a'; ctx.fill()
        let label = cr.texts.drive
        let color = '#f26b1d'
        if (done) {
          const wx = site[0] + 0.25
          const wz = site[1] - 0.6
          const [px, py] = project([wx, 0, wz])
          const [hx, hy] = project([wx, 1.4, wz])
          ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = Math.max(3, s * 0.28)
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke()
          ctx.beginPath(); ctx.arc(hx, hy, Math.max(3, s * 0.2), 0, 7); ctx.fillStyle = '#ffd21f'; ctx.fill()
          const k = (now / 1100) % 1
          if (cr.c.stage === 'photo' && k < 0.15) {
            const [fx, fy] = project([site[0], 1, site[1]])
            ctx.beginPath(); ctx.arc(fx, fy, s * (0.6 + k * 8), 0, 7)
            ctx.fillStyle = `rgba(255, 255, 255, ${0.9 - k * 5})`; ctx.fill()
          }
          if (cr.c.stage === 'segment' || cr.c.stage === 'read') {
            const y = cr.c.stage === 'segment' ? ((Math.sin(now / 330) + 1) / 2) * 1.6 : 0.8
            const ring: V3[] = [[site[0] - 0.9, y, site[1] - 0.8], [site[0] + 0.9, y, site[1] - 0.8], [site[0] + 0.9, y, site[1] + 0.8], [site[0] - 0.9, y, site[1] + 0.8]]
            face(ring.map(project), cr.c.stage === 'segment' ? 'rgba(24, 195, 230, .25)' : 'rgba(124, 77, 219, .2)',
              cr.c.stage === 'segment' ? '#18c3e6' : '#7c4ddb')
          }
          label = cr.texts[cr.c.stage]
          color = { photo: '#f26b1d', segment: '#0f9fbf', read: '#7c4ddb', done: cr.c.outdated ? '#d64545' : '#17a673' }[cr.c.stage]
        }
        const [lx2, ly2] = done ? project([site[0], 3.8, site[1] - 0.6]) : project([tx, 1.6, tz])
        ctx.font = '600 12px Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        const tw = ctx.measureText(label).width + 18
        ctx.fillStyle = color
        ctx.beginPath(); ctx.roundRect(lx2 - tw / 2, ly2 - 11, tw, 22, 11); ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.fillText(label, lx2, ly2 + 4)
      }

      // Callout leaders on the canvas, badges as DOM so hover works like the WebGL view.
      callouts.forEach((c, i) => {
        const a = scene.anchors[c.target]
        const el2 = badges.current[i]
        if (!a || !el2) return
        const [px, py] = project([a[0], a[1] + 1.4, a[2]])
        const [qx, qy] = project(a)
        ctx.strokeStyle = view.current.active === c.n ? palette.flow : palette.accent
        ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(px, py); ctx.stroke()
        el2.style.transform = `translate(${px}px, ${py}px)`
      })
    }
    raf = requestAnimationFrame(draw)

    const down = (e: PointerEvent) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId) }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      const v = view.current
      v.yaw += (e.clientX - lx) * 0.008
      v.pitch = Math.min(1.05, Math.max(0.35, v.pitch + (e.clientY - ly) * 0.003))
      moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly)
      lx = e.clientX
      ly = e.clientY
    }
    const up = (e: PointerEvent) => {
      dragging = false
      if (moved > 4 || !onSelect) return
      // A click picks the nearest secondary substation.
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      let best: number | null = null
      let bd = 22
      for (const n of model.nodes) {
        const [x, z] = scene.pos.get(n.id)!
        const [px, py] = project([x, 0.6, z])
        const d = Math.hypot(px - mx, py - my)
        if (d < bd) { bd = d; best = n.id }
      }
      onSelect(best)
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = view.current
      v.zoom = Math.min(6, Math.max(0.5, v.zoom * (e.deltaY > 0 ? 0.9 : 1.1)))
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [scene, callouts, model, onSelect, showLabels])

  return (
    <div className="scene-shell basic3d" onPointerMove={() => { view.current.hover = true }}
      onPointerLeave={() => { view.current.hover = false }}>
      <canvas ref={canvas} className="basic3d__canvas" aria-label="3D network view" role="img" />
      <div className="scene-labels">
        {callouts.map((c, i) => scene.anchors[c.target] && (
          <button key={c.n} ref={(b) => { badges.current[i] = b }} type="button"
            className={`callout scene-anchor${activeCallout === c.n ? ' callout--active' : ''}`} aria-label={`Callout ${c.n}`}
            onMouseEnter={() => onCalloutHover?.(c.n)} onMouseLeave={() => onCalloutHover?.(null)}
            onFocus={() => onCalloutHover?.(c.n)} onBlur={() => onCalloutHover?.(null)}>{c.n}</button>
        ))}
      </div>
      <span className="scene-hint basic3d__hint">Basic 3D · drag to orbit, scroll to zoom</span>
      {children}
    </div>
  )
}
