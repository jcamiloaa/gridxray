/**
 * Procedural equipment models in an isometric technical-illustration style.
 * Each model is built once and merged per material, so an instance costs a handful of draw calls.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type MatKey =
  | 'steel' | 'steelDark' | 'concrete' | 'plinth' | 'wall' | 'roof' | 'door' | 'sign' | 'signInk'
  | 'porcelain' | 'tank' | 'radiator' | 'cabinet' | 'band' | 'gravel' | 'fence' | 'copper'
  | 'land' | 'block' | 'building' | 'buildingAlt' | 'park' | 'avenue' | 'street' | 'industrial'
  | 'warehouse' | 'trunk' | 'crown' | 'water' | 'panel' | 'panelFrame' | 'marker' | 'rmu' | 'capacitor'

const std = (color: string, roughness = 0.75, metalness = 0.05) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness })

export const MATS: Record<MatKey, THREE.MeshStandardMaterial> = {
  steel: std('#a3acb6', 0.6, 0.35),
  steelDark: std('#6a7480', 0.6, 0.3),
  concrete: std('#d9dde2'),
  plinth: std('#b8bfc7'),
  wall: std('#d3d8de'),
  roof: std('#3e4752', 0.85),
  door: std('#2f6fd6', 0.55),
  sign: std('#f5c518', 0.5),
  signInk: std('#1c232b', 0.6),
  porcelain: std('#f4f3ee', 0.35),
  tank: std('#7b8794', 0.55, 0.25),
  radiator: std('#66717d', 0.6, 0.3),
  cabinet: std('#eef1f4', 0.6),
  band: std('#2f6fd6', 0.55),
  gravel: std('#c9ced3', 1),
  fence: std('#8d96a0', 0.6, 0.3),
  copper: std('#b06a2c', 0.45, 0.5),
  // city map, OpenStreetMap-like palette
  land: std('#f2efe9', 1),
  block: std('#e7e2db', 1),
  building: std('#dcd3cb', 0.9),
  buildingAlt: std('#d2cbd6', 0.9),
  park: std('#cde8b6', 1),
  avenue: std('#f7cba8', 0.9),
  street: std('#ffffff', 0.9),
  industrial: std('#e6dfe9', 1),
  warehouse: std('#cfc6d4', 0.85),
  trunk: std('#8a6a4f', 0.9),
  crown: std('#9ccf7f', 0.8),
  water: std('#aad3df', 0.4),
  panel: std('#1f3f8f', 0.25, 0.4),
  panelFrame: std('#c3cad2', 0.5, 0.4),
  marker: std('#f5c518', 0.5),
  rmu: std('#7f9a8a', 0.6, 0.2),
  capacitor: std('#d9dde2', 0.45, 0.3),
}

export type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>

export class Builder {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>()

  add(mat: MatKey, g: THREE.BufferGeometry) {
    const list = this.parts.get(mat) ?? []
    list.push(g.index ? g.toNonIndexed() : g)
    this.parts.set(mat, list)
    return this
  }

  box(mat: MatKey, [w, h, d]: [number, number, number], [x, y, z]: [number, number, number], ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d)
    if (ry) g.rotateY(ry)
    return this.add(mat, g.translate(x, y, z))
  }

  cyl(mat: MatKey, r: number, h: number, [x, y, z]: [number, number, number], rBottom = r, seg = 12, axis: 'y' | 'x' | 'z' = 'y') {
    const g = new THREE.CylinderGeometry(r, rBottom, h, seg)
    if (axis === 'x') g.rotateZ(Math.PI / 2)
    if (axis === 'z') g.rotateX(Math.PI / 2)
    return this.add(mat, g.translate(x, y, z))
  }

  /** Square-section member between two points. */
  beam(mat: MatKey, a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, t = 0.05) {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const len = va.distanceTo(vb)
    const g = new THREE.BoxGeometry(t, len, t)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())
    g.applyQuaternion(q)
    const m = va.add(vb).multiplyScalar(0.5)
    return this.add(mat, g.translate(m.x, m.y, m.z))
  }

  /** Porcelain insulator: a core with stacked sheds. */
  insulator([x, y, z]: [number, number, number], sheds = 4, r = 0.065, pitch = 0.07, down = false) {
    const dir = down ? -1 : 1
    this.cyl('porcelain', r * 0.35, sheds * pitch, [x, y + (dir * sheds * pitch) / 2, z], r * 0.35, 8)
    for (let i = 0; i < sheds; i++) this.cyl('porcelain', r, 0.022, [x, y + dir * (i + 0.5) * pitch, z], r, 12)
    return this
  }

  /** Yellow high-voltage warning triangle with a lightning mark, facing +z (or rotated). */
  warning([x, y, z]: [number, number, number], size = 0.16, ry = 0) {
    const s = new THREE.Shape()
    s.moveTo(0, size * 0.58)
    s.lineTo(size * 0.5, -size * 0.29)
    s.lineTo(-size * 0.5, -size * 0.29)
    s.closePath()
    const tri = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false })
    const bolt = new THREE.Shape()
    const k = size * 0.32
    bolt.moveTo(0.05 * k, 0.6 * k); bolt.lineTo(-0.3 * k, -0.05 * k); bolt.lineTo(0, -0.05 * k)
    bolt.lineTo(-0.1 * k, -0.6 * k); bolt.lineTo(0.3 * k, 0.1 * k); bolt.lineTo(0, 0.1 * k); bolt.closePath()
    const b = new THREE.ExtrudeGeometry(bolt, { depth: 0.004, bevelEnabled: false }).translate(0, -size * 0.02, 0.012)
    for (const [g, mat] of [[tri, 'sign'], [b, 'signInk']] as const) {
      g.rotateY(ry)
      this.add(mat, g.translate(x, y, z))
    }
    return this
  }

  build(): Parts {
    const out: Parts = {}
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false)
      if (merged) out[mat] = merged
    }
    return out
  }
}

