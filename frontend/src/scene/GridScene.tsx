import { Bounds, Grid, OrbitControls, OrthographicCamera, useBounds } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { buildCity } from './city'
import { anchorOf, KOFF, layout, PX, PZ, route, type Vec2 } from './layout'
import { Minimap } from './Minimap'
import { HypothesisLayer } from './HypothesisLayer'
import type { GridModel, Overlay } from './model'
import { palette } from './palette'
import { StreetLabels } from './StreetLabels'
import { equipmentTags, type Tags } from './tags'
import { voltageColor } from './palette'
import { CableRun, CalloutLeader, CapacitorBank, GroundModel, Kiosk, SolarFarm, Substation, TieSwitch, UndergroundRun, Zone, type PoleDevice, type V3 } from './parts'

export interface CalloutSpec {
  n: number
  /** Which part of the scene the callout points at. */
  target: 'hv' | 'transformer' | 'busbar' | 'feeder' | 'kiosk' | 'meter' | 'tie' | 'flow'
}

interface Props {
  model: GridModel
  selected?: number | null
  onSelect?: (id: number | null) => void
  callouts?: CalloutSpec[]
  activeCallout?: number | null
  onCalloutHover?: (n: number | null) => void
  showLabels?: boolean
  autoRotate?: boolean
  flow?: boolean
  /** Seed for the fictional city map. */
  citySeed?: number
  /** Overlays rendered inside the scene frame, so they stay visible in fullscreen. */
  children?: ReactNode
  /** Fullscreen state owned by the surrounding view, so it survives switching to the single-line diagram. */
  fullscreen?: { on: boolean; toggle: () => void }
  /** Called when the browser drops the WebGL context, so the caller can switch to a fallback. */
  onContextLost?: () => void
  /** The investigation's live hypothesis, last experiment and comparison. */
  overlay?: Overlay
  /** Start with the bare network: no city map and no minimap (both can still be switched on). */
  simple?: boolean
}

interface CameraApi {
  zoom: (factor: number) => void
  rotate: (radians: number) => void
  fit: () => void
  panTo: (x: number, z: number) => void
}

const LIFT: Record<CalloutSpec['target'], number> = {
  hv: 1.2, transformer: 2.4, busbar: 1.6, feeder: 2.6, kiosk: 3.0, meter: 1.8, tie: 2.4, flow: 3.4,
}

/** Lives inside <Bounds>: exposes camera actions and reports the ground footprint for the minimap. */
function CameraRig({ api, onFootprint }: { api: RefObject<CameraApi | null>; onFootprint: (f: Vec2[]) => void }) {
  const { camera, controls } = useThree()
  const bounds = useBounds()
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const tick = useRef(0)

  useEffect(() => {
    const orbit = () => controls as unknown as OrbitControlsImpl | null
    api.current = {
      zoom: (f) => {
        const cam = camera as THREE.OrthographicCamera
        cam.zoom = THREE.MathUtils.clamp(cam.zoom * f, 4, 160)
        cam.updateProjectionMatrix()
        orbit()?.update()
      },
      rotate: (rad) => {
        const c = orbit()
        if (!c) return
        const offset = camera.position.clone().sub(c.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), rad)
        camera.position.copy(c.target).add(offset)
        c.update()
      },
      fit: () => { bounds.refresh().clip().fit() },
      panTo: (x, z) => {
        const c = orbit()
        if (!c) return
        const d = new THREE.Vector3(x - c.target.x, 0, z - c.target.z)
        c.target.add(d)
        camera.position.add(d)
        c.update()
      },
    }
  }, [api, bounds, camera, controls])

  useFrame(() => {
    if (++tick.current % 6) return
    const hit = new THREE.Vector3()
    const pts: Vec2[] = []
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ray.setFromCamera(new THREE.Vector2(x, y), camera)
      if (ray.ray.intersectPlane(ground, hit)) pts.push([hit.x, hit.z])
    }
    if (pts.length === 4) onFootprint(pts)
  })
  return null
}

type ScreenMap = Record<string, [number, number]>

