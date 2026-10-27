// Hero backdrop: a procedural city map (ring roads, radial streets, perimeter blocks) where HV/MV
// substations keep energising feeders street by street, lighting the buildings they supply. Feeders
// grow, hold, fade and free their streets for the next one, so the network never stops changing.
// The city is drawn once to an offscreen canvas; each frame only paints the energised overlay.
import { useEffect, useRef } from 'react'

type P = [number, number]

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

interface Seg { id: number; a: number; b: number; pts: P[]; len: number }
interface Building { poly: P[]; seg: number; shade: number; lit: number }
interface City {
  w: number; h: number; segs: Seg[]; buildings: Building[]
  /** subs[0] is the permanent main substation. */
  adj: Map<number, { seg: number; to: number }[]>; subs: number[]; nodes: P[]; bySeg: Map<number, number[]>
}

function buildCity(w: number, h: number, seed: number): City {
  const r = rng(seed)
  // The old-town centre sits below the fold, so ring roads sweep across the hero as curves.
  const cx = w * 0.44
  const cy = h * 1.18
  const maxR = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy)) + 40
  // Smooth displacement so the polar grid reads as an old city, not a dartboard.
  const warp = (rad: number, ang: number): P => {
    const wob = rad * (1 + 0.035 * Math.sin(3 * ang + 1.1) + 0.02 * Math.sin(7 * ang + 0.4))
    const x = cx + Math.cos(ang) * wob
    const y = cy + Math.sin(ang) * wob * 0.92
    return [x + Math.sin(y * 0.0026 + 1.3) * 30 + Math.sin(y * 0.009) * 6, y + Math.cos(x * 0.0023 + 0.6) * 30 + Math.cos(x * 0.008) * 6]
  }

  const rings: number[] = [46]
  while (rings[rings.length - 1] < maxR) rings.push(rings[rings.length - 1] + 52 + r() * 46)
  const bands = rings.length - 1
  const na: number[] = []
  let n = 8
  for (let b = 0; b < bands; b++) {
    const mid = (rings[b] + rings[b + 1]) / 2
    while ((2 * Math.PI * mid) / n > 150) n *= 2
    na.push(n)
  }
  const ringCount = (i: number) => na[Math.min(i, bands - 1)]
  const rot = r() * Math.PI * 2
  const angle = (i: number, k: number) => rot + (k / ringCount(i)) * Math.PI * 2

  const nodeId = new Map<string, number>()
  const nodes: P[] = []
  const nodeAt = (i: number, k: number) => {
    const key = `${i}:${k % ringCount(i)}`
    let id = nodeId.get(key)
    if (id === undefined) {
      id = nodes.length
      nodes.push(warp(rings[i], angle(i, k)))
      nodeId.set(key, id)
    }
    return id
  }

  const segs: Seg[] = []
  const adj = new Map<number, { seg: number; to: number }[]>()
  const addSeg = (a: number, b: number, pts: P[]) => {
    let len = 0
    for (let q = 1; q < pts.length; q++) len += Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1])
    const s = { id: segs.length, a, b, pts, len }
    segs.push(s)
    for (const [x, y] of [[a, b], [b, a]]) adj.set(x, [...(adj.get(x) ?? []), { seg: s.id, to: y }])
    return s.id
  }
  const ringSeg = new Map<string, number>()
  for (let i = 0; i <= bands; i++) {
    const m = ringCount(i)
    for (let k = 0; k < m; k++) {
      const a0 = angle(i, k)
      const a1 = angle(i, k + 1)
      const pts: P[] = []
      for (let q = 0; q <= 6; q++) pts.push(warp(rings[i], a0 + ((a1 - a0) * q) / 6))
      ringSeg.set(`${i}:${k}`, addSeg(nodeAt(i, k), nodeAt(i, k + 1), pts))
    }
  }
  const radSeg = new Map<string, number>()
  for (let b = 0; b < bands; b++) {
    const f = ringCount(b + 1) / na[b]
    for (let k = 0; k < na[b]; k++) {
      const a = angle(b, k)
      const pts: P[] = []
      for (let q = 0; q <= 4; q++) pts.push(warp(rings[b] + ((rings[b + 1] - rings[b]) * q) / 4, a))
      radSeg.set(`${b}:${k}`, addSeg(nodeAt(b, k), nodeAt(b + 1, k * f), pts))
    }
  }

  // Perimeter blocks: lots along each edge of every cell, each facing (and supplied from) its street.
  const buildings: Building[] = []
  const quad = (r0: number, r1: number, a0: number, a1: number): P[] => [warp(r0, a0), warp(r0, a1), warp(r1, a1), warp(r1, a0)]
  const shade = () => 0.85 + r() * 0.3
  for (let b = 0; b < bands; b++) {
    const f = ringCount(b + 1) / na[b]
    const major = (i: number) => i % 4 === 2
    for (let k = 0; k < na[b]; k++) {
      const gIn = major(b) ? 9 : 4.5
      const gOut = major(b + 1) ? 9 : 4.5
      const r0 = rings[b] + gIn
      const r1 = rings[b + 1] - gOut
      const mid = (r0 + r1) / 2
      const ga = 4.5 / mid
      const a0 = angle(b, k) + ga
      const a1 = angle(b, k + 1) - ga
      const kind = r()
      if (kind < 0.05) continue // park
      if (kind < 0.13) { // large single building (depot, school, factory)
        const inset = (r1 - r0) * (0.12 + r() * 0.15)
        const ai = (a1 - a0) * (0.1 + r() * 0.15)
        buildings.push({ poly: quad(r0 + inset, r1 - inset, a0 + ai, a1 - ai), seg: radSeg.get(`${b}:${k}`)!, shade: shade(), lit: 0 })
        continue
      }
      const depth = () => 8 + r() * 15
      // outer edge
      for (let a = a0; a < a1;) {
        const wA = (8 + r() * 24) / r1
        const e = Math.min(a + wA, a1)
        const seg = ringSeg.get(`${b + 1}:${Math.min(f - 1, Math.floor(((a - a0) / (a1 - a0)) * f)) + k * f}`)!
        if (r() > 0.1) buildings.push({ poly: quad(r1 - depth(), r1, a, e - 1.6 / r1), seg, shade: shade(), lit: 0 })
        a = e
      }
      // inner edge
      for (let a = a0; a < a1;) {
        const wA = (8 + r() * 24) / r0
        const e = Math.min(a + wA, a1)
        if (r() > 0.1) buildings.push({ poly: quad(r0, r0 + depth(), a, e - 1.6 / r0), seg: ringSeg.get(`${b}:${k}`)!, shade: shade(), lit: 0 })
        a = e
      }
      // radial sides
      const d0 = 20
      for (const [side, seg] of [[a0, radSeg.get(`${b}:${k}`)!], [a1, radSeg.get(`${b}:${(k + 1) % na[b]}`)!]] as [number, number][]) {
        for (let rr = r0 + d0; rr < r1 - d0;) {
          const e = Math.min(rr + 9 + r() * 14, r1 - d0)
          const dA = depth() / rr
          if (r() > 0.15) buildings.push({ poly: side === a0 ? quad(rr, e - 1.6, a0, a0 + dA) : quad(rr, e - 1.6, a1 - dA, a1), seg, shade: shade(), lit: 0 })
          rr = e
        }
      }
    }
  }
  // Keep only what can be seen.
  const vis = buildings.filter((bd) => bd.poly.some(([x, y]) => x > -20 && x < w + 20 && y > -20 && y < h + 20))
  const bySeg = new Map<number, number[]>()
  vis.forEach((bd, i) => bySeg.set(bd.seg, [...(bySeg.get(bd.seg) ?? []), i]))

  // Main substation just below the call-to-action, two more out on the flanks.
  const nearest = ([tx, ty]: P) => {
    let best = 0
    let d = Infinity
    nodes.forEach(([x, y], i) => {
      const e = Math.hypot(x - tx, y - ty)
      if (e < d) { d = e; best = i }
    })
    return best
  }
  const subs = [nearest([w * 0.5, h * 0.86])]
  return { w, h, segs, buildings: vis, adj, subs, nodes, bySeg }
}

