import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  field, getSeal, getTruth, resumeRun, startInvestigation, stopRun, streamInvestigation, type CandidateEdge, type ObservableScenario, type RunEvent,
  type RunScore, type ScenarioSource,
} from '../api/client'
import type { Overlay } from '../scene/model'

export type RunStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

/** Outcome of re-checking, in this browser, the commitment published before the run. */
export type SealCheck = { state: 'checking' } | { state: 'ok' | 'bad'; commitment: string; recomputed: string; edgesMatch: boolean } | { state: 'unavailable'; reason: string }

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** Starts an investigation, follows its event stream and turns it into a scene overlay. */
export function useInvestigation(scenario: ObservableScenario | null, generated: { source: ScenarioSource; seed: number } | null) {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [edges, setEdges] = useState<CandidateEdge[]>([])
  const [focus, setFocus] = useState<Overlay['focus']>()
  const [crew, setCrew] = useState<Overlay['crew']>()
  const [incidents, setIncidents] = useState<NonNullable<Overlay['incidents']>>([])
  const [score, setScore] = useState<RunScore | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [truthEdges, setTruthEdges] = useState<[number, number][] | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [seal, setSeal] = useState<SealCheck | null>(null)
  const close = useRef<() => void>(() => {})

  const idOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of scenario?.nodes ?? []) m.set(n.name, n.id)
    for (const s of scenario?.substations ?? []) m.set(s.name, s.id)
    return m
  }, [scenario])
  const rootId = scenario?.substations[0]?.id
  const nameOf = useMemo(() => new Map([...idOf].map(([k, v]) => [v, k])), [idOf])

  // a new grid resets everything
  useEffect(() => {
    close.current()
    setStatus('idle'); setEvents([]); setEdges([]); setFocus(undefined); setCrew(undefined); setIncidents([]); setScore(null); setError(null); setTruthEdges(null); setSeal(null)
  }, [scenario])
  useEffect(() => () => close.current(), [])

  const onEvent = useCallback((e: RunEvent) => {
    setEvents((list) => [...list, e])
    if (e.kind === 'candidate') setEdges(e.edges as CandidateEdge[])
    if (e.kind === 'experiment' && e.accepted) {
      const args = e.args as { kind: string; node?: string }
      const drops = (e.drop_pu_per_mw ?? {}) as Record<string, number>
      if (args.kind === 'perturb_load' && args.node && idOf.has(args.node)) {
        setFocus({ node: idOf.get(args.node)!, drops: Object.fromEntries(Object.entries(drops).map(([k, v]) => [idOf.get(k) ?? -1, v])) })
      }
    }
    // the field crew drives to the site and works there while the photo, SAM and the reading run
    if (e.kind === 'crew_dispatched' && idOf.has(String(e.node))) {
      setCrew({ visit: Number(e.visit), node: idOf.get(String(e.node))!, name: String(e.node), from: rootId, stage: 'photo' })
    }
    if (e.kind === 'intervention') { // show the event where it happened: arc at the switch, smoke at the meter
      const sws = (e.switches ?? []) as { id: number; closed: boolean; between: string[] }[]
      const off = (e.meters_off ?? []) as string[]
      const add: NonNullable<Overlay['incidents']> = [
        ...sws.flatMap((w) => {
          const site = [...w.between].reverse().find((n) => idOf.has(n) && n !== 'Substation')
          return site ? [{ id: `${e.t}-sw${w.id}`, node: idOf.get(site)!, kind: 'switch' as const, label: `SW-${w.id}`, state: (w.closed ? 'closed' : 'open') as 'open' | 'closed' }] : []
        }),
        ...off.filter((n) => idOf.has(n)).map((n) => ({ id: `${e.t}-m${n}`, node: idOf.get(n)!, kind: 'meter' as const, label: n })),
      ]
      setIncidents((list) => [...list, ...add])
    }
    if (e.kind === 'crew_stage') {
      setCrew((c) => (c && c.visit === Number(e.visit) ? { ...c, stage: e.stage as 'photo' | 'segment' | 'read' } : c))
    }
    if (e.kind === 'field_reading') {
      const outdated = String(e.record_check ?? '').startsWith('RECORD OUTDATED')
      setCrew((c) => (c && c.visit === Number(e.visit) ? { ...c, stage: 'done', outdated } : c))
    }
    if (e.kind === 'experiment' || (e.kind === 'error' && String(e.message ?? '').startsWith('Field visit'))) setCrew(undefined)
    if (e.kind === 'done') {
      setStatus(e.status === 'done' || e.status === 'stopped' ? e.status : 'failed')
      setScore((e.score as RunScore) ?? null)
      setFocus(undefined)
      setCrew(undefined)
    }
  }, [idOf, rootId])

  const start = useCallback(async (budget: number, language = 'en') => {
    if (!generated) return
    close.current()
    setEvents([]); setEdges([]); setFocus(undefined); setCrew(undefined); setIncidents([]); setScore(null); setError(null); setTruthEdges(null); setSeal(null)
    try {
      const { id } = await startInvestigation(generated.source, generated.seed, budget, language)
      setRunId(id)
      setStatus('running')
      close.current = streamInvestigation(id, onEvent, () => setError('Lost the live connection to the investigation.'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('idle')
    }
  }, [generated, onEvent])

  /** Follow a run that is already going (e.g. after a page reload). */
  const attach = useCallback((id: string) => {
    close.current()
    setEvents([]); setEdges([]); setFocus(undefined); setCrew(undefined); setIncidents([]); setScore(null); setError(null); setTruthEdges(null); setSeal(null)
    setRunId(id)
    setStatus('running')
    close.current = streamInvestigation(id, onEvent, () => setError('Lost the live connection to the investigation.'))
  }, [onEvent])

  const stop = useCallback(async () => { if (runId) await stopRun(runId) }, [runId])
  const resume = useCallback(async () => {
    if (!runId) return
    try {
      await resumeRun(runId)
      attach(runId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [runId, attach])

  /** Reveal & compare: colour every proposed connection by whether it really exists. */
  const compare = useCallback(async () => {
    if (!generated) return
    // the run's own truth includes any change you made in the field; the seal covers the network at the start
    const fromRun = runId ? await field.truth(runId).catch(() => null) : null
    const truth = fromRun?.truth ?? (await getTruth(generated.source, generated.seed)).truth
    const sealedAgainst = fromRun?.initial_edges ?? truth.edges
    setTruthEdges(truth.edges)
    // the commitment came in the first event, before the AI saw anything; the secret is revealed only now
    const published = events.find((e) => e.kind === 'sealed')?.commitment as string | undefined
    if (!runId || !published) { setSeal({ state: 'unavailable', reason: 'This investigation predates sealing.' }); return }
    if (!globalThis.crypto?.subtle) { setSeal({ state: 'unavailable', reason: 'This browser cannot compute SHA-256 here (needs HTTPS or localhost).' }); return }
    setSeal({ state: 'checking' })
    try {
      const s = await getSeal(runId)
      const recomputed = await sha256(s.nonce + s.canonical)
      const key = (e: number[]) => pairKey(e[0], e[1])
      const sealed = new Set((JSON.parse(s.canonical).edges as number[][]).map(key))
      const edgesMatch = sealed.size === sealedAgainst.length && sealedAgainst.every((e) => sealed.has(key(e)))
      setSeal({ state: recomputed === published && edgesMatch ? 'ok' : 'bad', commitment: published, recomputed, edgesMatch })
    } catch (e) {
      setSeal({ state: 'unavailable', reason: e instanceof Error ? e.message : String(e) })
    }
  }, [generated, events, runId])

  const overlay = useMemo<Overlay | undefined>(() => {
    if (!edges.length) return crew || incidents.length ? { edges: [], crew, incidents } : undefined
    if (truthEdges) {
      const real = new Set(truthEdges.map(([a, b]) => pairKey(a, b)))
      const proposed = new Set(edges.map((e) => pairKey(e.child, e.parent)))
      return {
        edges: edges.map((e) => ({ child: e.child, parent: e.parent, status: real.has(pairKey(e.child, e.parent)) ? 'correct' : 'wrong', basis: e.basis })),
        missed: truthEdges.filter(([a, b]) => !proposed.has(pairKey(a, b))),
        incidents,
      }
    }
    return { edges: edges.map((e) => ({ child: e.child, parent: e.parent, status: e.basis })), focus, crew, incidents }
  }, [edges, focus, crew, incidents, truthEdges])

  /** Found vs real, node by node: the AI's proposed parent against the true one. */
  const comparison = useMemo(() => {
    if (!truthEdges || !edges.length || !scenario) return null
    const adj = new Map<number, number[]>()
    for (const [a, b] of truthEdges) {
      adj.set(a, [...(adj.get(a) ?? []), b])
      adj.set(b, [...(adj.get(b) ?? []), a])
    }
    const realParent = new Map<number, number>()
    const queue = scenario.substations.map((s) => s.id)
    const seen = new Set(queue)
    while (queue.length) {
      const cur = queue.shift()!
      for (const nxt of adj.get(cur) ?? []) {
        if (seen.has(nxt)) continue
        seen.add(nxt)
        realParent.set(nxt, cur)
        queue.push(nxt)
      }
    }
    const name = (id: number) => nameOf.get(id) ?? String(id)
    // a connection counts as found when the pair is really wired, as in the score and the map colours
    const real = new Set(truthEdges.map(([x, y]) => pairKey(x, y)))
    const rows = edges.map((e) => ({
      node: name(e.child), ai: name(e.parent), real: realParent.has(e.child) ? name(realParent.get(e.child)!) : '—',
      ok: real.has(pairKey(e.child, e.parent)), flagged: e.basis === 'uncertain',
    })).sort((a, b) => a.node.localeCompare(b.node))
    return { rows, correct: rows.filter((r) => r.ok).length, wrong: rows.filter((r) => !r.ok) }
  }, [truthEdges, edges, scenario, nameOf])

  const experimentsUsed = events.filter((e) => (e.kind === 'experiment' && e.accepted) || e.kind === 'field_reading').length
  const budget = (events.find((e) => e.kind === 'started')?.budget as number | undefined) ?? 0
  return { status, events, overlay, score, error, start, attach, stop, resume, runId, compare, comparison, seal, compared: truthEdges !== null, nameOf, experimentsUsed, budget }
}
