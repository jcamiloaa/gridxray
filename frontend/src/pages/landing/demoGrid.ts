import type { GridModel } from '../../scene/model'

/**
 * The landing explorer's network: one HV/MV substation, one feeder branching to three secondary
 * substations, and a normally open tie closing the loop. Small enough to read at a glance; the
 * substations sit two blocks apart (locations are [column, row]) so every callout has room.
 */
export const DEMO_GRID: GridModel = {
  substations: [{ id: 0, name: 'Substation', location: [0, 0] }],
  nodes: [
    { id: 1, name: 'SS-01', metered: true, vm: 0.993, mount: 'kiosk', location: [0, 0] },
    { id: 2, name: 'SS-02', metered: true, vm: 0.986, mount: 'kiosk', location: [2, 0] },
    { id: 3, name: 'SS-03', metered: true, vm: 0.958, mount: 'kiosk', location: [0, 2] },
  ],
  edges: [
    { from: 0, to: 1, kind: 'overhead' },
    { from: 1, to: 2, kind: 'overhead' },
    { from: 1, to: 3, kind: 'overhead' },
  ],
  // routed from SS-03 east, then north to SS-02, so it never runs over the feeder
  ties: [{ a: 3, b: 2, closed: false, kind: 'overhead' }],
  equipment: [],
  devices: [],
  feeder: { 1: 0, 2: 0, 3: 0 },
  topologyKnown: true,
}