interface Live { seg: Seg; from: number; t0: number; dur: number; dist0: number; lit: [number, number][] }
interface Tip { node: number; t: number; dist: number }
interface Feeder { sub: Sub; tips: Tip[]; segs: Live[]; nodes: number[]; budget: number; endAt: number | null }
/** A substation; secondary ones appear, run a few feeders and disappear once those have faded. */
interface Sub { node: number; born: number; main: boolean; feedersLeft: number; goneAt: number | null }

const SPEED = 150 // px of cable energised per second
const HOLD = 6 // seconds a finished feeder stays energised
const FADE = 2.2
const MAX_FEEDERS = 6
const MAX_SECONDARY = 3
const SUB_FADE = 1.2

/**
 * Endless feeder simulation on the street graph. Feeders stay radial (never share a node) and,
 * once faded, release their streets so later feeders can take different routes.
 */
function makeSim(city: City, seed: number) {
  const r = rng(seed)
  const used = new Set<number>(city.subs)
  const feeders: Feeder[] = []
  const subs: Sub[] = [{ node: city.subs[0], born: -10, main: true, feedersLeft: Infinity, goneAt: null }]
  const cx = city.w / 2
  // Keep energy away from the headline block and inside the frame.
  const ok = (n: number) => {
    const [x, y] = city.nodes[n]
    // On narrow screens the copy spans the full width, so only the area below it is free.
    const clearOfCopy = y > city.h * 0.64 || (city.w > 900 && Math.abs(x - cx) > Math.min(460, city.w * 0.36))
    return clearOfCopy && x > -60 && x < city.w + 60 && y > city.h * 0.18 && y < city.h + 60
  }
  let nextSpawn = 0.2
  let nextSub = 1.5
  // Where a secondary substation may appear: open streets, clear of the copy and of other yards.
  const sites = city.nodes.map((_, i) => i).filter((n) => ok(n) && (city.adj.get(n)?.length ?? 0) >= 3)

  const placeSub = (t: number) => {
    const free = sites.filter((n) => !used.has(n) && subs.every((s) => {
      const [x, y] = city.nodes[n]
      const [sx, sy] = city.nodes[s.node]
      return Math.hypot(x - sx, y - sy) > 260
    }) && (city.adj.get(n) ?? []).every((e) => !used.has(e.to)))
    if (!free.length) return
    const node = free[Math.floor(r() * free.length)]
    used.add(node)
    subs.push({ node, born: t, main: false, feedersLeft: 1 + Math.floor(r() * 3), goneAt: null })
  }

  const spawn = (t: number) => {
    // Prefer fresh secondary substations so every new yard visibly starts its own run.
    const order = [...subs.filter((s) => s.goneAt === null && s.feedersLeft > 0)].sort((a, b) => Number(a.main) - Number(b.main) || r() - 0.5)
    for (const sub of order) {
      if (t - sub.born < 0.8) continue // let it appear first
      const free = (city.adj.get(sub.node) ?? []).filter((e) => !used.has(e.to) && ok(e.to))
      if (!free.length) continue
      sub.feedersLeft--
      feeders.push({ sub, tips: [{ node: sub.node, t, dist: 0 }], segs: [], nodes: [], budget: 16 + Math.floor(r() * 22), endAt: null })
      return
    }
  }

  const extend = (f: Feeder, tip: Tip) => {
    const options = (city.adj.get(tip.node) ?? []).filter((e) => !used.has(e.to) && ok(e.to)).sort(() => r() - 0.5)
    const branches = tip.node === f.sub.node ? 1 : r() < 0.3 ? 2 : 1
    for (const e of options.slice(0, branches)) {
      if (f.budget <= 0) break
      f.budget--
      used.add(e.to)
      f.nodes.push(e.to)
      const seg = city.segs[e.seg]
      const dur = seg.len / SPEED
      const lit: [number, number][] = []
      for (const bi of city.bySeg.get(seg.id) ?? []) if (r() < 0.8) lit.push([bi, tip.t + dur * (0.25 + r() * 0.75)])
      f.segs.push({ seg, from: tip.node, t0: tip.t, dur, dist0: tip.dist, lit })
      f.tips.push({ node: e.to, t: tip.t + dur, dist: tip.dist + seg.len })
    }
  }

  /** Advances the simulation to time t. */
  const step = (t: number) => {
    if (t >= nextSub && subs.filter((s) => !s.main).length < MAX_SECONDARY) {
      placeSub(t)
      nextSub = t + 3 + r() * 4
    }
    const growing = feeders.filter((f) => f.endAt === null).length
    if (t >= nextSpawn && feeders.length < MAX_FEEDERS && growing < 3) {
      spawn(t)
      nextSpawn = t + 1.4 + r() * 2.2
    }
    for (const f of feeders) {
      if (f.endAt !== null) continue
      const due = f.tips.filter((tp) => tp.t <= t)
      f.tips = f.tips.filter((tp) => tp.t > t)
      for (const tp of due) extend(f, tp)
      if (!f.tips.length) {
        const last = Math.max(t, ...f.segs.map((l) => l.t0 + l.dur))
        f.endAt = last + HOLD + r() * 3
      }
    }
    for (let i = feeders.length - 1; i >= 0; i--) {
      const f = feeders[i]
      if (f.endAt !== null && t > f.endAt + FADE) {
        f.nodes.forEach((n) => used.delete(n))
        feeders.splice(i, 1)
      }
    }
    // A secondary substation leaves once its run is over and its feeders have faded.
    for (let i = subs.length - 1; i >= 0; i--) {
      const s = subs[i]
      if (s.main) continue
      if (s.goneAt === null && s.feedersLeft === 0 && !feeders.some((f) => f.sub === s)) s.goneAt = t
      else if (s.goneAt === null && t - s.born > 6 && !feeders.some((f) => f.sub === s)) {
        // Boxed in by other feeders: give up quietly.
        if (!(city.adj.get(s.node) ?? []).some((e) => !used.has(e.to) && ok(e.to))) s.goneAt = t
      }
      if (s.goneAt !== null && t > s.goneAt + SUB_FADE) {
        used.delete(s.node)
        subs.splice(i, 1)
      }
    }
  }
  return { feeders, subs, step }
}