/* ---------------------------------------------------------------- kiosk */

/** MV/LV secondary substation, footprint about 1.4 x 1.1, roof at y = 1.1. */
export function buildKiosk(): Parts {
  const b = new Builder()
  b.box('plinth', [1.46, 0.1, 1.16], [0, 0.05, 0])
  b.box('wall', [1.3, 0.95, 1.0], [0, 0.575, 0])
  b.box('roof', [1.5, 0.08, 1.2], [0, 1.09, 0])
  b.box('roof', [1.38, 0.05, 1.08], [0, 1.155, 0])
  // front (+z): two blue doors with warning signs
  for (const dx of [-0.32, 0.12]) {
    b.box('door', [0.34, 0.74, 0.03], [dx, 0.5, 0.51])
    b.warning([dx, 0.66, 0.525], 0.13)
    b.box('steelDark', [0.025, 0.08, 0.02], [dx + 0.13, 0.46, 0.53])
  }
  // side (+x): louvres and a third door
  for (let i = 0; i < 5; i++) b.box('steelDark', [0.02, 0.025, 0.36], [0.655, 0.72 + i * 0.055, -0.22])
  b.box('door', [0.03, 0.72, 0.34], [0.655, 0.49, 0.22])
  b.warning([0.672, 0.66, 0.22], 0.12, Math.PI / 2)
  // roof equipment: two terminal boxes, each with three porcelain bushings
  for (const dz of [-0.24, 0.24]) {
    b.box('roof', [0.5, 0.1, 0.22], [-0.1, 1.23, dz])
    for (const dx of [-0.28, -0.1, 0.08]) b.insulator([dx, 1.28, dz], 3, 0.045, 0.055)
  }
  return b.build()
}

/* ---------------------------------------------------------------- lattice tower */

