import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { StreetLabel } from './city'

const FONT = '600 64px Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'

function textTexture(text: string, major: boolean): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = FONT
  const w = Math.ceil(ctx.measureText(text).width) + 40
  canvas.width = w
  canvas.height = 96
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 10
  ctx.strokeStyle = major ? 'rgba(247,203,168,0.95)' : 'rgba(255,255,255,0.95)'
  ctx.strokeText(text, w / 2, 50)
  ctx.fillStyle = major ? '#8a4b1f' : '#6d6a66'
  ctx.fillText(text, w / 2, 50)
  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = 8
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, aspect: w / canvas.height }
}

/** Street names painted flat on the road, like a printed map. */
export function StreetLabels({ labels }: { labels: StreetLabel[] }) {
  const textures = useMemo(() => {
    const map = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>()
    for (const l of labels) {
      const key = `${l.text}|${l.major}`
      if (!map.has(key)) map.set(key, textTexture(l.text, l.major))
    }
    return map
  }, [labels])
  useEffect(() => () => textures.forEach((t) => t.texture.dispose()), [textures])

  return (
    <group>
      {labels.map((l) => {
        const { texture, aspect } = textures.get(`${l.text}|${l.major}`)!
        const h = l.major ? 1.05 : 0.72
        return (
          <mesh key={l.key} position={[l.x, 0.05, l.z]} rotation={[-Math.PI / 2, 0, l.along === 'x' ? 0 : Math.PI / 2]}
            renderOrder={2}>
            <planeGeometry args={[h * aspect, h]} />
            <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}