/** Projects 3D anchor points to pixel positions so labels can be plain DOM above the canvas. */
function Projector({ points, onProject }: { points: { key: string; p: V3 }[]; onProject: (m: ScreenMap) => void }) {
  const { camera, size } = useThree()
  const last = useRef<ScreenMap>({})
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const next: ScreenMap = {}
    let changed = Object.keys(last.current).length !== points.length
    for (const { key, p } of points) {
      v.set(p[0], p[1], p[2]).project(camera)
      const xy: [number, number] = [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height]
      const prev = last.current[key]
      if (!prev || Math.abs(prev[0] - xy[0]) > 0.05 || Math.abs(prev[1] - xy[1]) > 0.05) changed = true
      next[key] = xy
    }
    if (changed) {
      last.current = next
      onProject(next)
    }
  })
  return null
}

/**
 * DOM labels and callout badges. React decides which ones exist; their screen positions are written straight
 * to the DOM from the render loop, in the same frame as the canvas, so they never lag behind the camera.
 */
function LabelLayer({ subscribe, keys, model, tags, callouts, activeCallout, onCalloutHover, hovered, selected }: {
  subscribe: RefObject<(m: ScreenMap) => void>; keys: Set<string>; model: GridModel; tags: Tags; callouts: CalloutSpec[]
  activeCallout: number | null; onCalloutHover?: (n: number | null) => void; hovered: number | null; selected: number | null
}) {
  const els = useRef(new Map<string, HTMLElement>())
  const last = useRef<ScreenMap>({})
  const place = (el: HTMLElement, xy: [number, number] | undefined) => {
    if (!xy) { el.style.visibility = 'hidden'; return }
    el.style.transform = `translate(${xy[0]}px, ${xy[1]}px)`
    el.style.visibility = ''
  }
  useEffect(() => {
    subscribe.current = (m) => {
      last.current = m
      els.current.forEach((el, key) => place(el, m[key]))
    }
  }, [subscribe])
  // Ref callback: registers an anchor and places it at once, so a new label never flashes at the corner.
  const anchor = (key: string) => (el: HTMLElement | null) => {
    if (!el) { els.current.delete(key); return }
    els.current.set(key, el)
    place(el, last.current[key])
  }
  const at = (key: string) => keys.has(key) && { ref: anchor(key) }
  return (
    <div className="scene-labels">
      {model.substations.map((s) => at(`s${s.id}`) && (
        <div key={s.id} className="scene-tag scene-tag--strong scene-anchor" {...at(`s${s.id}`)}>
          {s.name} · {tags.transformer.get(s.id)} 110/20 kV</div>
      ))}
      {tags.feeders.map((f) => at(`f${f.tag}`) && (
        <div key={f.tag} className="scene-tag scene-tag--equip scene-anchor" {...at(`f${f.tag}`)}>Feeder {f.tag}</div>
      ))}
      {tags.reclosers.map((r) => at(`r${r.tag}`) && (
        <div key={r.tag} className="scene-tag scene-tag--equip scene-anchor" {...at(`r${r.tag}`)}>{r.tag} recloser</div>
      ))}
      {model.devices.map((d) => at(`d${d.id}`) && (
        <div key={d.id} className="scene-tag scene-tag--equip scene-anchor" {...at(`d${d.id}`)}>
          {tags.devices.get(d.id)} · {d.kind === 'capacitor' ? `${d.rating.toFixed(0)} kvar` : `${(d.rating / 1000).toFixed(1)} MW`}</div>
      ))}
      {tags.ties.map((t) => at(`t${t.tag}`) && (
        <div key={t.tag} className="scene-tag scene-tag--equip scene-anchor" {...at(`t${t.tag}`)} style={{ borderColor: t.closed ? '#17a673' : '#d64545' }}>
          {t.tag} · {t.closed ? 'closed' : 'open'}</div>
      ))}
      {model.nodes.map((n) => {
        const props = at(`n${n.id}`)
        if (!props) return null
        const active = n.id === hovered || n.id === selected
        return (
          <div key={n.id} className={`scene-tag scene-anchor${active ? ' scene-tag--active' : ''}`}
            {...props} style={{ zIndex: active ? 3 : 1 }}>
            <span className="scene-dot" style={{ background: voltageColor(n.metered ? n.vm : null) }} />
            {n.name}
            {n.metered && n.vm !== null && <span className="scene-tag__v">{n.vm.toFixed(3)} pu</span>}
          </div>
        )
      })}
      {callouts.map((c) => {
        const props = at(`c${c.n}`)
        return props && (
          <button key={c.n} type="button" className={`callout scene-anchor${activeCallout === c.n ? ' callout--active' : ''}`}
            {...props} aria-label={`Callout ${c.n}`}
            onMouseEnter={() => onCalloutHover?.(c.n)} onMouseLeave={() => onCalloutHover?.(null)}
            onFocus={() => onCalloutHover?.(c.n)} onBlur={() => onCalloutHover?.(null)}>{c.n}</button>
        )
      })}
    </div>
  )
}

