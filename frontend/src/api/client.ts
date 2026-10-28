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
    throw new ApiError(res.status, typeof detail === 'string' ? detail : `API ${res.status}`)
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

export type ScenarioSource = { complexity: Complexity } | { reference: Reference }

export function createScenario(source: ScenarioSource, seed: number): Promise<ObservableScenario> {
  const query = 'reference' in source ? `reference=${source.reference}` : `complexity=${source.complexity}`
  return request(`/scenarios?${query}&seed=${seed}`, { method: 'POST' })
}

export const getShowcase = () => request<Showcase>('/showcase')

export function getTruth(source: ScenarioSource, seed: number): Promise<{ truth: Truth }> {
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
  'hypothesis', 'review_started', 'review', 'result', 'recovered', 'resumed', 'stopped', 'usage', 'error', 'done']

export interface ActiveRun { id: string; source: string; seed: number; budget: number }

export const getActiveInvestigation = () => request<ActiveRun | null>('/investigations/active')

export function startInvestigation(source: ScenarioSource, seed: number, budget: number, language = 'en'): Promise<{ id: string }> {
  return request('/investigations', { method: 'POST', body: JSON.stringify({ ...source, seed, budget, language }) })
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

export interface ModelUsage { input: number; cached: number; output: number; reasoning: number; calls: number; cost_usd: number }

export interface UsageReport {
  runs: number
  tokens: number
  cost_usd: number
  by_model: Record<string, ModelUsage>
  prices: Record<string, { input: number; cached_input: number; output: number }>
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
  return s === 'cigre_mv' || s === 'mv_oberrhein' ? { reference: s } : { complexity: s as Complexity }
}

/** Subscribe to a run's Server-Sent Events. Returns a function that closes the stream. */
export function streamInvestigation(id: string, onEvent: (e: RunEvent) => void, onError: () => void): () => void {
  const es = new EventSource(`/api/investigations/${id}/events`)
  const handler = (msg: MessageEvent) => {
    if (typeof msg.data !== 'string') return // the native connection 'error' event carries no data
    const e = JSON.parse(msg.data) as RunEvent
    onEvent(e)
    if (e.kind === 'done') es.close()
  }
  for (const k of EVENT_KINDS) es.addEventListener(k, handler as EventListener)
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return
    es.close()
    onError()
  }
  return () => es.close()
}