/** Steel lattice transmission tower with three crossarms and hanging insulator strings. */
export function buildTower(height = 7.2, base = 1.5, top = 0.45): Parts {
  const b = new Builder()
  const levels = 7
  const half = (y: number) => (base + (top - base) * (y / height)) / 2
  const corners = (y: number): THREE.Vector3Tuple[] => {
    const h = half(y)
    return [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]]
  }
  for (let i = 0; i < levels; i++) {
    const y0 = (i / levels) * height
    const y1 = ((i + 1) / levels) * height
    const c0 = corners(y0)
    const c1 = corners(y1)
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4
      b.beam('steel', c0[k], c1[k], 0.07) // leg
      b.beam('steel', c1[k], c1[n], 0.035) // ring
      b.beam('steel', c0[k], c1[n], 0.025) // X bracing
      b.beam('steel', c0[n], c1[k], 0.025)
    }
  }
  b.beam('steel', [0, height, 0], [0, height + 0.6, 0], 0.06)
  for (const [y, reach] of [[height * 0.62, 1.7], [height * 0.78, 1.4], [height * 0.92, 1.1]] as const) {
    const h = half(y)
    for (const s of [-1, 1]) {
      b.beam('steel', [-h, y, s * h], [0, y, s * reach], 0.04)
      b.beam('steel', [h, y, s * h], [0, y, s * reach], 0.04)
      b.beam('steel', [-h, y + 0.35, s * h], [0, y, s * reach], 0.03)
      b.insulator([0, y, s * reach], 5, 0.07, 0.07, true)
    }
  }
  b.box('concrete', [base + 0.4, 0.12, base + 0.4], [0, 0.06, 0])
  return b.build()
}

/** Attachment points of the six conductors on a tower (local coordinates). */
export function towerConductors(height = 7.2): THREE.Vector3Tuple[] {
  return [[height * 0.62, 1.7], [height * 0.78, 1.4], [height * 0.92, 1.1]]
    .flatMap(([y, r]) => [[0, y - 0.38, -r], [0, y - 0.38, r]] as THREE.Vector3Tuple[])
}

/* ---------------------------------------------------------------- substation */

