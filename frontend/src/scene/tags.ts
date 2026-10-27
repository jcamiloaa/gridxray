import type { GridModel } from './model'

/** Equipment tags shared by the 3D view and the single-line diagram, so both name things alike. */
export interface Tags {
  transformer: Map<number, string> // substation id -> TR-n
  feeders: { head: number; root: number; tag: string }[] // feeder heads in drawing order
  feederOf: Map<number, string> // node -> F-n
  ties: { a: number; b: number; tag: string; closed: boolean }[]
  reclosers: { a: number; b: number; tag: string }[]
  devices: Map<number, string> // device id -> CAP-n / PV-n
}

export function equipmentTags(model: GridModel): Tags {
  const transformer = new Map(model.substations.map((s, i) => [s.id, `TR-${i + 1}`]))
  const roots = new Set(model.substations.map((s) => s.id))
  const children = new Map<number, number[]>()
  for (const e of model.edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to])
  const feeders: Tags['feeders'] = []
  const feederOf = new Map<number, string>()
  for (const s of model.substations) {
    for (const head of children.get(s.id) ?? []) {
      const tag = `F${feeders.length + 1}`
      feeders.push({ head, root: s.id, tag })
      const stack = [head]
      while (stack.length) {
        const n = stack.pop()!
        feederOf.set(n, tag)
        for (const k of children.get(n) ?? []) if (!roots.has(k)) stack.push(k)
      }
    }
  }
  const ties = model.ties.map((t, i) => ({ ...t, tag: `NO-${i + 1}` }))
  const reclosers = model.equipment.filter((e) => e.kind === 'recloser').map((e, i) => ({ a: e.a, b: e.b, tag: `RC-${i + 1}` }))
  const devices = new Map<number, string>()
  let cap = 0
  let pv = 0
  for (const d of model.devices) devices.set(d.id, d.kind === 'capacitor' ? `CAP-${++cap}` : `PV-${++pv}`)
  return { transformer, feeders, feederOf, ties, reclosers, devices }
}
