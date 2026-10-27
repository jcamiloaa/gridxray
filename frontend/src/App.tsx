import { useState } from 'react'
import { createScenario, type Complexity, type ObservableScenario } from './api/client'
import { GridView } from './components/GridView'

export default function App() {
  const [complexity, setComplexity] = useState<Complexity>('easy')
  const [seed, setSeed] = useState(0)
  const [scenario, setScenario] = useState<ObservableScenario | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setError(null)
    try {
      setScenario(await createScenario(complexity, seed))
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <h1>GridXray</h1>
      <p>Physical AI for Utilities: discover hidden grid topology through virtual experiments.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={complexity} onChange={(e) => setComplexity(e.target.value as Complexity)}>
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>
        <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 80 }} />
        <button onClick={generate}>Generate grid</button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {scenario && <GridView scenario={scenario} />}
    </main>
  )
}
