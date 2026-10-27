export type Complexity = 'easy' | 'medium' | 'hard'

export interface ObservableScenario {
  seed: number
  complexity: Complexity
  nodes: number[]
  metered_nodes: number[]
  root: number
}

export async function createScenario(complexity: Complexity, seed: number): Promise<ObservableScenario> {
  const res = await fetch(`/api/scenarios?complexity=${complexity}&seed=${seed}`, { method: 'POST' })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}
