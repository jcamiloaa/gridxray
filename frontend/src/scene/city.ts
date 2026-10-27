/**
 * A fictional city laid over the street grid of the layout: blocks, avenues,
 * parks, residential complexes and an industrial zone for the substations. Deterministic per seed.
 */
import { Builder, type Parts } from './models'
import { KOFF, PX, PZ, SUB_X, type Vec2 } from './layout'

/** A street name painted flat on the road surface. */
export interface StreetLabel {
  key: string
  text: string
  x: number
  z: number
  along: 'x' | 'z'
  major: boolean
}

export interface City {
  parts: Parts
  streets: StreetLabel[]
}

const AVENUE_EVERY = 4
const LOCAL_W = 1.05
const AVENUE_W = 1.9
const MAJOR_NS = ['Ring Road', 'Aurora Boulevard', 'Founders Avenue', 'Riverside Avenue', 'Central Avenue']
const MAJOR_EW = ['Liberty Boulevard', 'Harbor Avenue', 'Summit Avenue', 'Lakeview Boulevard']
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

function rand(a: number, b: number, seed: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453
  return x - Math.floor(x)
}

const streetW = (i: number) => (i % AVENUE_EVERY === 0 ? AVENUE_W : LOCAL_W)

export function buildCity(pos: Map<number, Vec2>, roots: Set<number>, seed = 0, solar: Set<number> = new Set()): City {
  const b = new Builder()
  const streets: StreetLabel[] = []
  const cells = [...pos.entries()].filter(([id]) => !roots.has(id)).map(([, p]) => p)
  const cellOf = ([x, z]: Vec2) => `${Math.round((x - KOFF) / PX)},${Math.round((z - KOFF) / PZ)}`
  const occupied = new Set(cells.map(cellOf))
  const solarCells = new Set([...solar].filter((id) => pos.has(id)).map((id) => cellOf(pos.get(id)!)))
  const cols = cells.map(([x]) => Math.round((x - KOFF) / PX))
  const rows = cells.map(([, z]) => Math.round((z - KOFF) / PZ))
  const c0 = 0
  const c1 = Math.max(...cols, 2) + 2
  const r0 = Math.min(...rows, 0) - 1
  const r1 = Math.max(...rows, 2) + 2
  const x0 = c0 * PX
  const x1 = c1 * PX
  const z0 = r0 * PZ
  const z1 = r1 * PZ

  // ground: city land plus an industrial zone west of the boundary avenue
  b.box('land', [x1 - x0 + PX * 2, 0.02, z1 - z0 + PZ * 2], [(x0 + x1) / 2, 0.005, (z0 + z1) / 2])
  const ix0 = SUB_X - 14
  b.box('industrial', [x0 - ix0, 0.025, z1 - z0], [(ix0 + x0) / 2, 0.01, (z0 + z1) / 2])

  // streets (centre lines on the grid); avenues every few lines
  for (let c = c0; c <= c1; c++) {
    const w = streetW(c)
    b.box(c % AVENUE_EVERY === 0 ? 'avenue' : 'street', [w, 0.03, z1 - z0], [c * PX, 0.02, (z0 + z1) / 2])
    const major = c % AVENUE_EVERY === 0
    const name = major ? MAJOR_NS[(c / AVENUE_EVERY) % MAJOR_NS.length] : `${ordinal(c)} Avenue`
    for (let r = r0 + 1; r < r1; r += 3) streets.push({ key: `ns${c},${r}`, text: name, x: c * PX, z: r * PZ + PZ / 2, along: 'z', major })
  }
  for (let r = r0; r <= r1; r++) {
    const w = streetW(r - r0)
    const isAvenue = (r - r0) % AVENUE_EVERY === 0
    b.box(isAvenue ? 'avenue' : 'street', [x1 - x0, 0.031, w], [(x0 + x1) / 2, 0.021, r * PZ])
    const name = isAvenue ? MAJOR_EW[((r - r0) / AVENUE_EVERY) % MAJOR_EW.length] : `${ordinal(r - r0 + 1)} Street`
    for (let c = c0 + 1; c < c1; c += 3) streets.push({ key: `ew${r},${c}`, text: name, x: c * PX + PX / 2, z: r * PZ, along: 'x', major: isAvenue })
  }

  // blocks
  for (let c = c0; c < c1; c++) {
    for (let r = r0; r < r1; r++) {
      const bx0 = c * PX + streetW(c) / 2
      const bx1 = (c + 1) * PX - streetW(c + 1) / 2
      const bz0 = r * PZ + streetW(r - r0) / 2
      const bz1 = (r + 1) * PZ - streetW(r + 1 - r0) / 2
      const w = bx1 - bx0
      const d = bz1 - bz0
      const hasKiosk = occupied.has(`${c},${r}`)
      const park = !hasKiosk && rand(c, r, seed) < 0.22
      b.box(park ? 'park' : 'block', [w, 0.04, d], [(bx0 + bx1) / 2, 0.03, (bz0 + bz1) / 2])
      if (park) {
        const trees = 3 + Math.floor(rand(r, c, seed + 1) * 4)
        for (let i = 0; i < trees; i++) {
          const tx = bx0 + 0.5 + rand(c + i, r, seed + 2) * (w - 1)
          const tz = bz0 + 0.5 + rand(c, r + i, seed + 3) * (d - 1)
          const h = 0.4 + rand(i, c + r, seed) * 0.3
          b.cyl('trunk', 0.04, h, [tx, h / 2 + 0.05, tz], 0.05, 6)
          b.cyl('crown', 0.0, 0.9, [tx, h + 0.45, tz], 0.38, 7)
        }
        continue
      }
      if (solarCells.has(`${c},${r}`)) continue // this block hosts a PV plant
      // residential complex inside the area left free by the pavement lines the feeders use
      const ux0 = c * PX + KOFF + 0.9
      const uz0 = r * PZ + KOFF + 0.9
      const ux1 = bx1 - 0.2
      const uz1 = bz1 - 0.2
      const uw = ux1 - ux0
      const ud = uz1 - uz0
      if (uw < 0.8 || ud < 0.8) continue
      const towers = rand(c, r, seed + 5) < 0.18
      const mat = rand(r, c, seed + 6) < 0.3 ? 'buildingAlt' : 'building'
      const hA = towers ? 1.6 + rand(c, r, seed + 7) * 1.4 : 0.35 + rand(c, r, seed + 7) * 0.5
      const hB = towers ? 1.2 + rand(r, c, seed + 8) * 1.2 : 0.3 + rand(r, c, seed + 8) * 0.45
      const eW = Math.min(1.4, uw * 0.38)
      b.box(mat, [eW, hA, ud], [ux1 - eW / 2, hA / 2 + 0.05, (uz0 + uz1) / 2])
      const sD = Math.min(1.1, ud * 0.42)
      const sW = uw - eW - 0.3
      if (sW > 0.6) b.box(mat, [sW, hB, sD], [ux0 + sW / 2, hB / 2 + 0.05, uz1 - sD / 2])
      if (sW > 0.9 && ud - sD > 0.9 && rand(c + 3, r + 7, seed) < 0.6) {
        const h = 0.22 + rand(c, r + 3, seed) * 0.25
        b.box(mat, [sW * 0.6, h, (ud - sD) * 0.5], [ux0 + sW * 0.3, h / 2 + 0.05, uz0 + (ud - sD) * 0.3])
      }
    }
  }

  // warehouses in the industrial zone, away from the substation yards
  const rootZ = [...roots].map((id) => pos.get(id)![1])
  for (let z = z0 + 2; z < z1 - 2; z += 4.6) {
    if (rootZ.some((rz) => Math.abs(rz - z) < 5.2)) continue
    const w = 3 + rand(z, 1, seed) * 2.5
    const h = 0.7 + rand(z, 2, seed) * 0.6
    b.box('warehouse', [w, h, 2.6], [SUB_X - 1 + rand(z, 3, seed) * 3, h / 2 + 0.03, z])
  }

  return { parts: b.build(), streets }
}