/** Points of a segment oriented away from the substation. */
const oriented = (l: Live) => (l.seg.a === l.from ? l.seg.pts : [...l.seg.pts].reverse())

function pointAt(pts: P[], s: number): P {
  for (let q = 1; q < pts.length; q++) {
    const d = Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1])
    if (s <= d) { const u = s / d; return [pts[q - 1][0] + (pts[q][0] - pts[q - 1][0]) * u, pts[q - 1][1] + (pts[q][1] - pts[q - 1][1]) * u] }
    s -= d
  }
  return pts[pts.length - 1]
}

function strokePartial(ctx: CanvasRenderingContext2D, pts: P[], upTo: number) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  let s = 0
  for (let q = 1; q < pts.length; q++) {
    const d = Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1])
    if (s + d >= upTo) {
      const p = pointAt(pts, upTo)
      ctx.lineTo(p[0], p[1])
      break
    }
    ctx.lineTo(pts[q][0], pts[q][1])
    s += d
  }
  ctx.stroke()
}

const fillPoly = (ctx: CanvasRenderingContext2D | Path2D, poly: P[]) => {
  ctx.moveTo(poly[0][0], poly[0][1])
  for (let q = 1; q < poly.length; q++) ctx.lineTo(poly[q][0], poly[q][1])
  ctx.closePath()
}

