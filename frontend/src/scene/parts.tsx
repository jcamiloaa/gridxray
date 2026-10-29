import { Line, QuadraticBezierLine, RoundedBox } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef, useState, type ComponentRef } from 'react'
import * as THREE from 'three'
import { buildSolarArray, MATS, model, PHASE_SPREAD, POLE_H, towerConductors, type MatKey, type Parts } from './models'
import { palette, voltageColor } from './palette'

export type V3 = [number, number, number]

const POLE_EVERY = 3.6
const TOWER_OFFSET = 11

/** Renders a merged model: one mesh per material. */
export function Model({ parts, position, rotationY = 0 }: { parts: Parts; position: V3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {(Object.entries(parts) as [MatKey, THREE.BufferGeometry][]).map(([mat, geometry]) => (
        <mesh key={mat} geometry={geometry} material={MATS[mat]} castShadow receiveShadow />
      ))}
    </group>
  )
}

/** A sagging conductor between two points. */
function Span({ a, b, color = palette.cable, width = 0.9, dashed = false }: {
  a: V3; b: V3; color?: string; width?: number; dashed?: boolean
}) {
  const len = Math.hypot(b[0] - a[0], b[2] - a[2])
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - len * 0.05, (a[2] + b[2]) / 2]
  return (
    <QuadraticBezierLine start={a} end={b} mid={mid} color={color} lineWidth={width}
      dashed={dashed} dashSize={0.25} gapSize={0.2} />
  )
}

/** Energy flowing along a span: fine orange dashes marching from a to b. */
function FlowSpan({ a, b, speed = 0.7 }: { a: V3; b: V3; speed?: number }) {
  const ref = useRef<ComponentRef<typeof QuadraticBezierLine>>(null)
  useFrame((_, dt) => {
    const m = ref.current?.material as unknown as { dashOffset: number } | undefined
    if (m) m.dashOffset -= dt * speed
  })
  const len = Math.hypot(b[0] - a[0], b[2] - a[2])
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - len * 0.05 + 0.015, (a[2] + b[2]) / 2]
  return (
    <QuadraticBezierLine ref={ref} start={a} end={b} mid={mid} color={palette.flow} lineWidth={1.6}
      dashed dashSize={0.16} gapSize={0.5} transparent opacity={0.9} />
  )
}

/* ---------- equipment ---------- */

/** HV/MV substation with the transmission tower that feeds it. Feeders leave along +x. */
export function Substation({ position, flow, name }: { position: [number, number]; flow: boolean; name?: string }) {
  const [x, z] = position
  const tower = model('tower')
  const gantry: V3[] = [-0.8, 0, 0.8].map((dz) => [x - 2.9, 2.95, z + dz] as V3)
  const towerPts = towerConductors().slice(0, 6).filter((_, i) => i % 2 === 1).slice(0, 3)
    .map(([tx, ty, tz]) => [x - TOWER_OFFSET + tx, ty, z + tz * 0.55] as V3)
  return (
    <group>
      <Model parts={model('substation')} position={[x, 0, z]} />
      {name && <Nameplate name={name} position={[x + 1.2, 0.85, z + 2.78]} size={[1.9, 0.5]} posts />}
      <Model parts={tower} position={[x - TOWER_OFFSET, 0, z]} />
      {/* line from beyond the scene to the tower, then down to the gantry */}
      {towerPts.map((p, i) => (
        <group key={i}>
          <Span a={[p[0] - 9, p[1] + 0.6, p[2]]} b={p} width={0.8} />
          <Span a={p} b={gantry[i]} width={0.9} />
          {flow && i === 1 && <><FlowSpan a={[p[0] - 9, p[1] + 0.6, p[2]]} b={p} /><FlowSpan a={p} b={gantry[i]} /></>}
        </group>
      ))}
      {/* gantry -> transformer HV bushings -> switchgear busbar */}
      {gantry.map((g, i) => {
        const hv: V3 = [x - 0.85, 2.15, z + (i - 1) * 0.4]
        return (
          <group key={i}>
            <Span a={g} b={hv} width={0.9} />
            <Span a={[x - 0.25, 1.82, z + (i - 1) * 0.35]} b={[x + 1.95, 1.53, z + (i - 1) * 0.6]} width={0.9} />
          </group>
        )
      })}
      {flow && <FlowSpan a={gantry[1]} b={[x - 0.85, 2.15, z]} />}
      {flow && <FlowSpan a={[x - 0.25, 1.82, z]} b={[x + 1.95, 1.53, z]} />}
    </group>
  )
}

