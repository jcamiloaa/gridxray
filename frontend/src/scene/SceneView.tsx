import { Component, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { FullscreenButton, GridScene } from './GridScene'
import { Basic3D } from './Basic3D'
import { SingleLine } from './SingleLine'
import { withHypothesis } from './model'

let webglSupport: boolean | undefined

/** Probes WebGL once per page and releases the probe context, so repeated mounts never exhaust the browser's context limit. */
function hasWebGL(): boolean {
  if (webglSupport !== undefined) return webglSupport
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    webglSupport = Boolean(gl)
  } catch {
    webglSupport = false
  }
  return webglSupport
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

type Mode = '3d' | 'sld'

/**
 * The network view: 3D scene (a basic Canvas 2D 3D view when WebGL is missing) and a professional
 * single-line diagram, switchable from a segmented control.
 */
export function SceneView(props: ComponentProps<typeof GridScene>) {
  const [webgl, setWebgl] = useState(hasWebGL)
  const [mode, setMode] = useState<Mode>('3d')
  // a dropped WebGL context (tab switch, memory pressure, too many contexts) remounts the scene;
  // only repeated failures fall back to the Canvas 2D view
  const [canvasKey, setCanvasKey] = useState(0)
  const losses = useRef(0)
  const onContextLost = () => {
    losses.current += 1
    if (losses.current > 3) setWebgl(false)
    else window.setTimeout(() => setCanvasKey((k) => k + 1), 800)
  }
  // Fullscreen wraps the whole view, so the 3D/diagram toggle and both modes work inside it.
  const view = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === view.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const fullscreen = {
    on: full,
    toggle: () => { if (document.fullscreenElement) document.exitFullscreen(); else view.current?.requestFullscreen?.() },
  }
  const fallback = <Basic3D {...props} />
  const toggle = (
    <div className="view-toggle" role="tablist" aria-label="Network view">
      <button role="tab" aria-selected={mode === '3d'} onClick={() => setMode('3d')}>3D view</button>
      <button role="tab" aria-selected={mode === 'sld'} onClick={() => setMode('sld')}>Single-line diagram</button>
    </div>
  )
  return (
    <div ref={view} className="scene-view">
      {/* the 3D scene stays mounted while the diagram is shown, so switching never recreates its WebGL context */}
      {webgl ? (
        <div className="scene-view__layer" hidden={mode !== '3d'}>
          <Boundary key={canvasKey} fallback={fallback}>
            <GridScene {...props} fullscreen={fullscreen} onContextLost={onContextLost}>{mode === '3d' && props.children}</GridScene>
          </Boundary>
        </div>
      ) : mode === '3d' && fallback}
      {mode === 'sld' && (
        <div className="plan2d-wrap">
          <SingleLine model={props.overlay && !props.model.topologyKnown ? withHypothesis(props.model, props.overlay) : props.model}
            selected={props.selected} onSelect={props.onSelect} />
          <div className="scene-controls scene-controls--top" role="toolbar" aria-label="Diagram controls">
            <FullscreenButton {...fullscreen} />
          </div>
          {props.children}
        </div>
      )}
      {toggle}
    </div>
  )
}
