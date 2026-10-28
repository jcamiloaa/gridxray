import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useI18n } from '../i18n'
import { along, LANE, SPEED, streetPath } from './crewPath'
import { KOFF, type Vec2 } from './layout'
import type { Overlay } from './model'

type Crew = NonNullable<Overlay['crew']>

/** Utility truck: white cab, orange body stripe, ladder rack and a flashing amber beacon. */
function Truck({ beacon }: { beacon: React.RefObject<THREE.Mesh | null> }) {
  return (
    <group>
      <mesh position={[0, 0.42, -0.35]} castShadow>
        <boxGeometry args={[0.78, 0.62, 1.25]} />
        <meshStandardMaterial color="#f4f6f8" />
      </mesh>
      <mesh position={[0, 0.42, -0.35]}>
        <boxGeometry args={[0.8, 0.12, 1.27]} />
        <meshStandardMaterial color="#f26b1d" />
      </mesh>
      <mesh position={[0, 0.4, 0.52]} castShadow>
        <boxGeometry args={[0.74, 0.56, 0.5]} />
        <meshStandardMaterial color="#e9edf1" />
      </mesh>
      <mesh position={[0, 0.52, 0.78]}>
        <boxGeometry args={[0.62, 0.24, 0.02]} />
        <meshStandardMaterial color="#2a3a4a" metalness={0.4} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.8, -0.35]}>
        <boxGeometry args={[0.5, 0.05, 1.15]} />
        <meshStandardMaterial color="#9aa5b1" />
      </mesh>
      <mesh ref={beacon} position={[0, 0.74, 0.5]}>
        <boxGeometry args={[0.36, 0.08, 0.1]} />
        <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={1} />
      </mesh>
      {[[-0.36, 0.12, 0.45], [0.36, 0.12, 0.45], [-0.36, 0.12, -0.6], [0.36, 0.12, -0.6]].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.14, 0.14, 0.1, 16]} />
          <meshStandardMaterial color="#1f2730" />
        </mesh>
      ))}
    </group>
  )
}