const plates = new Map<string, THREE.CanvasTexture>()

/** Enamel nameplate texture (white plate, dark rim, bold tag), drawn once per name. */
function plateTexture(name: string): THREE.CanvasTexture {
  let tex = plates.get(name)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = 320
  c.height = 96
  const g = c.getContext('2d')!
  g.fillStyle = '#1f2a37'
  g.beginPath(); g.roundRect(0, 0, 320, 96, 14); g.fill()
  g.fillStyle = '#f7f9fb'
  g.beginPath(); g.roundRect(7, 7, 306, 82, 9); g.fill()
  for (const [x, y] of [[20, 20], [300, 20], [20, 76], [300, 76]]) { // rivets
    g.fillStyle = '#9aa5b1'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill()
  }
  g.fillStyle = '#1f2a37'
  let px = 58 // shrink long tags to fit the plate
  do g.font = `800 ${px--}px Inter, system-ui, sans-serif`; while (g.measureText(name).width > 280 && px > 20)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(name, 160, 51)
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  plates.set(name, tex)
  return tex
}

/** An equipment nameplate, as a utility mounts it: plate with a dark rim, optionally on two posts. */
export function Nameplate({ name, position, size, posts = false, rotationY = 0 }: {
  name: string; position: V3; size: [number, number]; posts?: boolean; rotationY?: number
}) {
  const map = useMemo(() => plateTexture(name), [name])
  const [w, h] = size
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {posts && [-w * 0.38, w * 0.38].map((x) => (
        <mesh key={x} position={[x, -position[1] / 2, -0.02]}>
          <boxGeometry args={[0.04, position[1], 0.04]} />
          <meshStandardMaterial color="#5d6875" />
        </mesh>
      ))}
      <mesh position={[0, 0, -0.012]}>
        <boxGeometry args={[w + 0.03, h + 0.03, 0.02]} />
        <meshStandardMaterial color="#1f2a37" />
      </mesh>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={map} roughness={0.5} />
      </mesh>
    </group>
  )
}

/** Kiosk nameplate on two short brackets along the front roof edge. */
function KioskPlate({ name }: { name: string }) {
  return (
    <group>
      {[-0.45, 0.45].map((x) => (
        <mesh key={x} position={[x, 1.26, 0.48]}>
          <boxGeometry args={[0.04, 0.2, 0.04]} />
          <meshStandardMaterial color="#5d6875" />
        </mesh>
      ))}
      <Nameplate name={name} position={[0, 1.42, 0.5]} size={[1.2, 0.36]} />
    </group>
  )
}