/** HV/MV substation yard, centred on the origin; feeders leave along +x from the switchgear. */
export function buildSubstation(): Parts {
  const b = new Builder()
  const W = 7.2
  const D = 5.4
  b.box('gravel', [W, 0.05, D], [0, 0.025, 0])
  // fence
  for (let x = -W / 2; x <= W / 2 + 1e-6; x += W / 8) {
    for (const z of [-D / 2, D / 2]) b.box('fence', [0.05, 0.75, 0.05], [x, 0.4, z])
  }
  for (let z = -D / 2; z <= D / 2 + 1e-6; z += D / 6) {
    for (const x of [-W / 2, W / 2]) b.box('fence', [0.05, 0.75, 0.05], [x, 0.4, z])
  }
  for (const y of [0.3, 0.72]) {
    for (const z of [-D / 2, D / 2]) b.box('fence', [W, 0.025, 0.025], [0, y, z])
    for (const x of [-W / 2, W / 2]) b.box('fence', [0.025, 0.025, D], [x, y, 0])
  }

  // HV gantry: two lattice columns and a lattice beam
  const gx = -2.9
  for (const gz of [-1.5, 1.5]) {
    for (let i = 0; i < 4; i++) {
      const y0 = i * 0.85
      const y1 = (i + 1) * 0.85
      for (const [ax, az] of [[-0.12, -0.12], [0.12, -0.12], [0.12, 0.12], [-0.12, 0.12]]) {
        b.beam('steel', [gx + ax, y0, gz + az], [gx + ax, y1, gz + az], 0.04)
      }
      b.beam('steel', [gx - 0.12, y0, gz - 0.12], [gx + 0.12, y1, gz - 0.12], 0.02)
      b.beam('steel', [gx - 0.12, y0, gz + 0.12], [gx - 0.12, y1, gz - 0.12], 0.02)
    }
  }
  for (const y of [3.3, 3.55]) b.beam('steel', [gx, y, -1.6], [gx, y, 1.6], 0.05)
  for (let i = 0; i < 8; i++) {
    const z0 = -1.5 + i * 0.375
    b.beam('steel', [gx, 3.3, z0], [gx, 3.55, z0 + 0.375], 0.02)
  }
  for (const gz of [-0.8, 0, 0.8]) b.insulator([gx, 3.3, gz], 5, 0.06, 0.065, true)

  // power transformer: tank, radiators, conservator, bushings
  const tx = -0.7
  b.box('plinth', [2.0, 0.16, 2.0], [tx, 0.08, 0])
  b.box('tank', [1.4, 1.35, 1.25], [tx, 0.84, 0])
  b.box('tank', [1.5, 0.08, 1.35], [tx, 1.55, 0])
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) b.box('radiator', [0.07, 1.0, 0.32], [tx - 0.55 + i * 0.22, 0.8, s * 0.83])
    b.box('radiator', [1.3, 0.06, 0.06], [tx, 1.32, s * 0.83])
    b.box('radiator', [1.3, 0.06, 0.06], [tx, 0.3, s * 0.83])
  }
  b.cyl('tank', 0.17, 1.1, [tx - 0.4, 1.95, 0], 0.17, 16, 'z')
  b.box('steelDark', [0.06, 0.32, 0.06], [tx - 0.4, 1.72, -0.35])
  b.box('steelDark', [0.06, 0.32, 0.06], [tx - 0.4, 1.72, 0.35])
  for (const dz of [-0.4, 0, 0.4]) b.insulator([tx - 0.15, 1.6, dz], 7, 0.075, 0.075)
  for (const dz of [-0.35, 0, 0.35]) b.insulator([tx + 0.45, 1.6, dz], 3, 0.055, 0.06)
  b.warning([tx + 0.2, 0.95, 0.635], 0.22)

  // MV switchgear line-up: white cabinets with a blue band, one per feeder bay
  const sx = 1.95
  for (let i = 0; i < 5; i++) {
    const z = -1.6 + i * 0.8
    b.box('cabinet', [0.75, 1.3, 0.74], [sx, 0.7, z])
    b.box('band', [0.76, 0.08, 0.75], [sx, 1.18, z])
    b.box('steelDark', [0.02, 0.45, 0.5], [sx + 0.38, 0.55, z])
    b.warning([sx + 0.39, 0.95, z], 0.12, Math.PI / 2)
  }
  b.box('roof', [0.85, 0.06, 4.1], [sx, 1.38, 0])
  b.box('copper', [0.1, 0.06, 3.6], [sx, 1.5, 0])

  // control building
  b.box('wall', [1.3, 1.0, 1.1], [-0.6, 0.55, -2.1 + 0.6 - 0.05])
  b.box('roof', [1.45, 0.08, 1.25], [-0.6, 1.09, -1.55])
  b.box('door', [0.34, 0.66, 0.03], [-0.6, 0.43, -0.98])
  b.warning([-0.6, 0.85, -0.965], 0.12)
  return b.build()
}

/** Where cables attach on the substation: top of the MV switchgear. */
export const SUBSTATION_ANCHOR: THREE.Vector3Tuple = [1.95, 1.55, 0]

/* ---------------------------------------------------------------- pole */

export const POLE_H = 2.4
export const PHASE_SPREAD = 0.34

/** Concrete distribution pole with a crossarm and three pin insulators, crossarm along local z. */
export function buildPole(): Parts {
  const b = new Builder()
  b.cyl('concrete', 0.05, POLE_H, [0, POLE_H / 2, 0], 0.08, 10)
  b.box('steelDark', [0.07, 0.07, 0.95], [0, POLE_H - 0.1, 0])
  b.beam('steelDark', [0, POLE_H - 0.45, 0], [0, POLE_H - 0.12, 0.35], 0.03)
  b.beam('steelDark', [0, POLE_H - 0.45, 0], [0, POLE_H - 0.12, -0.35], 0.03)
  for (const dz of [-PHASE_SPREAD, 0, PHASE_SPREAD]) b.insulator([0, POLE_H - 0.06, dz], 2, 0.045, 0.05)
  return b.build()
}