const BG = '#0b0b0d'
const AMBER = '255, 138, 61'

export function HeroCity() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let city: City | undefined // set by setup() once the canvas has a size
    let base: HTMLCanvasElement
    let sim: ReturnType<typeof makeSim>
    let clock = 0 // simulated seconds; advances in small steps so a hidden tab never causes a burst
    let lastFrame = 0
    let raf = 0
    let dpr = 1

    const setup = () => {
      const { width, height } = el.getBoundingClientRect()
      if (!width || !height) return
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.width = Math.round(width * dpr)
      el.height = Math.round(height * dpr)
      city = buildCity(width, height, 7)
      base = document.createElement('canvas')
      base.width = el.width
      base.height = el.height
      const b = base.getContext('2d')!
      b.scale(dpr, dpr)
      b.fillStyle = BG
      b.fillRect(0, 0, width, height)
      b.strokeStyle = 'rgba(255, 240, 225, 0.045)'
      b.lineWidth = 1
      for (const s of city.segs) {
        if (!s.pts.some(([x, y]) => x > -40 && x < width + 40 && y > -40 && y < height + 40)) continue
        b.beginPath()
        s.pts.forEach(([x, y], q) => (q ? b.lineTo(x, y) : b.moveTo(x, y)))
        b.stroke()
      }
      // Buildings in a few warm graphite shades so the texture reads as a real map.
      for (const sh of [0.86, 0.95, 1.04, 1.13]) {
        b.beginPath()
        for (const bd of city.buildings) if (Math.abs(bd.shade - sh) < 0.0451) fillPoly(b, bd.poly)
        b.fillStyle = `hsl(30 5% ${Math.round(12 * sh)}%)`
        b.fill()
      }
      sim = makeSim(city, 101)
      clock = 0
      // Start mid-story: the first frame already shows a living network.
      for (let t = 0; t < (still ? 14 : 7); t += 0.1) { clock = t; sim.step(t) }
    }

    const render = (c: City, t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(base, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const fadeOf = (f: Feeder) => (f.endAt === null ? 1 : 1 - Math.min(1, Math.max(0, (t - f.endAt) / FADE)))

      // Supplied buildings, batched into a few alpha levels so each frame is a handful of fills.
      const levels: Path2D[] = Array.from({ length: 8 }, () => new Path2D())
      const used = new Set<number>()
      for (const f of sim.feeders) {
        const fade = fadeOf(f)
        for (const l of f.segs) for (const [bi, tl] of l.lit) {
          const k = Math.min(1, Math.max(0, (t - tl) / 0.7)) * fade
          if (k <= 0) continue
          const bd = c.buildings[bi]
          const lv = Math.min(7, Math.floor((0.35 + 0.65 * (bd.shade - 0.85) / 0.3) * k * 8))
          fillPoly(levels[lv], bd.poly)
          used.add(lv)
        }
      }
      for (const lv of used) {
        ctx.fillStyle = `rgba(${AMBER}, ${0.1 + (lv / 7) * 0.48})`
        ctx.fill(levels[lv])
      }
      // Feeder cables: soft halo + hot core, growing out of the substation.
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const f of sim.feeders) {
        const fade = fadeOf(f)
        for (const [wid, col] of [[5, `rgba(${AMBER}, ${0.13 * fade})`], [1.4, `rgba(255, 186, 130, ${0.92 * fade})`]] as [number, string][]) {
          ctx.lineWidth = wid
          ctx.strokeStyle = col
          for (const l of f.segs) {
            const u = (t - l.t0) / l.dur
            if (u > 0) strokePartial(ctx, oriented(l), Math.min(1, u) * l.seg.len)
          }
        }
        // Growing heads, then energy flowing outwards along finished cable.
        ctx.fillStyle = `rgba(255, 241, 227, ${0.9 * fade})`
        for (const l of f.segs) {
          const u = (t - l.t0) / l.dur
          if (u <= 0) continue
          const pts = oriented(l)
          if (u < 1) { const p = pointAt(pts, u * l.seg.len); ctx.beginPath(); ctx.arc(p[0], p[1], 2.6, 0, 7); ctx.fill(); continue }
          for (let s = ((t * 55 - l.dist0) % 64 + 64) % 64; s < l.seg.len; s += 64) {
            const p = pointAt(pts, s)
            ctx.beginPath(); ctx.arc(p[0], p[1], 1.3, 0, 7); ctx.fill()
          }
        }
      }
      // Substations: violet yards with a slow pulse; secondary ones grow in and fade out.
      sim.subs.forEach((s, i) => {
        const [sx, sy] = c.nodes[s.node]
        const inK = Math.min(1, Math.max(0, (t - s.born) / 0.6))
        const outK = s.goneAt === null ? 1 : 1 - Math.min(1, (t - s.goneAt) / SUB_FADE)
        const a = inK * outK
        if (a <= 0) return
        const grow = 0.6 + 0.4 * (1 - (1 - inK) ** 3)
        const pulse = still ? 0 : ((t + i * 0.8) % 2.6) / 2.6
        ctx.globalAlpha = a
        ctx.strokeStyle = `rgba(167, 139, 250, ${0.55 * (1 - pulse)})`
        ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.arc(sx, sy, (10 + pulse * 26) * grow, 0, 7); ctx.stroke()
        if (!s.main && inK < 1) { // arrival flash
          ctx.strokeStyle = `rgba(196, 181, 253, ${0.8 * (1 - inK)})`
          ctx.beginPath(); ctx.arc(sx, sy, 6 + inK * 40, 0, 7); ctx.stroke()
        }
        ctx.fillStyle = '#a78bfa'
        ctx.fillRect(sx - 7 * grow, sy - 5 * grow, 14 * grow, 10 * grow)
        ctx.fillStyle = BG
        ctx.fillRect(sx - 4 * grow, sy - 2 * grow, 3 * grow, 4 * grow)
        ctx.fillRect(sx + 1 * grow, sy - 2 * grow, 3 * grow, 4 * grow)
        ctx.font = '500 10px "IBM Plex Mono", monospace'
        ctx.fillStyle = 'rgba(196, 181, 253, 0.9)'
        ctx.fillText(s.main ? 'SS-01 · 110/20 kV' : `SS-${String(2 + (s.node % 37)).padStart(2, '0')}`, sx + 14, sy + 4)
        ctx.globalAlpha = 1
      })
    }

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw)
      if (!city || nowMs - lastFrame < 30) return
      const dt = lastFrame ? Math.min(0.1, (nowMs - lastFrame) / 1000) : 0
      lastFrame = nowMs
      clock += dt
      sim.step(clock)
      render(city, clock)
    }

    setup()
    if (still) { if (city) render(city, clock) } else raf = requestAnimationFrame(draw)
    let timer = 0
    const onResize = () => { clearTimeout(timer); timer = window.setTimeout(() => { setup(); if (still && city) render(city, clock) }, 150) }
    window.addEventListener('resize', onResize)
    // Pause while the hero is off screen.
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf)
      lastFrame = 0
      if (e.isIntersecting && !still) raf = requestAnimationFrame(draw)
    })
    io.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      io.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas ref={canvas} className="lx-hero__city" aria-hidden="true" />
}