/** Lineworker in hi-vis vest and hard hat, holding a camera up to the equipment. */
function Worker({ flash }: { flash: React.RefObject<THREE.Mesh | null> }) {
  return (
    <group>
      {[-0.07, 0.07].map((x) => (
        <mesh key={x} position={[x, 0.2, 0]} castShadow>
          <boxGeometry args={[0.09, 0.4, 0.1]} />
          <meshStandardMaterial color="#2d3e55" />
        </mesh>
      ))}
      <mesh position={[0, 0.56, 0]} castShadow>
        <boxGeometry args={[0.28, 0.34, 0.16]} />
        <meshStandardMaterial color="#ff7a1a" />
      </mesh>
      <mesh position={[0, 0.6, 0.002]}>
        <boxGeometry args={[0.29, 0.04, 0.165]} />
        <meshStandardMaterial color="#e6f24a" emissive="#e6f24a" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, 0.83, 0]}>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshStandardMaterial color="#c99a72" />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <sphereGeometry args={[0.105, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#ffd21f" />
      </mesh>
      {/* arms raised, camera at eye height */}
      {[-0.11, 0.11].map((x) => (
        <mesh key={x} position={[x, 0.7, 0.11]} rotation={[-1.1, 0, 0]}>
          <boxGeometry args={[0.06, 0.24, 0.06]} />
          <meshStandardMaterial color="#ff7a1a" />
        </mesh>
      ))}
      <mesh position={[0, 0.78, 0.22]}>
        <boxGeometry args={[0.16, 0.1, 0.07]} />
        <meshStandardMaterial color="#20262d" />
      </mesh>
      <mesh ref={flash} position={[0.04, 0.8, 0.27]}>
        <sphereGeometry args={[0.05, 12, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * The field crew of a "dispatch crew" step: the truck drives the streets to the site, then the
 * lineworker photographs the switch (camera flashes while Muse Image renders the photo), SAM 3.1
 * scans the equipment, and Muse Spark reads it.
 */
export function CrewLayer({ crew, pos }: { crew: Crew; pos: Map<number, Vec2> }) {
  const { t } = useI18n()
  const site = pos.get(crew.node)
  const path = useMemo(() => (site ? streetPath(crew.from !== undefined ? pos.get(crew.from) : undefined, site) : []),
    [site, crew.from, pos])
  const truck = useRef<THREE.Group>(null)
  const beacon = useRef<THREE.Mesh>(null)
  const worker = useRef<THREE.Group>(null)
  const flash = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const burst = useRef<THREE.Mesh>(null)
  const scan = useRef<THREE.Mesh>(null)
  const frame = useRef<THREE.LineSegments>(null)
  const label = useRef<HTMLDivElement>(null)
  const t0 = useRef<number | null>(null)
  const [arrived, setArrived] = useState(false)
  // a replayed visit (opened from history) is already over: park the truck at once
  const parked = crew.stage === 'done'

  useFrame(({ clock }) => {
    if (!site || path.length < 2) return
    const now = clock.elapsedTime
    if (t0.current === null) t0.current = now
    const { at, heading, done } = along(path, parked ? 1e9 : (now - t0.current) * SPEED)
    if (done !== arrived) setArrived(done)
    truck.current?.position.set(at[0], 0, at[1])
    truck.current?.rotation.set(0, heading, 0)
    if (beacon.current) (beacon.current.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(now * 12) > 0 ? 2.2 : 0.15
    if (worker.current) {
      worker.current.visible = done
      // steps out of the cab and faces the equipment
      worker.current.position.set(site[0] + 0.25, 0, site[1] - KOFF + LANE + 0.75)
    }
    if (label.current) label.current.style.opacity = done ? '1' : '0.85'

    const shooting = done && crew.stage === 'photo'
    const k = (now * 0.9) % 1 // one flash every ~1.1 s
    const pop = shooting && k < 0.12 ? 1 - k / 0.12 : 0
    if (flash.current) (flash.current.material as THREE.MeshBasicMaterial).opacity = pop
    if (light.current) light.current.intensity = pop * 40
    if (burst.current) {
      burst.current.visible = pop > 0
      burst.current.scale.setScalar(0.4 + (1 - pop) * 1.6)
      ;(burst.current.material as THREE.MeshBasicMaterial).opacity = pop * 0.8
    }
    const scanning = done && crew.stage === 'segment'
    if (scan.current) {
      scan.current.visible = scanning
      scan.current.position.y = 0.1 + ((Math.sin(now * 3) + 1) / 2) * 2.4
    }
    if (frame.current) {
      frame.current.visible = scanning || (done && crew.stage === 'read')
      ;(frame.current.material as THREE.LineBasicMaterial).color.set(crew.stage === 'read' ? '#8b5cf6' : '#18c3e6')
    }
  })

  if (!site || path.length < 2) return null
  const text = !arrived && !parked
    ? t('Crew driving to {node}').split('{node}').join(crew.name)
    : crew.stage === 'photo' ? t('Taking the photo · Muse Image')
    : crew.stage === 'segment' ? t('Segmenting the equipment · SAM 3.1')
    : crew.stage === 'read' ? t('Reading the switch · Muse Spark')
    : crew.outdated ? t('Record outdated') : t('Field visit done')
  return (
    <group>
      <group ref={truck}><Truck beacon={beacon} /></group>
      <group ref={worker} visible={false}>
        <Worker flash={flash} />
        <pointLight ref={light} position={[0, 0.9, 0.5]} color="#ffffff" intensity={0} distance={6} />
        <mesh ref={burst} position={[0.04, 0.8, 0.3]} visible={false}>
          <ringGeometry args={[0.15, 0.22, 32]} />
          <meshBasicMaterial color="#ffffff" transparent depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <Html position={[0, 1.6, 0]} center distanceFactor={14} zIndexRange={[20, 0]}>
          <div ref={label} className={`crew-tag crew-tag--${crew.stage}${crew.outdated ? ' is-outdated' : ''}`}>
            <span className="crew-tag__icon">{crew.stage === 'photo' ? '📷' : crew.stage === 'segment' ? '✂' : crew.stage === 'read' ? '👁' : crew.outdated ? '⚠' : '✓'}</span>
            {text}
          </div>
        </Html>
      </group>
      {/* SAM 3.1 scanning frame around the equipment */}
      <group position={[site[0], 0, site[1]]}>
        <lineSegments ref={frame} position={[0, 1.3, 0]} visible={false}>
          <edgesGeometry args={[new THREE.BoxGeometry(1.7, 2.6, 1.7)]} />
          <lineBasicMaterial color="#18c3e6" />
        </lineSegments>
        <mesh ref={scan} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <planeGeometry args={[1.7, 1.7]} />
          <meshBasicMaterial color="#18c3e6" transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  )
}
