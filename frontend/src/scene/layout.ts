import type { GridModel } from './model'

export type Vec2 = [number, number] // ground plane (x, z)

/**
 * Everything sits on a city street grid. Street centrelines run along x = c·PX and z = r·PZ;
 * each secondary substation occupies the corner of a block, KOFF inside the kerb, so
 * feeders can run along the pavement lines x = c·PX + KOFF and z = r·PZ + KOFF.
 */
export const PX = 6.4
export const PZ = 5.2
export const KOFF = 1.9
export const SUB_X = -9.5 // substations sit outside the city, west of the boundary avenue
const ROOT_GAP_ROWS = 2

const cellX = (col: number) => col * PX + KOFF
const cellZ = (row: number) => row * PZ + KOFF

/** Known topology: feeders grow east (+x) by depth; branches stack south (+z). */
function treeLayout(model: GridModel): Map<number, Vec2> {
  const children = new Map<number, number[]>()
  for (const e of model.edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to])
  const pos = new Map<number, Vec2>()
  let cursor = 0
  const place = (id: number, depth: number): number => {
    const kids = children.get(id) ?? []
    const row = kids.length ? kids.map((k) => place(k, depth + 1))[0] : cursor++
    pos.set(id, depth === 0 ? [SUB_X, cellZ(row)] : [cellX(depth - 1), cellZ(row)])
    return row
  }
  for (const s of model.substations) {
    place(s.id, 0)
    cursor += ROOT_GAP_ROWS
  }
  // safety net: anything not reached from a substation still gets a block
  for (const n of model.nodes) if (!pos.has(n.id)) pos.set(n.id, [cellX(0), cellZ(cursor++)])
  return pos
}

/** Hidden topology: one substation per block corner across the city, filled row by row. */
function fieldLayout(model: GridModel): Map<number, Vec2> {
  const pos = new Map<number, Vec2>()
  const n = model.nodes.length
  const rows = Math.max(1, Math.round(Math.sqrt(n / 1.6)))
  const cols = Math.ceil(n / rows)
  const roots = model.substations.length
  model.substations.forEach((s, i) => {
    const row = roots > 1 ? Math.round((i * (rows - 1)) / (roots - 1)) : Math.floor((rows - 1) / 2)
    pos.set(s.id, [SUB_X, cellZ(row)])
  })
  model.nodes.forEach((node, i) => pos.set(node.id, [cellX(i % cols), cellZ(Math.floor(i / cols))]))
  return pos
}

/** Known GIS locations: identical whether the wiring is hidden or revealed. */
function geoLayout(model: GridModel): Map<number, Vec2> {
  const pos = new Map<number, Vec2>()
  for (const s of model.substations) pos.set(s.id, [SUB_X, cellZ(s.location![1])])
  for (const n of model.nodes) pos.set(n.id, [cellX(n.location![0]), cellZ(n.location![1])])
  return pos
}

export function layout(model: GridModel): Map<number, Vec2> {
  const located = model.nodes.every((n) => n.location) && model.substations.every((s) => s.location)
  if (located) return geoLayout(model)
  return model.topologyKnown ? treeLayout(model) : fieldLayout(model)
}

/** Path along the streets: east/west first, then north/south (an L), or straight if aligned. */
export function route(a: Vec2, b: Vec2): Vec2[] {
  if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) return [a, b]
  return [a, [b[0], a[1]], b]
}

/**
 * Where cables attach. Overhead lines: switchgear top, kiosk roof bushings or the pole top of a
 * pole-mounted transformer. Underground cables: ground level at the equipment.
 */
export function anchorOf(
  kind: 'substation' | 'node', [x, z]: Vec2, mount: 'kiosk' | 'pole' = 'kiosk', underground = false,
): [number, number, number] {
  if (underground) return kind === 'substation' ? [x + 1.95, 0.08, z] : [x, 0.08, z]
  if (kind === 'substation') return [x + 1.95, 1.53, z]
  return mount === 'pole' ? [x, 2.46, z] : [x - 0.1, 1.45, z]
}