/** MV/LV secondary substation (kiosk) with a smart-meter status light. */
export function Kiosk({ position, mount = 'kiosk', metered, vm, selected, onHover, onSelect, name }: {
  position: [number, number]; mount?: 'kiosk' | 'pole'; metered: boolean; vm: number | null; name?: string
  selected: boolean; onHover: (on: boolean) => void; onSelect?: () => void
}) {
  const [x, z] = position
  const [hover, setHover] = useState(false)
  const light = useRef<THREE.Mesh>(null)
  const color = voltageColor(metered ? vm : null)
  useFrame(({ clock }) => {
    if (light.current && metered && vm !== null) {
      const m = light.current.material as THREE.MeshStandardMaterial
      m.emissiveIntensity = 0.6 + Math.sin(clock.elapsedTime * 2.6 + x * 0.7) * 0.3
    }
  })
  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover(true)
    onHover(true)
    document.body.style.cursor = onSelect ? 'pointer' : 'default'
  }
  const out = () => {
    setHover(false)
    onHover(false)
    document.body.style.cursor = 'default'
  }
  return (
    <group position={[x, 0, z]} onPointerOver={over} onPointerOut={out}
      onClick={(e) => { e.stopPropagation(); onSelect?.() }}>
      {(selected || hover) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[1.0, selected ? 1.22 : 1.12, 48]} />
          <meshBasicMaterial color={palette.accent} transparent opacity={selected ? 1 : 0.5} />
        </mesh>
      )}
      {name && (mount === 'pole'
        ? <Nameplate name={name} position={[0, 1.0, 0.1]} size={[0.62, 0.19]} />
        : <KioskPlate name={name} />)}
      {mount === 'pole' ? (
        <>
          <Model parts={model('poleTransformer')} position={[0, 0, 0]} />
          <mesh position={[0.14, 0.75, 0.12]} castShadow>
            <boxGeometry args={[0.12, 0.26, 0.16]} />
            <meshStandardMaterial color={metered ? '#eef1f4' : '#c3cad2'} />
          </mesh>
          <mesh ref={light} position={[0.32, 1.78, 0.22]}>
            <sphereGeometry args={[metered ? 0.1 : 0.06, 18, 12]} />
            <meshStandardMaterial color={metered ? color : '#b5bdc6'} emissive={metered ? color : '#000'}
              emissiveIntensity={metered && vm !== null ? 0.7 : 0} />
          </mesh>
        </>
      ) : (
        <>
          <Model parts={model('kiosk')} position={[0, 0, 0]} />
          {/* meter cabinet on the +x wall, with its reading as a coloured LED */}
          <mesh position={[0.69, 0.42, -0.25]} castShadow>
            <boxGeometry args={[0.08, 0.3, 0.22]} />
            <meshStandardMaterial color={metered ? '#eef1f4' : '#c3cad2'} />
          </mesh>
          {/* roof status light: visible from afar */}
          <mesh ref={light} position={[0.5, 1.3, 0.4]}>
            <sphereGeometry args={[metered ? 0.13 : 0.07, 20, 14]} />
            <meshStandardMaterial color={metered ? color : '#b5bdc6'} emissive={metered ? color : '#000'}
              emissiveIntensity={metered && vm !== null ? 0.7 : 0} />
          </mesh>
          {metered && (
            <mesh position={[0.735, 0.47, -0.25]}>
              <boxGeometry args={[0.012, 0.07, 0.1]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
            </mesh>
          )}
        </>
      )}
    </group>
  )
}

interface Station { x: number; z: number; rot: number; px: number; pz: number }

/** Pole stations along a street path: interior poles every POLE_EVERY plus one at each corner. */
function stations(path: V3[]): Station[] {
  const out: Station[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    const rot = Math.atan2(dx, dz) + Math.PI / 2 // crossarm (local z) perpendicular to the line
    const px = (dz / len) * PHASE_SPREAD
    const pz = (-dx / len) * PHASE_SPREAD
    const n = Math.max(i === 0 && path.length === 2 ? 1 : 0, Math.floor(len / POLE_EVERY))
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1)
      out.push({ x: a[0] + dx * t, z: a[2] + dz * t, rot, px, pz })
    }
    if (i < path.length - 2) out.push({ x: b[0], z: b[2], rot, px, pz }) // corner pole
  }
  return out
}

/** Three-phase overhead MV line following the streets, with concrete poles along the way. */
export type PoleDevice = { kind: 'recloser' | 'sectionalizer' | 'fuse'; closed: boolean }
const DEVICE_MODEL = { recloser: 'recloser', sectionalizer: 'sectionalizer', fuse: 'fusePole' } as const

