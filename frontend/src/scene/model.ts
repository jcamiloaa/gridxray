import type { DeviceInfo, LineKind, ObservableScenario, Truth } from '../api/client'

/** Everything the 3D scene needs, independent of where it came from. */
export interface SceneNode {
  id: number
  name: string
  metered: boolean
  vm: number | null // measured voltage (pu); null = missing reading or no meter
  mount: 'kiosk' | 'pole'
  location: [number, number] | null
}

export type EdgeStatus = 'measured' | 'inferred' | 'proposed' | 'uncertain' | 'correct' | 'wrong'

export interface SceneEdge {
  from: number // upstream end (energy flows from -> to)
  to: number
  kind: LineKind
  status?: EdgeStatus // the AI's connections: how it got each one and, after comparing, whether it is right
  basis?: 'measured' | 'inferred' | 'proposed' | 'uncertain'
}

export interface SceneTie {
  a: number
  b: number
  closed: boolean
  kind: LineKind
}

/** Switching and protection equipment installed on a line section. */
export interface SceneEquipment {
  kind: 'recloser' | 'sectionalizer' | 'fuse'
  a: number
  b: number
  closed: boolean
}

export interface GridModel {
  substations: { id: number; name: string; location: [number, number] | null }[]
  nodes: SceneNode[]
  edges: SceneEdge[] // known connections; empty while the topology is hidden
  ties: SceneTie[]
  equipment: SceneEquipment[]
  devices: DeviceInfo[] // capacitors and PV plants: location known even when wiring is not
  feeder: Record<number, number> // node -> feeder index, for coloured zones
  topologyKnown: boolean
  missed?: [number, number][] // real connections the AI did not find (after comparing)
}

export function fromObservable(s: ObservableScenario): GridModel {
  return {
    substations: s.substations.map(({ id, name, location }) => ({ id, name, location: location ?? null })),
    nodes: s.nodes.map((n) => ({
      id: n.id, name: n.name, metered: n.metered, vm: s.readings[n.id]?.vm_pu ?? null, mount: n.mount ?? 'kiosk',
      location: n.location ?? null,
    })),
    edges: [],
    ties: [],
    equipment: [],
    devices: s.devices ?? [],
    feeder: {},
    topologyKnown: false,
  }
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** Full network from the ground truth; edges oriented away from the substations so flow animates correctly. */
export function fromTruth(s: ObservableScenario, truth: Truth): GridModel {
  const roots = s.substations.map((r) => r.id)
  const kindOf = new Map(truth.lines.map((l) => [pairKey(l.between[0], l.between[1]), l.kind]))
  // open points carry no power: drawn apart, dashed. Closed ties are ordinary energized sections.
  const tieLines = new Set(truth.switches.filter((w) => !w.closed).map((w) => pairKey(w.between[0], w.between[1])))
  const adjacency = new Map<number, number[]>()
  for (const [a, b] of truth.edges) {
    if (tieLines.has(pairKey(a, b))) continue // drawn as a tie, not a feeder span
    adjacency.set(a, [...(adjacency.get(a) ?? []), b])
    adjacency.set(b, [...(adjacency.get(b) ?? []), a])
  }
  const edges: SceneEdge[] = []
  const seen = new Set(roots)
  const queue = [...roots]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nxt of adjacency.get(cur) ?? []) {
      if (seen.has(nxt)) continue
      seen.add(nxt)
      edges.push({ from: cur, to: nxt, kind: kindOf.get(pairKey(cur, nxt)) ?? 'overhead' })
      queue.push(nxt)
    }
  }
  const feeder: Record<number, number> = {}
  for (const [k, v] of Object.entries(truth.feeder)) feeder[Number(k)] = v
  return {
    ...fromObservable(s),
    edges,
    // open points: tie switches, plus any other switch found open (e.g. a reconfigured sectionalizer)
    ties: truth.switches.filter((w) => !w.closed).map((w) => ({
      a: w.between[0], b: w.between[1], closed: w.closed, kind: kindOf.get(pairKey(w.between[0], w.between[1])) ?? 'overhead',
    })),
    equipment: truth.switches.filter((w) => w.closed).map((w) => ({
      kind: (w.kind === 'tie' ? 'sectionalizer' : w.kind) as SceneEquipment['kind'], a: w.between[0], b: w.between[1], closed: w.closed,
    })),
    feeder,
    topologyKnown: true,
  }
}

/** The public showcase already bundles the truth. */
export const fromShowcase = (s: ObservableScenario & { truth: Truth }) => fromTruth(s, s.truth)

/** What the investigation overlays on the network: the AI's current tree and its latest experiment. */
export interface Overlay {
  edges: { child: number; parent: number; status: EdgeStatus; basis?: 'measured' | 'inferred' | 'proposed' | 'uncertain' }[]
  missed?: [number, number][] // true connections the AI did not find (shown after reveal)
  focus?: { id?: number; node: number; drops: Record<number, number> } // last load experiment
  hub?: number // the substation next to the control center, where signals start
  // the utility's initial drawing, shown on request: (child, parent, real parent when the drawing is wrong and the truth is shown)
  plan?: { child: number; parent: number; real?: number; labels?: { plan: string; real: string } }[]
  // field crew on its way to / working at a site ("dispatch crew")
  // what you changed in the field during the run, shown where it happened
  // count: on the first substation of an outage, how many were left without supply
  incidents?: { id: string; node: number; kind: 'meter' | 'switch' | 'outage'; label: string; state?: 'open' | 'closed'; count?: number }[]
  crew?: { visit: number; node: number; name: string; from?: number; stage: 'photo' | 'segment' | 'read' | 'done'; outdated?: boolean }
  /** Differences view after comparing: the AI's tree drawn on the streets, coloured by outcome, with node rings. */
  diff?: {
    highlight: DiffKind | null // isolate one outcome; the others fade
    notes: { node: number; ai: string; real: string }[] // wrong parents, labelled in the scene
    words: { ai: string; real: string } // translated labels for those notes
  }
}

export type DiffKind = 'correct' | 'wrong' | 'missed'

/** A model whose edges are the AI's hypothesis, for the single-line diagram. */
export function withHypothesis(model: GridModel, overlay: Overlay): GridModel {
  return {
    ...model,
    edges: overlay.edges.map((e) => ({ from: e.parent, to: e.child, kind: 'overhead' as const, status: e.status, basis: e.basis ?? (e.status === 'correct' || e.status === 'wrong' ? undefined : e.status) })),
    missed: overlay.missed,
    ties: [],
    equipment: [],
    topologyKnown: true,
  }
}
