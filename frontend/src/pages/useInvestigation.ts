import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getTruth, resumeRun, startInvestigation, stopRun, streamInvestigation, type CandidateEdge, type ObservableScenario, type RunEvent,
  type RunScore, type ScenarioSource,
} from '../api/client'
import type { Overlay } from '../scene/model'

export type RunStatus = 'idle' | 'running' | 'done' | 'failed'

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** Starts an investigation, follows its event stream and turns it into a scene overlay. */
export function useInvestigation(scenario: ObservableScenario | null, generated: { source: ScenarioSource; seed: number } | null) {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [edges, setEdges] = useState<CandidateEdge[]>([])
  const [focus, setFocus] = useState<Overlay['focus']>()
  const [score, setScore] = useState<RunScore | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [truthEdges, setTruthEdges] = useState<[number, number][] | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const close = useRef<() => void>(() => {})

  const idOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of scenario?.nodes ?? []) m.set(n.name, n.id)
    for (const s of scenario?.substations ?? []) m.set(s.name, s.id)
    return m
  }, [scenario])
  const nameOf = useMemo(() => new Map([...idOf].map(([k, v]) => [v, k])), [idOf])

  // a new grid resets everything
  useEffect(() => {
    close.current()
    setStatus('idle'); setEvents([]); setEdges([]); setFocus(undefined); setScore(null); setError(null); setTruthEdges(null)
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
    if (e.kind === 'done') {
      setStatus(e.status === 'done' ? 'done' : 'failed')
      if (e.status === 'stopped') setStatus('failed')
      setScore((e.score as RunScore) ?? null)
      setFocus(undefined)
    }
  }, [idOf])

  const start = useCallback(async (budget: number, language = 'en') => {
    if (!generated) return
    close.current()
    setEvents([]); setEdges([]); setFocus(undefined); setScore(null); setError(null); setTruthEdges(null)
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
    setEvents([]); setEdges([]); setFocus(undefined); setScore(null); setError(null); setTruthEdges(null)
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
    const { truth } = await getTruth(generated.source, generated.seed)
    setTruthEdges(truth.edges)
  }, [generated])

  const overlay = useMemo<Overlay | undefined>(() => {
    if (!edges.length) return undefined
    if (truthEdges) {
      const real = new Set(truthEdges.map(([a, b]) => pairKey(a, b)))
      const proposed = new Set(edges.map((e) => pairKey(e.child, e.parent)))
      return {
        edges: edges.map((e) => ({ child: e.child, parent: e.parent, status: real.has(pairKey(e.child, e.parent)) ? 'correct' : 'wrong' })),
        missed: truthEdges.filter(([a, b]) => !proposed.has(pairKey(a, b))),
      }
    }
    return { edges: edges.map((e) => ({ child: e.child, parent: e.parent, status: e.basis })), focus }
  }, [edges, focus, truthEdges])

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
    const rows = edges.map((e) => ({
      node: name(e.child), ai: name(e.parent), real: realParent.has(e.child) ? name(realParent.get(e.child)!) : '—',
      ok: realParent.get(e.child) === e.parent, flagged: e.basis === 'uncertain',
    })).sort((a, b) => a.node.localeCompare(b.node))
    return { rows, correct: rows.filter((r) => r.ok).length, wrong: rows.filter((r) => !r.ok) }
  }, [truthEdges, edges, scenario, nameOf])

  const experimentsUsed = events.filter((e) => e.kind === 'experiment' && e.accepted).length
  const budget = (events.find((e) => e.kind === 'started')?.budget as number | undefined) ?? 0
  return { status, events, overlay, score, error, start, attach, stop, resume, runId, compare, comparison, compared: truthEdges !== null, nameOf, experimentsUsed, budget }
}
