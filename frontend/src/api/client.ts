export type Complexity = 'easy' | 'medium' | 'hard'

export interface User {
  id: number
  email: string
  name: string
  is_demo: boolean
}

export type Reference = 'cigre_mv' | 'mv_oberrhein'

export interface NodeInfo {
  id: number
  name: string
  metered: boolean
  load_profile: string | null
  mount: 'kiosk' | 'pole'
  location: [number, number] | null // city block (column, row): the asset's known GIS location
}

export interface DeviceInfo {
  id: number
  kind: 'capacitor' | 'pv'
  node: number
  rating: number // kvar or kW
}

export interface SwitchInfo {
  id: number
  kind: 'tie' | 'sectionalizer' | 'recloser' | 'fuse'
  documented_closed: boolean
}

export interface Reading {
  vm_pu: number | null
  p_kw: number | null
  q_kvar: number | null
}

export interface ObservableScenario {
  seed: number
  source: string
  substations: NodeInfo[]
  nodes: NodeInfo[]
  switches: SwitchInfo[]
  devices: DeviceInfo[]
  hour: number
  readings: Record<string, Reading>
}

export interface Truth {
  edges: [number, number][]
  feeder: Record<string, number>
  switches: (SwitchInfo & { closed: boolean; between: [number, number] })[]
  lines: { between: [number, number]; kind: LineKind }[]
  vm_pu: Record<string, number>
}

export type LineKind = 'overhead' | 'underground'

