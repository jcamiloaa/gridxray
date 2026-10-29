import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useI18n } from '../i18n'
import type { Vec2 } from './layout'
import type { Overlay } from './model'

type Incident = NonNullable<Overlay['incidents']>[number]
const PUFFS = 9
const SPARKS = 14
const FLASH_SECONDS = 3.5 // electric arc and sparks right after the event

/**
 * What you did in the field, made visible: a switching operation arcs and throws sparks at the switch;
 * a meter that goes offline sparks, then keeps smoking with a red fault light.
 */
function IncidentFx({ incident, at }: { incident: Incident; at: Vec2 }) {
  const { t } = useI18n()
  const t0 = useRef<number | null>(null)
  const puffs = useRef<(THREE.Mesh | null)[]>([])
  const sparks = useRef<(THREE.Mesh | null)[]>([])
  const arc = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const fault = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const meter = incident.kind === 'meter'
  // fixed random directions per spark, so the burst looks the same on every frame
  const dirs = useMemo(() => Array.from({ length: SPARKS }, (_, i) => {
    const a = (i / SPARKS) * Math.PI * 2 + Math.sin(i * 7.3) * 0.4
    return new THREE.Vector3(Math.cos(a) * (0.8 + (i % 3) * 0.35), 1.6 + (i % 4) * 0.45, Math.sin(a) * (0.8 + (i % 3) * 0.35))
  }), [])

  useFrame(({ clock }) => {
    const now = clock.elapsedTime
    if (t0.current === null) t0.current = now
    const age = now - t0.current
    const flash = age < FLASH_SECONDS ? 1 - age / FLASH_SECONDS : 0
    // flickering arc light while the event is fresh
    const flicker = flash > 0 ? (Math.sin(now * 55) > 0.2 ? 1 : 0.25) * flash : 0
    if (light.current) light.current.intensity = flicker * 60
    if (arc.current) {
      arc.current.visible = flicker > 0.3
      arc.current.scale.setScalar(0.6 + Math.random() * 0.8)
      arc.current.rotation.set(Math.random() * 3, Math.random() * 3, 0)
    }
    sparks.current.forEach((m, i) => {
      if (!m) return
      const k = (age * 1.4 + (i % 5) * 0.11) % 1.1 // repeated short bursts while flashing
      m.visible = flash > 0 && k < 1
      const d = dirs[i]
      m.position.set(d.x * k, 1.2 + d.y * k - 4.9 * k * k, d.z * k)
    })
    if (ring.current) {
      const k = (age * 1.2) % 1
      ring.current.visible = flash > 0
      ring.current.scale.setScalar(0.5 + k * 3)
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.7 * flash
    }
    if (meter) {
      // a slow column of smoke that never stops: the meter is dead
      puffs.current.forEach((m, i) => {
        if (!m) return
        const k = (age * 0.32 + i / PUFFS) % 1
        m.position.set(Math.sin(i * 2.1 + age * 0.6) * 0.25 * k, 1.3 + k * 3.2, Math.cos(i * 1.7) * 0.2 * k)
        m.scale.setScalar(0.25 + k * 0.9)
        ;(m.material as THREE.MeshStandardMaterial).opacity = 0.55 * (1 - k) * Math.min(1, age * 2)
      })
      if (fault.current) {
        const m = fault.current.material as THREE.MeshStandardMaterial
        m.emissiveIntensity = Math.sin(now * 6) > 0 ? 2.4 : 0.2
      }
    }
  })

  return (
    <group position={[at[0], 0, at[1]]}>
      <pointLight ref={light} position={[0, 1.6, 0.4]} color="#9fd8ff" intensity={0} distance={9} />
      <mesh ref={arc} position={[0, 1.35, 0.3]} visible={false}>
        <icosahedronGeometry args={[0.32, 0]} />
        <meshBasicMaterial color="#e8f6ff" wireframe />
      </mesh>
      {dirs.map((_, i) => (
        <mesh key={i} ref={(m) => { sparks.current[i] = m }} visible={false}>
          <sphereGeometry args={[0.05, 6, 4]} />
          <meshBasicMaterial color={i % 3 ? '#ffd166' : '#ffffff'} />
        </mesh>
      ))}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} visible={false}>
        <ringGeometry args={[0.8, 1.0, 40]} />
        <meshBasicMaterial color={meter ? '#d64545' : '#4fb3ff'} transparent depthWrite={false} />
      </mesh>
      {meter && Array.from({ length: PUFFS }, (_, i) => (
        <mesh key={`p${i}`} ref={(m) => { puffs.current[i] = m }}>
          <sphereGeometry args={[0.45, 10, 8]} />
          <meshStandardMaterial color="#5b6168" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
      {meter && (
        <mesh ref={fault} position={[0.62, 1.05, 0.62]}>
          <sphereGeometry args={[0.13, 14, 10]} />
          <meshStandardMaterial color="#d64545" emissive="#ff2a2a" emissiveIntensity={1} />
        </mesh>
      )}
      <Html position={[0, 3.1, 0]} center zIndexRange={[6, 0]}>
        <div className={`incident-tag incident-tag--${incident.kind}`}>
          <span>{meter ? '🔥' : '⚡'}</span>
          {meter
            ? t('Meter {node} offline').split('{node}').join(incident.label)
            : t('{sw} operated → {state}').split('{sw}').join(incident.label).split('{state}').join(t(incident.state ?? ''))}
        </div>
      </Html>
    </group>
  )
}

export function IncidentLayer({ incidents, pos }: { incidents: Incident[]; pos: Map<number, Vec2> }) {
  return (
    <group>
      {incidents.map((inc) => pos.has(inc.node) && <IncidentFx key={inc.id} incident={inc} at={pos.get(inc.node)!} />)}
    </group>
  )
}