/** Pole-mounted switch cabinet used for tie switches. */
export function buildSwitchPole(): Parts {
  const b = new Builder()
  b.cyl('concrete', 0.05, POLE_H, [0, POLE_H / 2, 0], 0.08, 10)
  b.box('steelDark', [0.07, 0.07, 0.95], [0, POLE_H - 0.1, 0])
  b.box('cabinet', [0.32, 0.42, 0.3], [0.12, 1.2, 0])
  b.box('band', [0.33, 0.05, 0.31], [0.12, 1.36, 0])
  b.warning([0.29, 1.18, 0], 0.1, Math.PI / 2)
  b.beam('steelDark', [0.12, 0.98, 0], [0.12, 0.35, 0], 0.025)
  for (const dz of [-PHASE_SPREAD, 0, PHASE_SPREAD]) b.insulator([0, POLE_H - 0.06, dz], 2, 0.045, 0.05)
  return b.build()
}

/* ---------------------------------------------------------------- MV equipment */

/** Shared base: concrete pole with a crossarm and three pin insulators. */
function poleBase(b: Builder) {
  b.cyl('concrete', 0.05, POLE_H, [0, POLE_H / 2, 0], 0.08, 10)
  b.box('steelDark', [0.07, 0.07, 0.95], [0, POLE_H - 0.1, 0])
  for (const dz of [-PHASE_SPREAD, 0, PHASE_SPREAD]) b.insulator([0, POLE_H - 0.06, dz], 2, 0.045, 0.05)
}

/** Pole-mounted distribution transformer with fuse cutouts. Anchor at the pole top. */
export function buildPoleTransformer(): Parts {
  const b = new Builder()
  poleBase(b)
  b.box('steelDark', [0.5, 0.05, 0.06], [0.22, 1.55, 0])
  b.cyl('tank', 0.24, 0.62, [0.32, 1.3, 0], 0.24, 18)
  b.cyl('tank', 0.26, 0.05, [0.32, 1.63, 0], 0.26, 18)
  for (const dz of [-0.1, 0.1]) b.insulator([0.32, 1.65, dz], 2, 0.04, 0.045)
  for (const dz of [-PHASE_SPREAD, 0, PHASE_SPREAD]) { // fuse cutouts
    b.beam('porcelain', [0.12, POLE_H - 0.42, dz], [0.18, POLE_H - 0.18, dz], 0.04)
    b.beam('steelDark', [0.18, POLE_H - 0.18, dz], [0.12, POLE_H - 0.44, dz * 0.9], 0.015)
  }
  return b.build()
}

/** Recloser: automatic circuit breaker on a pole, with its control cabinet below. */
export function buildRecloser(): Parts {
  const b = new Builder()
  poleBase(b)
  b.box('steelDark', [0.06, 0.06, 0.7], [0.18, 1.85, 0])
  b.box('tank', [0.32, 0.26, 0.62], [0.24, 1.97, 0])
  for (const dz of [-0.2, 0, 0.2]) b.insulator([0.24, 2.1, dz], 3, 0.04, 0.045)
  b.box('cabinet', [0.22, 0.4, 0.3], [0.14, 1.05, 0])
  b.box('band', [0.23, 0.04, 0.31], [0.14, 1.22, 0])
  b.beam('steelDark', [0.14, 1.27, 0], [0.2, 1.85, 0], 0.02)
  return b.build()
}

/** Gang-operated load-break switch (sectionalizer) on a pole. */
export function buildSectionalizer(): Parts {
  const b = new Builder()
  poleBase(b)
  b.box('steelDark', [0.06, 0.06, 0.95], [0.12, 2.0, 0])
  for (const dz of [-PHASE_SPREAD, 0, PHASE_SPREAD]) {
    b.insulator([0.12, 2.03, dz], 2, 0.04, 0.05)
    b.beam('copper', [0.12, 2.16, dz - 0.12], [0.12, 2.24, dz + 0.12], 0.025)
  }
  b.beam('steelDark', [0.08, 0.9, 0], [0.08, 2.0, 0], 0.02) // operating rod
  b.box('steelDark', [0.12, 0.05, 0.05], [0.12, 0.9, 0])
  return b.build()
}

