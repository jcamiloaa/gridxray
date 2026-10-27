import { Background, Controls, ReactFlow, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ObservableScenario } from '../api/client'

// Topology is hidden at the start: nodes only, no edges. Edges arrive from the agent (D6).
export function GridView({ scenario }: { scenario: ObservableScenario }) {
  const metered = new Set(scenario.metered_nodes)
  const cols = Math.ceil(Math.sqrt(scenario.nodes.length))
  const nodes: Node[] = [
    { id: String(scenario.root), position: { x: (cols * 170) / 2, y: -120 }, data: { label: 'Substation' }, type: 'input' },
    ...scenario.nodes.map((n, i) => ({
      id: String(n),
      position: { x: (i % cols) * 170, y: Math.floor(i / cols) * 90 },
      data: { label: metered.has(n) ? `${n} ⚡` : `${n}` },
      style: { opacity: metered.has(n) ? 1 : 0.5 },
    })),
  ]
  return (
    <div style={{ height: '70vh', border: '1px solid #8884', borderRadius: 8 }}>
      <ReactFlow nodes={nodes} edges={[]} colorMode="system" fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