export type Showcase = ObservableScenario & { truth: Truth }

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Same-origin requests (Vite proxy in dev, nginx in Docker), so the HttpOnly session cookie is sent.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) {
    const detail = await res.json().then((b) => b.detail, () => null)
    const text = typeof detail === 'string' ? detail
      : Array.isArray(detail?.errors) ? detail.errors.join(' ') // a designed network that does not work, in words
        : `API ${res.status}`
    throw new ApiError(res.status, text)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const auth = {
  me: () => request<User>('/auth/me'),
  login: (email: string, password: string) =>
    request<User>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  demo: () => request<User>('/auth/demo', { method: 'POST' }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
}

export type ScenarioSource = { complexity: Complexity } | { reference: Reference } | { grid: string }

export function createScenario(source: ScenarioSource, seed: number): Promise<ObservableScenario> {
  if ('grid' in source) return request(`/grids/${source.grid}/scenario?seed=${seed}`, { method: 'POST' })
  const query = 'reference' in source ? `reference=${source.reference}` : `complexity=${source.complexity}`
  return request(`/scenarios?${query}&seed=${seed}`, { method: 'POST' })
}

export const getShowcase = () => request<Showcase>('/showcase')

export function getTruth(source: ScenarioSource, seed: number): Promise<{ truth: Truth }> {
  if ('grid' in source) return request(`/grids/${source.grid}/truth?seed=${seed}`, { method: 'POST' })
  const query = 'reference' in source ? `reference=${source.reference}` : `complexity=${source.complexity}`
  return request(`/scenarios/truth?${query}&seed=${seed}`, { method: 'POST' })
}

/* ---------------------------------------------------------------- investigations */

export interface CandidateEdge {
  child: number
  parent: number
  basis: 'measured' | 'inferred' | 'proposed' | 'uncertain'
}

export interface ScoreRow {
  name?: string
  precision: number
  recall: number
  f1: number
  correct_edges: number
  total_edges: number
  wrong_edges: number
  uncertain_flagged: number
  wrong_and_flagged: number
  experiments: number
}

export interface RunScore {
  gridxray: ScoreRow | null
  steps?: number
  reviews?: number
  tokens?: number
  seconds?: number
  usage?: { tokens: number; cost_usd: number }
}

/** One event of a live investigation; fields depend on `kind`. */
export interface RunEvent {
  t: number
  kind: string
  [key: string]: unknown
}

export const EVENT_KINDS = ['sealed', 'started', 'meta_inference', 'crew_dispatched', 'crew_stage', 'field_photo', 'segmentation', 'field_reading', 'reasoning', 'message', 'tool_call', 'tool_result', 'experiment', 'candidate',
  'hypothesis', 'review_started', 'review', 'result', 'recovered', 'resumed', 'stopped', 'usage', 'error', 'done', 'intervention', 'change_detected', 'plan_review']

export interface ActiveRun { id: string; source: string; seed: number; budget: number }

export const getActiveInvestigation = () => request<ActiveRun | null>('/investigations/active')

export type PlanKind = 'none' | 'current' | 'old' | 'errors'

/** budget 0 = autonomous: the planning agent decides how many experiments are needed. */
export function startInvestigation(source: ScenarioSource, seed: number, budget: number, language = 'en',
  plan: PlanKind = 'none', planDate: string | null = null): Promise<{ id: string }> {
  return request('/investigations', { method: 'POST', body: JSON.stringify({ ...source, seed, budget, language, plan, plan_date: planDate }) })
}

export interface InitialPlan { kind: PlanKind; drawn_on: string; age_years: number; edges: [number, number][]; missing: number[] }

/** The utility's initial plan for a network (its drawing, with the date it was drawn). */
export function getPlan(source: ScenarioSource, seed: number, kind: PlanKind, drawnOn: string | null): Promise<{ today: string; plan: InitialPlan | null }> {
  const q = new URLSearchParams({ kind, seed: String(seed) })
  if ('grid' in source) q.set('grid', source.grid)
  else if ('reference' in source) q.set('reference', source.reference)
  else q.set('complexity', source.complexity)
  if (drawnOn) q.set('drawn_on', drawnOn)
  return request(`/scenarios/plan?${q}`, { method: 'POST' })
}

export interface RunSummary {
  id: string
  source: string
  seed: number
  budget: number
  status: 'running' | 'done' | 'failed' | 'stopped'
  created_at: string
  f1: number | null
  experiments: number
  tokens: number
  cost_usd: number
}

export interface ModelUsage { input: number; cached: number; output: number; reasoning: number; calls: number; cost_usd: number; images?: number }

export interface UsageReport {
  runs: number
  tokens: number
  cost_usd: number
  by_model: Record<string, ModelUsage>
  prices: Record<string, { input: number; cached_input: number; output: number; per_image?: number }>
  models: { spark: string; wonder: string }
}

export interface MetaKeyStatus { configured: boolean; source: 'app' | 'env' | null; hint: string | null; env_configured: boolean }
export const metaKey = {
  status: () => request<MetaKeyStatus>('/settings/meta-key'),
  save: (api_key: string) => request<MetaKeyStatus>('/settings/meta-key', { method: 'PUT', body: JSON.stringify({ api_key }) }),
  remove: () => request<MetaKeyStatus>('/settings/meta-key', { method: 'DELETE' }),
}

export const listRuns = () => request<RunSummary[]>('/investigations')
export const getUsage = () => request<UsageReport>('/investigations/usage')
export const stopRun = (id: string) => request<{ stopping: boolean }>(`/investigations/${id}/stop`, { method: 'POST' })
export interface SealReveal { algorithm: string; nonce: string; canonical: string; published_commitment: string | null; recomputed: string }
export const getSeal = (id: string) => request<SealReveal>(`/investigations/${id}/seal`)
export const resumeRun = (id: string) => request<ActiveRun>(`/investigations/${id}/resume`, { method: 'POST' })

export function sourceOf(s: string): ScenarioSource {
  if (s.startsWith('custom:')) return { grid: s.slice(7) }
  return s === 'cigre_mv' || s === 'mv_oberrhein' ? { reference: s } : { complexity: s as Complexity }
}

/** Subscribe to a run's Server-Sent Events. Returns a function that closes the stream. */
/**
 * Subscribe to a run's Server-Sent Events. Returns a function that closes the stream.
 * A dropped connection (network blip, sleeping tab, server restart) reconnects by itself and resumes after
 * the last event received; onError is called only after repeated failures.
 */
export function streamInvestigation(id: string, onEvent: (e: RunEvent) => void, onError: () => void): () => void {
  let last = 0 // position of the last event received (the server's SSE id)
  let failures = 0
  let finished = false
  let es: EventSource | null = null
  let retry: number | undefined
  const handler = (msg: MessageEvent) => {
    if (typeof msg.data !== 'string') return // the native connection 'error' event carries no data
    const n = Number(msg.lastEventId)
    if (n && n <= last) return // already seen (replayed after a reconnect)
    last = n || last + 1
    failures = 0
    const e = JSON.parse(msg.data) as RunEvent
    onEvent(e)
    if (e.kind === 'done') { finished = true; es?.close() }
  }
  const open = () => {
    es = new EventSource(`/api/investigations/${id}/events${last ? `?since=${last}` : ''}`)
    for (const k of EVENT_KINDS) es.addEventListener(k, handler as EventListener)
    es.onopen = () => { failures = 0 }
    es.onerror = () => {
      if (finished || !es) return
      if (es.readyState === EventSource.CONNECTING) return // the browser retries by itself, sending Last-Event-ID
      es.close()
      failures += 1
      if (failures > 8) { onError(); return }
      retry = window.setTimeout(open, Math.min(10000, 800 * failures))
    }
  }
  open()
  return () => { finished = true; window.clearTimeout(retry); es?.close() }
}

/* ---------- networks designed in the editor ---------- */

export interface DesignNode { key: string; name: string; cell: [number, number]; mount: 'kiosk' | 'pole'; profile: 'residential' | 'commercial'; kw: number; metered: boolean }
export type SwitchKind = 'tie' | 'sectionalizer' | 'recloser' | 'fuse'
export interface DesignSwitch { kind: SwitchKind; closed: boolean; documented_closed: boolean | null }
export interface DesignLine { a: string; b: string; kind: LineKind; switch: DesignSwitch | null }
export interface Design { name: string; substation_row: number; nodes: DesignNode[]; lines: DesignLine[]; noise: 'clean' | 'realistic' | 'noisy' }
export interface GridSummary { id: string; name: string; nodes: number; lines: number; switches: number; updated_at: string }

export const grids = {
  list: () => request<GridSummary[]>('/grids'),
  get: (id: string) => request<GridSummary & { design: Design }>(`/grids/${id}`),
  create: (d: Design) => request<GridSummary>('/grids', { method: 'POST', body: JSON.stringify(d) }),
  update: (id: string, d: Design) => request<GridSummary>(`/grids/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  remove: (id: string) => request<void>(`/grids/${id}`, { method: 'DELETE' }),
  validate: (d: Design) => request<{ errors: string[] }>('/grids/validate', { method: 'POST', body: JSON.stringify(d) }),
  template: (complexity: Complexity, seed: number) => request<Design>(`/grids/template?complexity=${complexity}&seed=${seed}`),
}

/* ---------- live intervention ---------- */

export interface FieldSwitch { id: number; kind: SwitchKind; closed: boolean; documented_closed: boolean; between: [string, string] }
export interface FieldView { switches: FieldSwitch[]; meters: { id: number; name: string; offline: boolean }[] }

export const field = {
  view: (runId: string) => request<FieldView>(`/investigations/${runId}/field`),
  intervene: (runId: string, switches: number[], metersOff: number[]) =>
    request<{ applied: boolean }>(`/investigations/${runId}/intervene`, { method: 'POST', body: JSON.stringify({ switches, meters_off: metersOff }) }),
  truth: (runId: string) => request<{ truth: Truth; initial_edges: [number, number][]; interventions: number }>(`/investigations/${runId}/truth`),
}