export function CableRun({ path, flow, color, dashed = false, devices = [], showDevices = true }: {
  path: V3[]; flow: boolean; color?: string; dashed?: boolean; devices?: PoleDevice[]; showDevices?: boolean
}) {
  const { phases, poles } = useMemo(() => {
    const poles = stations(path)
    const a = path[0]
    const b = path[path.length - 1]
    const phases: V3[][] = [0, 1, 2].map((k) => [
      a, ...poles.map((s) => [s.x + (k - 1) * s.px, POLE_H + 0.06, s.z + (k - 1) * s.pz] as V3), b,
    ])
    return { phases, poles }
  }, [path])
  const pole = model('pole')
  // fuses sit at the first pole of a lateral; reclosers and sectionalizers halfway along
  const at = new Map<number, PoleDevice>()
  for (const d of showDevices ? devices : []) at.set(d.kind === 'fuse' ? 0 : Math.floor(poles.length / 2), d)
  return (
    <group>
      {poles.map((p, i) => {
        const dev = at.get(i)
        return (
          <group key={i}>
            <Model parts={dev ? model(DEVICE_MODEL[dev.kind]) : pole} position={[p.x, 0, p.z]} rotationY={p.rot} />
            {dev && dev.kind !== 'fuse' && (
              <mesh position={[p.x, 1.6, p.z]}>
                <sphereGeometry args={[0.07, 12, 10]} />
                <meshStandardMaterial color={dev.closed ? '#17a673' : '#d64545'} emissive={dev.closed ? '#17a673' : '#d64545'} emissiveIntensity={0.7} />
              </mesh>
            )}
          </group>
        )
      })}
      {phases.map((pts, k) => pts.slice(1).map((p, i) => <Span key={`${k}-${i}`} a={pts[i]} b={p} color={color} dashed={dashed} />))}
      {flow && phases[1].slice(1).map((p, i) => <FlowSpan key={`f${i}`} a={phases[1][i]} b={p} />)}
    </group>
  )
}

/** Tie switch between two feeders on a pole-mounted cabinet: open (red, dashed) or closed (green). */
export function TieSwitch({ path, closed, kind = 'overhead' }: { path: V3[]; closed: boolean; kind?: 'overhead' | 'underground' }) {
  if (kind === 'underground') return <UndergroundRun path={path} flow={false} open={!closed} devices={[{ kind: 'sectionalizer', closed }]} />
  // place the switch pole at the middle of the path by length
  const legs = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[2] - path[i][2]))
  let half = legs.reduce((s, l) => s + l, 0) / 2
  let m: V3 = path[0]
  let rot = 0
  for (let i = 0; i < legs.length; i++) {
    const [a, b] = [path[i], path[i + 1]]
    if (half <= legs[i]) {
      const t = half / legs[i]
      m = [a[0] + (b[0] - a[0]) * t, POLE_H + 0.06, a[2] + (b[2] - a[2]) * t]
      rot = Math.atan2(b[0] - a[0], b[2] - a[2]) + Math.PI / 2
      break
    }
    half -= legs[i]
  }
  const color = closed ? '#17a673' : '#d64545'
  return (
    <group>
      <Model parts={model('switchPole')} position={[m[0], 0, m[2]]} rotationY={rot} />
      <mesh position={[m[0], 1.5, m[2]]}>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
      </mesh>
      <CableRun path={path} flow={false} color={closed ? palette.cable : '#a5aeb8'} dashed={!closed} />
    </group>
  )
}

