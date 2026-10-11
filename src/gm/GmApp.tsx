import { useEffect, useRef, useState } from 'react'
import { GmCanvas } from './GmCanvas'
import { LightPanel } from './LightPanel'
import { Sidebar } from './Sidebar'
import { Toolbar } from './Toolbar'
import { hydrate, tableState, useGm } from './store'
import { startGmSync } from './sync'

export function GmApp() {
  const [hydrated, setHydrated] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<GmCanvas | null>(null)

  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | undefined
    void hydrate().then(() => {
      if (cancelled) return
      stop = startGmSync()
      setHydrated(true)
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  useEffect(() => {
    if (!hydrated || !hostRef.current) return
    const canvas = new GmCanvas(hostRef.current, {
      onViewMove: (view) => useGm.getState().setView(view),
      onMapResize: (scale) => useGm.getState().setMapScale(scale),
      onMapMove: (position) => useGm.getState().setMapPosition(position),
      onLightMove: (id, { x, y }) => useGm.getState().updateLight(id, { x, y }),
      onLightAim: (id, angle) => useGm.getState().updateLight(id, { angle }),
      onLightSelect: (id) => useGm.getState().selectLight(id),
    })
    canvasRef.current = canvas
    if (import.meta.env.DEV) Object.assign(window, { gmCanvas: canvas, gmStore: useGm })
    const push = (s = useGm.getState()) => {
      canvas.setMapImage(s.mapImage)
      canvas.update(tableState(s), s.tableScreen, s.tableConnected, s.selectedLightId)
    }
    push()
    const unsubscribe = useGm.subscribe((s) => push(s))
    return () => {
      unsubscribe()
      canvas.destroy()
      canvasRef.current = null
    }
  }, [hydrated])

  // Delete / Backspace removes the selected light (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable]')) return
      const { selectedLightId, removeLight } = useGm.getState()
      if (selectedLightId) removeLight(selectedLightId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="gm">
      <Toolbar />
      <div className="gm-body">
        <Sidebar canvas={canvasRef} />
        <div className="gm-stage">
          <div className="gm-map" ref={hostRef} />
          <LightPanel />
        </div>
      </div>
    </div>
  )
}
