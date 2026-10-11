import { useEffect, useRef, useState } from 'react'
import { GmCanvas } from './GmCanvas'
import { LightPanel } from './LightPanel'
import { PlacementHint } from './PlacementHint'
import { Sidebar } from './Sidebar'
import { Toolbar } from './Toolbar'
import { gmDarkness, hydrate, tableState, useGm } from './store'
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
      onLightMove: (id, to) => {
        // Dragging one selected light moves the whole selection with it.
        const { scene, selectedLightIds, moveLights } = useGm.getState()
        const light = scene.lights.find((l) => l.id === id)
        if (!light) return
        const ids = selectedLightIds.includes(id) ? selectedLightIds : [id]
        moveLights(ids, to.x - light.x, to.y - light.y)
      },
      onLightAim: (id, angle) => useGm.getState().updateLight(id, { angle }),
      onLightSelect: (id) => useGm.getState().selectLight(id),
      onLightToggle: (id) => useGm.getState().toggleLightSelected(id),
      onPlaceLight: (at, keepPlacing) => {
        const { placingLight, addLight, setPlacingLight } = useGm.getState()
        if (!placingLight) return
        addLight(placingLight, at)
        if (!keepPlacing) setPlacingLight(null)
      },
      onPlaceCancel: () => useGm.getState().setPlacingLight(null),
    })
    canvasRef.current = canvas
    if (import.meta.env.DEV) Object.assign(window, { gmCanvas: canvas, gmStore: useGm })
    const push = (s = useGm.getState()) => {
      canvas.setMapImage(s.mapImage)
      // The GM's view has its own darkness (GM vision); the table's state is untouched.
      const state = tableState(s)
      const darkness = gmDarkness(s)
      const shown = darkness === state.scene.darkness ? state : { ...state, scene: { ...state.scene, darkness } }
      canvas.update(shown, {
        tableScreen: s.tableScreen,
        tableConnected: s.tableConnected,
        selectedLightIds: s.selectedLightIds,
        placingLight: s.placingLight,
        peeking: s.peeking,
      })
      canvas.setFogMemory(s.fogMemory, s.fogVersion)
    }
    push()
    const unsubscribe = useGm.subscribe((s) => push(s))
    return () => {
      unsubscribe()
      canvas.destroy()
      canvasRef.current = null
    }
  }, [hydrated])

  // Esc cancels light placement; Delete / Backspace removes the selected lights (unless typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target
      const typing = el instanceof Element && el.closest('input, textarea, select, [contenteditable]')
      // Hold V to peek at exactly what the players see.
      if (e.key.toLowerCase() === 'v' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat) useGm.getState().setPeeking(true)
        return
      }
      if (e.key === 'Escape' && useGm.getState().placingLight) {
        useGm.getState().setPlacingLight(null)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (typing) return
      const { selectedLightIds, removeLights } = useGm.getState()
      if (selectedLightIds.length) removeLights(selectedLightIds)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'v') useGm.getState().setPeeking(false)
    }
    // Releasing V in another window would otherwise leave the peek stuck on.
    const onBlur = () => useGm.getState().setPeeking(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return (
    <div className="gm">
      <Toolbar />
      <div className="gm-body">
        <Sidebar canvas={canvasRef} />
        <div className="gm-stage">
          <div className="gm-map" ref={hostRef} />
          <LightPanel />
          <PlacementHint />
        </div>
      </div>
    </div>
  )
}
