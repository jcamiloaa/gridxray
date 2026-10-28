import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { CrewLayer } from './CrewLayer'
import { route, type Vec2 } from './layout'
import type { Overlay } from './model'

const HEIGHT = 3.4 // floats above the real conductors (~2.4) so the AI's tree reads as an annotation

const STYLE: Record<Overlay['edges'][number]['status'], { color: string; dashed: boolean; width: number }> = {
  measured: { color: '#0e6e8c', dashed: false, width: 3.2 },
  proposed: { color: '#0e6e8c', dashed: false, width: 3.2 },
  inferred: { color: '#e9a23b', dashed: true, width: 2.2 },
  uncertain: { color: '#e9a23b', dashed: true, width: 2.6 },
  correct: { color: '#17a673', dashed: false, width: 3.6 },
  wrong: { color: '#d64545', dashed: false, width: 3.6 },
}

function Pulse({ at, color, strength = 1, speed = 2.4 }: { at: Vec2; color: string; strength?: number; speed?: number }) {
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const k = (clock.elapsedTime * speed) % 1
    ring.current.scale.setScalar(1 + k * 1.6)
    ;(ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85 * strength
  })
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[at[0], 0.06, at[1]]}>
      <ringGeometry args={[0.9, 1.15, 48]} />
      <meshBasicMaterial color={color} transparent depthWrite={false} />
    </mesh>
  )
}

/** The investigating agent's current topology, its last experiment, and (after reveal) the comparison. */
export function HypothesisLayer({ overlay, pos }: { overlay: Overlay; pos: Map<number, Vec2> }) {
  const path = (a: number, b: number) => route(pos.get(a)!, pos.get(b)!).map((p) => [p[0], HEIGHT, p[1]] as [number, number, number])
  const maxDrop = overlay.focus ? Math.max(1e-9, ...Object.values(overlay.focus.drops)) : 1
  return (
    <group>
      {overlay.edges.map((e) => pos.has(e.child) && pos.has(e.parent) && (
        <Line key={`${e.child}-${e.parent}`} points={path(e.parent, e.child)} color={STYLE[e.status].color}
          lineWidth={STYLE[e.status].width} dashed={STYLE[e.status].dashed} dashSize={0.4} gapSize={0.3} />
      ))}
      {overlay.missed?.map(([a, b]) => pos.has(a) && pos.has(b) && (
        <Line key={`m${a}-${b}`} points={path(a, b)} color="#8f99a4" lineWidth={2} dashed dashSize={0.25} gapSize={0.35} />
      ))}
      {overlay.focus && pos.has(overlay.focus.node) && (
        <>
          <Pulse at={pos.get(overlay.focus.node)!} color="#f26b1d" speed={1.6} />
          {Object.entries(overlay.focus.drops).map(([id, drop]) => {
            const n = Number(id)
            if (n === overlay.focus!.node || !pos.has(n)) return null
            return <Pulse key={id} at={pos.get(n)!} color="#0e6e8c" strength={Math.max(0.15, drop / maxDrop)} speed={1.6} />
          })}
        </>
      )}
      {overlay.crew && <CrewLayer key={overlay.crew.visit} crew={overlay.crew} pos={pos} />}
    </group>
  )
}
