import { KOFF, PX, PZ, SUB_X, type Vec2 } from './layout'

export const SPEED = 7 // world units per second along the streets
export const LANE = 0.55 // drive on the kiosk's side of the street

/** Street route from the substation yard to the kerb in front of the site: east, then north/south, then east. */
export function streetPath(from: Vec2 | undefined, site: Vec2): Vec2[] {
  const col = Math.round((site[0] - KOFF) / PX)
  const row = Math.round((site[1] - KOFF) / PZ)
  const kerbZ = row * PZ + LANE // the street just north of the site's block corner
  const startRow = from ? Math.round((from[1] - KOFF) / PZ) : row
  const startZ = startRow * PZ + LANE
  const startX = (from?.[0] ?? SUB_X) + 2.4
  const pts: Vec2[] = [[startX, startZ], [col * PX - LANE, startZ], [col * PX - LANE, kerbZ], [site[0] + 0.2, kerbZ]]
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-3)
}

export function along(path: Vec2[], dist: number): { at: Vec2; heading: number; done: boolean } {
  let left = dist
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1]
    const [bx, bz] = path[i]
    const len = Math.hypot(bx - ax, bz - az)
    const heading = Math.atan2(bx - ax, bz - az)
    if (left <= len) return { at: [ax + ((bx - ax) * left) / len, az + ((bz - az) * left) / len], heading, done: false }
    left -= len
  }
  const [ax, az] = path[path.length - 2] ?? path[0]
  const [bx, bz] = path[path.length - 1]
  return { at: [bx, bz], heading: Math.atan2(bx - ax, bz - az), done: true }
}
