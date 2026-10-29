import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { CrewLayer } from './CrewLayer'
import { IncidentLayer } from './IncidentLayer'
import { SignalLayer } from './SignalLayer'
import { route, type Vec2 } from './layout'
import type { DiffKind, Overlay } from './model'

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

const DIFF_COLOR: Record<DiffKind, string> = { correct: '#17a673', wrong: '#d64545', missed: '#3d4650' }
const DIFF_HEIGHT = 0.5 // on the streets, where the real cables run, not floating above them

function Ring({ at, color, dim }: { at: Vec2; color: string; dim: boolean }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[at[0], 0.07, at[1]]} renderOrder={2}>
      <ringGeometry args={[1.05, 1.45, 40]} />
      <meshBasicMaterial color={color} transparent opacity={dim ? 0.15 : 0.9} depthWrite={false} />
    </mesh>
  )
}

/**
 * Differences view: every real connection appears once, either green (the AI found it) or grey dashed
 * (it missed it), plus the AI's red connections that do not exist. Each secondary substation gets a ring
 * with the outcome of its own parent link, and wrong ones say what the AI claimed and what is real.
 */
function DiffLayer({ overlay, pos }: { overlay: Overlay; pos: Map<number, Vec2> }) {
  const { highlight, notes, words } = overlay.diff!
  const dim = (k: DiffKind) => highlight !== null && highlight !== k
  const path = (a: number, b: number) => route(pos.get(a)!, pos.get(b)!).map((p) => [p[0], DIFF_HEIGHT, p[1]] as [number, number, number])
  const kind = (status: string): DiffKind => (status === 'correct' ? 'correct' : 'wrong')
  // ring per node: its own parent link decides; a node the AI never connected counts as missed
  const rings = new Map<number, DiffKind>()
  for (const e of overlay.edges) rings.set(e.child, kind(e.status))
  for (const [a, b] of overlay.missed ?? []) for (const n of [a, b]) if (!rings.has(n)) rings.set(n, 'missed')
  return (
    <group>
      {overlay.missed?.map(([a, b]) => pos.has(a) && pos.has(b) && (
        <Line key={`m${a}-${b}`} points={path(a, b)} color={DIFF_COLOR.missed} lineWidth={4.2} dashed dashSize={0.6} gapSize={0.4}
          transparent opacity={dim('missed') ? 0.12 : 1} depthTest={false} renderOrder={5} />
      ))}
      {overlay.edges.map((e) => pos.has(e.child) && pos.has(e.parent) && (
        <Line key={`${e.child}-${e.parent}`} points={path(e.parent, e.child)} color={DIFF_COLOR[kind(e.status)]}
          lineWidth={kind(e.status) === 'wrong' ? 5.5 : 4.6} transparent opacity={dim(kind(e.status)) ? 0.12 : 1}
          depthTest={false} renderOrder={4} />
      ))}
      {[...rings].map(([n, k]) => pos.has(n) && <Ring key={n} at={pos.get(n)!} color={DIFF_COLOR[k]} dim={dim(k)} />)}
      {highlight !== 'correct' && highlight !== 'missed' && notes.map((nt) => pos.has(nt.node) && (
        <Html key={nt.node} position={[pos.get(nt.node)![0], 3.1, pos.get(nt.node)![1]]} center zIndexRange={[20, 10]}>
          <div className="cmp-note"><b>{words.ai}</b> {nt.ai} <span>→</span> <b>{words.real}</b> {nt.real}</div>
        </Html>
      ))}
    </group>
  )
}

/** The investigating agent's current topology, its last experiment, and (after reveal) the comparison. */
export function HypothesisLayer({ overlay, pos }: { overlay: Overlay; pos: Map<number, Vec2> }) {
  if (overlay.diff) return <DiffLayer overlay={overlay} pos={pos} />
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
      <SignalLayer overlay={overlay} pos={pos} />
      {overlay.incidents && <IncidentLayer incidents={overlay.incidents} pos={pos} />}
      {overlay.crew && <CrewLayer key={overlay.crew.visit} crew={overlay.crew} pos={pos} />}
    </group>
  )
}
