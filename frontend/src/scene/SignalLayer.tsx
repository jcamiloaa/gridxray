import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useI18n } from '../i18n'
import { Nameplate } from './parts'
import { hubAt } from './crewPath'
import type { Vec2 } from './layout'
import type { Overlay } from './model'

const ANTENNA_Y = 4.6
const PERIOD = 4.5 // seconds: order goes out, the node reacts, the meters answer back
const BACK = 6 // meters whose answer is drawn

/** Control center: the office where the AI agents work, with a radio mast for the orders. */
function ControlCenter({ at }: { at: Vec2 }) {
  const { t } = useI18n()
  const beacon = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (beacon.current) (beacon.current.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(clock.elapsedTime * 4) > 0 ? 2 : 0.3
  })
  return (
    <group position={[at[0], 0, at[1]]}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[3.4, 2.2, 2.4]} />
        <meshStandardMaterial color="#e9edf1" />
      </mesh>
      {[-1.05, 0, 1.05].map((x) => ( // lit windows: people at work
        <mesh key={x} position={[x, 1.25, 1.21]}>
          <planeGeometry args={[0.8, 0.9]} />
          <meshStandardMaterial color="#9fd3ec" emissive="#6fc3e8" emissiveIntensity={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 2.25, 0]}><boxGeometry args={[3.6, 0.1, 2.6]} /><meshStandardMaterial color="#4a5563" /></mesh>
      <mesh position={[1.1, 3.4, -0.6]}><cylinderGeometry args={[0.04, 0.06, 2.3, 8]} /><meshStandardMaterial color="#8b96a3" /></mesh>
      <mesh ref={beacon} position={[1.1, ANTENNA_Y, -0.6]}>
        <sphereGeometry args={[0.12, 12, 8]} />
        <meshStandardMaterial color="#ff5b5b" emissive="#ff3030" emissiveIntensity={1} />
      </mesh>
      <Nameplate name={t('Control center')} position={[0, 0.55, 1.25]} size={[2.2, 0.5]} />
    </group>
  )
}

function curve(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = a.clone().lerp(b, 0.5)
  mid.y = Math.max(a.y, b.y) + a.distanceTo(b) * 0.28
  return new THREE.QuadraticBezierCurve3(a, mid, b)
}

/**
 * An experiment as signals: the order flies from the control center to the substation where the load
 * step is applied, the substation flashes, then every meter's answer flies back, larger where the
 * voltage dropped more.
 */
function Experiment({ focus, hub, pos }: { focus: NonNullable<Overlay['focus']>; hub: Vec2; pos: Map<number, Vec2> }) {
  const target = pos.get(focus.node)!
  const from = useMemo(() => new THREE.Vector3(hub[0] + 1.1, ANTENNA_Y, hub[1] - 0.6), [hub])
  const out = useMemo(() => curve(from, new THREE.Vector3(target[0], 1.8, target[1])), [from, target])
  const answers = useMemo(() => {
    const top = Object.entries(focus.drops).map(([k, v]) => [Number(k), v] as const)
      .filter(([n]) => n !== focus.node && pos.has(n)).sort((a, b) => b[1] - a[1]).slice(0, BACK)
    const max = Math.max(1e-9, ...top.map(([, v]) => v))
    return top.map(([n, v]) => ({ n, k: v / max, c: curve(new THREE.Vector3(pos.get(n)![0], 1.6, pos.get(n)![1]), from) }))
  }, [focus, pos, from])
  const order = useRef<THREE.Mesh>(null)
  const flash = useRef<THREE.Mesh>(null)
  const back = useRef<(THREE.Mesh | null)[]>([])
  const t0 = useRef<number | null>(null)
  useFrame(({ clock }) => {
    if (t0.current === null) t0.current = clock.elapsedTime
    const ph = ((clock.elapsedTime - t0.current) % PERIOD) / PERIOD
    if (order.current) {
      const k = Math.min(1, ph / 0.3)
      order.current.visible = ph < 0.3
      order.current.position.copy(out.getPoint(k))
    }
    if (flash.current) {
      const k = (ph - 0.3) / 0.12
      flash.current.visible = k >= 0 && k <= 1
      flash.current.scale.setScalar(0.5 + k * 2.5)
      ;(flash.current.material as THREE.MeshBasicMaterial).opacity = 1 - Math.max(0, k)
    }
    back.current.forEach((m, i) => {
      if (!m) return
      const k = (ph - 0.42 - i * 0.03) / 0.4
      m.visible = k >= 0 && k <= 1
      if (m.visible) m.position.copy(answers[i].c.getPoint(k))
    })
  })
  return (
    <group>
      <Line points={out.getPoints(32)} color="#f26b1d" lineWidth={1.6} dashed dashSize={0.35} gapSize={0.25} transparent opacity={0.7} />
      <mesh ref={order}><sphereGeometry args={[0.22, 14, 10]} /><meshBasicMaterial color="#f26b1d" /></mesh>
      <mesh ref={flash} position={[target[0], 0.08, target[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.9, 40]} />
        <meshBasicMaterial color="#f26b1d" transparent depthWrite={false} />
      </mesh>
      {answers.map((a, i) => (
        <group key={a.n}>
          <Line points={a.c.getPoints(24)} color="#0e6e8c" lineWidth={0.6 + a.k * 1.8} transparent opacity={0.25 + a.k * 0.4} />
          <mesh ref={(m) => { back.current[i] = m }} visible={false}>
            <sphereGeometry args={[0.08 + a.k * 0.14, 10, 8]} />
            <meshBasicMaterial color="#0e6e8c" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export function SignalLayer({ overlay, pos }: { overlay: Overlay; pos: Map<number, Vec2> }) {
  const sub = overlay.hub !== undefined ? pos.get(overlay.hub) : undefined
  if (!sub) return null
  const hub = hubAt(sub)
  return (
    <group>
      <ControlCenter at={hub} />
      {overlay.focus && pos.has(overlay.focus.node) && <Experiment key={overlay.focus.id ?? overlay.focus.node} focus={overlay.focus} hub={hub} pos={pos} />}
    </group>
  )
}