/** Fuse cutouts protecting a lateral, on a pole. */
export function buildFusePole(): Parts {
  const b = new Builder()
  poleBase(b)
  b.box('steelDark', [0.06, 0.06, 0.9], [0.14, 1.95, 0])
  for (const dz of [-0.3, 0, 0.3]) {
    b.beam('porcelain', [0.14, 1.78, dz], [0.2, 2.1, dz], 0.045)
    b.beam('signInk', [0.2, 2.06, dz + 0.02], [0.15, 1.8, dz + 0.02], 0.02)
  }
  return b.build()
}

/** Pole-mounted capacitor bank: a rack of three cans. */
export function buildCapacitorBank(): Parts {
  const b = new Builder()
  b.cyl('concrete', 0.05, POLE_H, [0, POLE_H / 2, 0], 0.08, 10)
  b.box('steelDark', [0.5, 0.05, 0.6], [0.2, 1.45, 0])
  for (const dz of [-0.2, 0, 0.2]) {
    b.box('capacitor', [0.18, 0.4, 0.14], [0.22, 1.7, dz])
    b.insulator([0.22, 1.9, dz], 2, 0.035, 0.04)
  }
  b.box('cabinet', [0.2, 0.32, 0.26], [0.13, 0.95, 0])
  b.warning([0.24, 0.95, 0], 0.09, Math.PI / 2)
  return b.build()
}

/** Ground-mounted switching cabinet (ring main unit) on an underground cable route. */
export function buildGroundCabinet(): Parts {
  const b = new Builder()
  b.box('plinth', [0.9, 0.08, 0.6], [0, 0.04, 0])
  b.box('rmu', [0.8, 0.75, 0.5], [0, 0.45, 0])
  b.box('roof', [0.86, 0.05, 0.56], [0, 0.85, 0])
  b.box('steelDark', [0.02, 0.5, 0.36], [0.405, 0.42, 0])
  b.warning([0.42, 0.62, 0], 0.11, Math.PI / 2)
  return b.build()
}

/** Small yellow-topped marker post along an underground cable route. */
export function buildCableMarker(): Parts {
  const b = new Builder()
  b.cyl('concrete', 0.04, 0.3, [0, 0.15, 0], 0.05, 8)
  b.cyl('marker', 0.05, 0.06, [0, 0.31, 0], 0.05, 8)
  return b.build()
}

/** Ground-mounted solar array filling a w x d area (local origin at its corner). */
export function buildSolarArray(w: number, d: number): Parts {
  const b = new Builder()
  const rowGap = 0.75
  for (let z = 0.2; z < d - 0.4; z += rowGap) {
    for (let x = 0.2; x < w - 0.6; x += 0.62) {
      const g = new THREE.BoxGeometry(0.58, 0.03, 0.5)
      g.rotateX(-0.45)
      b.add('panel', g.translate(x + 0.29, 0.32, z + 0.25))
      b.box('panelFrame', [0.04, 0.3, 0.04], [x + 0.29, 0.15, z + 0.42])
    }
  }
  return b.build()
}

/* ---------------------------------------------------------------- cache */

const cache = new Map<string, Parts>()
const BUILDERS = {
  kiosk: buildKiosk, tower: buildTower, substation: buildSubstation, pole: buildPole, switchPole: buildSwitchPole,
  poleTransformer: buildPoleTransformer, recloser: buildRecloser, sectionalizer: buildSectionalizer,
  fusePole: buildFusePole, capacitorBank: buildCapacitorBank, groundCabinet: buildGroundCabinet,
  cableMarker: buildCableMarker,
}
export function model(name: keyof typeof BUILDERS): Parts {
  if (!cache.has(name)) {
    const build = BUILDERS[name]
    cache.set(name, build())
  }
  return cache.get(name)!
}