export function FullscreenButton({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button onClick={toggle} aria-pressed={on} title={on ? 'Exit fullscreen' : 'Fullscreen'} aria-label="Fullscreen">
      <ToolIcon d={on ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
    </button>
  )
}

function ToolIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  )
}

export function GridScene({
  model, selected = null, onSelect, callouts = [], activeCallout = null, onCalloutHover,
  showLabels = true, autoRotate = false, flow = true, citySeed = 0, children, fullscreen, onContextLost, simple = false, overlay,
}: Props) {
  const api = useRef<CameraApi | null>(null)
  const [spin, setSpin] = useState(autoRotate)
  const [mapOn, setMapOn] = useState(!simple)
  const [layers, setLayers] = useState({ city: !simple, overhead: true, underground: true, equipment: true, devices: true })
  const [layersOpen, setLayersOpen] = useState(false)
  const cityOn = layers.city
  const [footprint, setFootprint] = useState<Vec2[] | null>(null)
  const onFootprint = useCallback((f: Vec2[]) => setFootprint(f), [])
  const [hovered, setHovered] = useState<number | null>(null)
  const pushScreen = useRef<(m: ScreenMap) => void>(() => {})
  const onProject = useCallback((m: ScreenMap) => pushScreen.current(m), [])

  useEffect(() => setSpin(autoRotate), [autoRotate])

  const pos = useMemo(() => layout(model), [model])
  const roots = useMemo(() => new Set(model.substations.map((s) => s.id)), [model])
  const labelsOn = showLabels && model.nodes.length <= 40
  const mountOf = useMemo(() => new Map(model.nodes.map((n) => [n.id, n.mount])), [model])
  /** Street path between two equipment items, with the ends at their cable anchors. */
  const pathOf = useCallback((from: number, to: number, underground = false): V3[] => {
    const pts = route(pos.get(from)!, pos.get(to)!)
    const end = (id: number) => anchorOf(roots.has(id) ? 'substation' : 'node', pos.get(id)!, mountOf.get(id), underground)
    return pts.map((p, i) => (i === 0 ? end(from) : i === pts.length - 1 ? end(to) : [p[0], 0, p[1]] as V3))
  }, [pos, roots, mountOf])
  const solarNodes = useMemo(() => new Set(model.devices.filter((d) => d.kind === 'pv').map((d) => d.node)), [model])
  const city = useMemo(() => buildCity(pos, roots, citySeed, solarNodes), [pos, roots, citySeed, solarNodes])
  const devicesOn = useMemo(() => {
    const m = new Map<string, PoleDevice[]>()
    for (const e of model.equipment) {
      const k = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`
      m.set(k, [...(m.get(k) ?? []), { kind: e.kind, closed: e.closed }])
    }
    return m
  }, [model])
  const devicesFor = (a: number, b: number) => devicesOn.get(a < b ? `${a}-${b}` : `${b}-${a}`) ?? []
  const tags = useMemo(() => equipmentTags(model), [model])

  const zones = useMemo(() => {
    const groups = new Map<number, Vec2[]>()
    for (const n of model.nodes) {
      const f = model.feeder[n.id]
      if (f === undefined) continue
      groups.set(f, [...(groups.get(f) ?? []), pos.get(n.id)!])
    }
    return [...groups.entries()].map(([f, pts]) => {
      const xs = pts.map((p) => p[0])
      const zs = pts.map((p) => p[1])
      const m = 1.8
      return {
        f, bounds: [Math.min(...xs) - m, Math.min(...zs) - m, Math.max(...xs) + m, Math.max(...zs) + m] as
          [number, number, number, number],
      }
    })
  }, [model, pos])

  const calloutAnchor = useMemo(() => {
    const root = model.substations[0]
    const rp = root ? pos.get(root.id)! : ([0, 0] as Vec2)
    const mid = (a: number, b: number): V3 => {
      const pts = route(pos.get(a)!, pos.get(b)!)
      const [x, z] = pts.length === 3 ? pts[1] : [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
      return [x, 2.4, z]
    }
    const used: Vec2[] = [rp]
    const far = (p: Vec2) => Math.min(...used.map((u) => Math.hypot(u[0] - p[0], u[1] - p[1])))
    /** Pick the candidate farthest from callouts already placed, so badges never stack. */
    const pick = <T,>(items: T[], at: (t: T) => Vec2): T | undefined => {
      let best: T | undefined
      let score = -1
      for (const it of items) {
        const s = far(at(it))
        if (s > score) { score = s; best = it }
      }
      if (best !== undefined) used.push(at(best))
      return best
    }
    const tie = model.ties[0]
    if (tie) used.push(mid(tie.a, tie.b).filter((_, i) => i !== 1) as Vec2)
    const inner = model.edges.filter((e) => !roots.has(e.from))
    const edgeAt = (e: { from: number; to: number }) => mid(e.from, e.to).filter((_, i) => i !== 1) as Vec2
    const feederEdge = pick(inner.slice(0, Math.ceil(inner.length / 3)), edgeAt)
    const meterNode = pick(model.nodes.filter((n) => n.metered && n.vm !== null), (n) => pos.get(n.id)!)
    const node = pick(model.nodes, (n) => pos.get(n.id)!)
    const flowEdge = pick(inner, edgeAt)
    const map: Record<CalloutSpec['target'], V3 | null> = {
      hv: [rp[0] - 11, 7.8, rp[1]],
      transformer: [rp[0] - 0.7, 2.3, rp[1] + 0.7],
      busbar: [rp[0] + 1.95, 1.45, rp[1] + 1.6],
      feeder: feederEdge ? mid(feederEdge.from, feederEdge.to) : null,
      kiosk: node ? [pos.get(node.id)![0], 1.2, pos.get(node.id)![1]] : null,
      meter: meterNode ? [pos.get(meterNode.id)![0] + 0.42, 1.6, pos.get(meterNode.id)![1] + 0.32] : null,
      tie: tie ? mid(tie.a, tie.b) : null,
      flow: flowEdge ? mid(flowEdge.from, flowEdge.to) : null,
    }
    return map
  }, [model, pos, roots])

  const labelPoints = useMemo(() => {
    const pts: { key: string; p: V3 }[] = []
    for (const c of callouts) {
      const a = calloutAnchor[c.target]
      if (a) pts.push({ key: `c${c.n}`, p: [a[0], a[1] + LIFT[c.target], a[2]] })
    }
    if (showLabels) {
      for (const f of tags.feeders) {
        const pts2 = route(pos.get(f.root)!, pos.get(f.head)!)
        const [x, z] = pts2.length === 3 ? pts2[1] : pos.get(f.head)!
        pts.push({ key: `f${f.tag}`, p: [x, 3.4, z] })
      }
      for (const t2 of tags.ties) {
        const pts2 = route(pos.get(t2.a)!, pos.get(t2.b)!)
        const [x, z] = pts2.length === 3 ? pts2[1] : [(pts2[0][0] + pts2[1][0]) / 2, (pts2[0][1] + pts2[1][1]) / 2]
        pts.push({ key: `t${t2.tag}`, p: [x, 3.2, z] })
      }
      for (const s of model.substations) {
        const [x, z] = pos.get(s.id)!
        pts.push({ key: `s${s.id}`, p: [x, 4.4, z] })
      }
      if (layers.equipment) for (const r of tags.reclosers) {
        const pts2 = route(pos.get(r.a)!, pos.get(r.b)!)
        const [x, z] = pts2.length === 3 ? pts2[1] : [(pts2[0][0] + pts2[1][0]) / 2, (pts2[0][1] + pts2[1][1]) / 2]
        pts.push({ key: `r${r.tag}`, p: [x, 3.0, z] })
      }
      if (layers.devices) for (const d of model.devices) {
        if (!pos.has(d.node)) continue
        const [x, z] = pos.get(d.node)!
        pts.push({ key: `d${d.id}`, p: d.kind === 'capacitor' ? [x + 1.15, 2.7, z - 1.15] : [x + 2.6, 1.2, z + 2.0] })
      }
    }
    for (const n of model.nodes) {
      if (labelsOn || n.id === hovered || n.id === selected) {
        const [x, z] = pos.get(n.id)!
        pts.push({ key: `n${n.id}`, p: [x, 2.1, z] })
      }
    }
    return pts
  }, [callouts, calloutAnchor, showLabels, model, pos, labelsOn, hovered, selected, tags, layers])
  const labelKeys = useMemo(() => new Set(labelPoints.map((l) => l.key)), [labelPoints])

  return (
    <div className="scene-shell">
      <Canvas flat shadows dpr={[1, 2]} onPointerMissed={() => onSelect?.(null)}
        style={{ background: palette.backdrop }} gl={{ antialias: true }}
        onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost?.() })}>
        <OrthographicCamera makeDefault position={[40, 42, 40]} zoom={18} near={-500} far={1000} />
        <OrbitControls makeDefault enableDamping autoRotate={spin} autoRotateSpeed={0.35}
          minPolarAngle={0.35} maxPolarAngle={1.25} minZoom={4} maxZoom={160} enablePan />
        <ambientLight intensity={0.9} />
        <hemisphereLight args={['#ffffff', '#cfd6de', 0.5]} />
        <directionalLight position={[30, 50, 20]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-110} shadow-camera-right={110} shadow-camera-top={110} shadow-camera-bottom={-110}
          shadow-bias={-0.0004} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
          <planeGeometry args={[600, 600]} />
          <meshStandardMaterial color={palette.ground} />
        </mesh>
        <Grid infiniteGrid cellSize={1} sectionSize={5} cellColor={palette.grid} sectionColor="#d3dae2"
          cellThickness={0.5} sectionThickness={0.8} fadeDistance={160} fadeStrength={1.5} position={[0, 0.001, 0]} />

        <Bounds fit observe margin={simple ? 1.25 : 0.92} maxDuration={0.6}>
          <CameraRig api={api} onFootprint={onFootprint} />
          <group>
            {cityOn ? <><GroundModel parts={city.parts} /><StreetLabels labels={city.streets} /></>
              : zones.map((z) => <Zone key={z.f} bounds={z.bounds} color={palette.zones[z.f % palette.zones.length]} />)}
            {model.substations.map((s) => (
              <Substation key={s.id} position={pos.get(s.id)!} flow={flow} />
            ))}
            {model.edges.map((e) => e.kind === 'underground'
              ? layers.underground && <UndergroundRun key={`${e.from}-${e.to}`} path={pathOf(e.from, e.to, true)} flow={flow}
                  devices={devicesFor(e.from, e.to)} showDevices={layers.equipment} />
              : layers.overhead && <CableRun key={`${e.from}-${e.to}`} path={pathOf(e.from, e.to)} flow={flow}
                  devices={devicesFor(e.from, e.to)} showDevices={layers.equipment} />)}
            {model.ties.map((t) => (t.kind === 'underground' ? layers.underground : layers.overhead) && (
              <TieSwitch key={`t${t.a}-${t.b}`} path={pathOf(t.a, t.b, t.kind === 'underground')} closed={t.closed} kind={t.kind} />
            ))}
            {layers.devices && model.devices.map((d) => pos.has(d.node) && (d.kind === 'capacitor'
              ? <CapacitorBank key={d.id} position={pos.get(d.node)!} />
              : <SolarFarm key={d.id} position={pos.get(d.node)!} width={PX - KOFF - 1.6} depth={PZ - KOFF - 1.5} />))}
            {model.nodes.map((n) => (
              <Kiosk key={n.id} position={pos.get(n.id)!} mount={n.mount} metered={n.metered} vm={n.vm} selected={selected === n.id}
                onHover={(on) => setHovered((h) => (on ? n.id : h === n.id ? null : h))}
                onSelect={onSelect ? () => onSelect(n.id) : undefined} />
            ))}
          </group>
        {overlay && <HypothesisLayer overlay={overlay} pos={pos} />}
        </Bounds>

        {callouts.map((c) => {
          const a = calloutAnchor[c.target]
          return a && <CalloutLeader key={c.n} anchor={a} lift={LIFT[c.target]} active={activeCallout === c.n} />
        })}
        <Projector points={labelPoints} onProject={onProject} />
      </Canvas>

      <LabelLayer subscribe={pushScreen} keys={labelKeys} model={model} tags={tags} callouts={callouts} activeCallout={activeCallout}
        onCalloutHover={onCalloutHover} hovered={hovered} selected={selected} />

      <div className="scene-controls" role="toolbar" aria-label="3D view controls">
        <button onClick={() => api.current?.zoom(1.25)} title="Zoom in" aria-label="Zoom in"><ToolIcon d="M12 5v14M5 12h14" /></button>
        <button onClick={() => api.current?.zoom(0.8)} title="Zoom out" aria-label="Zoom out"><ToolIcon d="M5 12h14" /></button>
        <span className="scene-controls__sep" />
        <button onClick={() => api.current?.rotate(Math.PI / 8)} title="Rotate left" aria-label="Rotate left"><ToolIcon d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></button>
        <button onClick={() => api.current?.rotate(-Math.PI / 8)} title="Rotate right" aria-label="Rotate right"><ToolIcon d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" /></button>
        <button onClick={() => setSpin((s) => !s)} aria-pressed={spin} title={spin ? 'Stop auto-rotate' : 'Auto-rotate'}
          aria-label="Auto-rotate"><ToolIcon d={spin ? 'M9 6v12M15 6v12' : 'M7 5l12 7-12 7V5Z'} /></button>
        <span className="scene-controls__sep" />
        <button onClick={() => api.current?.fit()} title="Fit to view" aria-label="Fit to view"><ToolIcon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></button>
        <button onClick={() => setLayersOpen((o) => !o)} aria-pressed={layersOpen} aria-expanded={layersOpen} title="Layers"
          aria-label="Layers"><ToolIcon d="M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5" /></button>
        <button onClick={() => setMapOn((m) => !m)} aria-pressed={mapOn} title={mapOn ? 'Hide minimap' : 'Show minimap'}
          aria-label="Minimap"><ToolIcon d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" /></button>
        {fullscreen && <FullscreenButton {...fullscreen} />}
      </div>

      {layersOpen && (
        <div className="layers-panel card" role="group" aria-label="Layers">
          <b>Layers</b>
          {([
            ['city', 'City map', 'Streets, blocks and buildings'],
            ['overhead', 'Overhead lines', 'Conductors on poles'],
            ['underground', 'Underground cables', 'XLPE cables under the street'],
            ['equipment', 'Switching & protection', 'Reclosers, sectionalizers, fuses'],
            ['devices', 'Capacitors & solar', 'Reactive compensation and PV plants'],
          ] as const).map(([key, label, hint]) => (
            <label key={key} className="layer-row">
              <input type="checkbox" checked={layers[key]} onChange={() => setLayers((l) => ({ ...l, [key]: !l[key] }))} />
              <span><b>{label}</b><small>{hint}</small></span>
              <i className={`layer-swatch layer-swatch--${key}`} />
            </label>
          ))}
        </div>
      )}
      {mapOn && <Minimap model={model} pos={pos} footprint={footprint} onNavigate={(x, z) => api.current?.panTo(x, z)} />}
      {children}
    </div>
  )
}