/** Underground XLPE cable along the street: a marked trench line with marker posts and ground cabinets. */
export function UndergroundRun({ path, flow, open = false, devices = [], showDevices = true }: {
  path: V3[]; flow: boolean; open?: boolean; devices?: PoleDevice[]; showDevices?: boolean
}) {
  const pts = useMemo(() => path.map((p) => [p[0], 0.075, p[2]] as V3), [path])
  const ref = useRef<ComponentRef<typeof Line>>(null)
  useFrame((_, dt) => {
    const m = ref.current?.material as unknown as { dashOffset: number } | undefined
    if (m) m.dashOffset -= dt * 0.7
  })
  const { markers, mid } = useMemo(() => {
    const markers: { x: number; z: number }[] = []
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[2] - pts[i][2]))
    const total = lens.reduce((s, l) => s + l, 0)
    let mid = { x: pts[0][0], z: pts[0][2], rot: 0 }
    let acc = 0
    pts.slice(1).forEach((b, i) => {
      const a = pts[i]
      const len = lens[i]
      const rot = Math.atan2(b[0] - a[0], b[2] - a[2])
      for (let s = 2; s < len - 1; s += 3.2) {
        const t = s / len
        markers.push({ x: a[0] + (b[0] - a[0]) * t + Math.cos(rot) * 0.28, z: a[2] + (b[2] - a[2]) * t - Math.sin(rot) * 0.28 })
      }
      if (acc <= total / 2 && acc + len >= total / 2) {
        const t = (total / 2 - acc) / len
        mid = { x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t, rot }
      }
      acc += len
    })
    return { markers, mid }
  }, [pts])
  const marker = model('cableMarker')
  return (
    <group>
      <Line points={pts} color={open ? '#a99bc4' : '#6c4fa3'} lineWidth={2.4} dashed={open} dashSize={0.3} gapSize={0.25} />
      {flow && <Line ref={ref} points={pts.map((p) => [p[0], p[1] + 0.01, p[2]] as V3)} color={palette.flow}
        lineWidth={1.6} dashed dashSize={0.16} gapSize={0.5} transparent opacity={0.9} />}
      {markers.map((m, i) => <Model key={i} parts={marker} position={[m.x, 0, m.z]} />)}
      {showDevices && devices.length > 0 && (
        <group>
          <Model parts={model('groundCabinet')} position={[mid.x + Math.cos(mid.rot) * 0.75, 0, mid.z - Math.sin(mid.rot) * 0.75]} rotationY={mid.rot} />
          <mesh position={[mid.x + Math.cos(mid.rot) * 0.75, 1.0, mid.z - Math.sin(mid.rot) * 0.75]}>
            <sphereGeometry args={[0.07, 12, 10]} />
            <meshStandardMaterial color={devices[0].closed ? '#17a673' : '#d64545'} emissive={devices[0].closed ? '#17a673' : '#d64545'} emissiveIntensity={0.7} />
          </mesh>
        </group>
      )}
    </group>
  )
}

/** Pole-mounted capacitor bank next to the secondary substation it compensates. */
export function CapacitorBank({ position, name }: { position: [number, number]; name?: string }) {
  const [x, z] = [position[0] + 1.15, position[1] - 1.15]
  return (
    <group>
      <Model parts={model('capacitorBank')} position={[x, 0, z]} rotationY={Math.PI / 4} />
      {name && <Nameplate name={name} position={[x, 1.0, z + 0.1]} size={[0.66, 0.2]} />}
    </group>
  )
}

/** Ground-mounted PV plant filling the block behind the secondary substation it connects to. */
export function SolarFarm({ position, width, depth, name }: { position: [number, number]; width: number; depth: number; name?: string }) {
  const parts = useMemo(() => buildSolarArray(width, depth), [width, depth])
  return (
    <group>
      <Model parts={parts} position={[position[0] + 1.0, 0.06, position[1] + 1.0]} />
      {name && <Nameplate name={name} position={[position[0] + 1.6, 0.55, position[1] + depth + 1.15]} size={[0.9, 0.27]} posts />}
    </group>
  )
}

/** Ground layer built from merged geometry (used for the city map). */
export function GroundModel({ parts }: { parts: Parts }) {
  return (
    <group>
      {(Object.entries(parts) as [MatKey, THREE.BufferGeometry][]).map(([mat, geometry]) => (
        <mesh key={mat} geometry={geometry} material={MATS[mat]} receiveShadow castShadow={mat.startsWith('building') || mat === 'warehouse' || mat === 'crown'} />
      ))}
    </group>
  )
}

/** Pastel ground area under a feeder. */
export function Zone({ bounds, color }: { bounds: [number, number, number, number]; color: string }) {
  const [x0, z0, x1, z1] = bounds
  return (
    <RoundedBox args={[x1 - x0, 0.02, z1 - z0]} radius={0.01} position={[(x0 + x1) / 2, 0.012, (z0 + z1) / 2]}
      receiveShadow>
      <meshStandardMaterial color={color} transparent opacity={0.75} />
    </RoundedBox>
  )
}

/** Leader line for a numbered callout; the badge itself is DOM, positioned by the scene. */
export function CalloutLeader({ anchor, lift, active }: { anchor: V3; lift: number; active: boolean }) {
  return <Line points={[anchor, [anchor[0], anchor[1] + lift, anchor[2]]]} color={active ? palette.flow : palette.accent} lineWidth={1.2} />
}
