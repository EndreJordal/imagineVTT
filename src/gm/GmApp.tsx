import { useEffect, useRef, useState } from 'react'
import { GmCanvas } from './GmCanvas'
import { LightPanel } from './LightPanel'
import { PlacementHint } from './PlacementHint'
import { openDroppedScene, openScene, saveScene } from './sceneFiles'
import { WallPointsPanel, WallToolbox } from './Walls'
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
      onWallPoint: (p) => useGm.getState().addWallPoint(p),
      onWallPointSelect: (ref) => useGm.getState().selectWallPoint(ref),
      onWallPointToggle: (ref) => useGm.getState().toggleWallPointSelected(ref),
      onWallPointDrag: (refs, anchor, to) => {
        const { scene, moveWallPoints } = useGm.getState()
        const from = scene.walls.find((w) => w.id === anchor.wallId)?.points[anchor.index]
        if (!from || (from.x === to.x && from.y === to.y)) return
        moveWallPoints(refs, to.x - from.x, to.y - from.y)
      },
      onBoxSelect: (lightIds, points, add) => useGm.getState().selectMany(lightIds, points, add),
      onCameraChange: (camera) => useGm.getState().setGmCamera(camera),
    })
    canvasRef.current = canvas
    if (import.meta.env.DEV) Object.assign(window, { gmCanvas: canvas, gmStore: useGm })
    let cameraVersion = -1
    const push = (s = useGm.getState()) => {
      // Jump to a restored or opened camera (before the image, which would otherwise fit).
      if (s.cameraVersion !== cameraVersion) {
        cameraVersion = s.cameraVersion
        canvas.setCamera(s.gmCamera)
      }
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
        buildingWalls: s.buildingWalls,
        wallSnap: s.wallSnap,
        wallDraft: s.wallDraft,
        selectedWallPoints: s.selectedWallPoints,
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

  // Keys (ignored while typing in a field):
  // - building walls: Enter confirms, Esc cancels the points (or stops building), Backspace
  //   takes back the last point
  // - Esc cancels light placement; Delete / Backspace removes the selected lights
  // - hold V to peek at the players' view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Scene files: Ctrl+S save, Ctrl+Shift+S save as, Ctrl+O open (even while typing).
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 's') {
          e.preventDefault()
          void saveScene(e.shiftKey)
          return
        }
        if (key === 'o') {
          e.preventDefault()
          void openScene()
          return
        }
      }
      const el = e.target
      const typing = el instanceof Element && el.closest('input, textarea, select, [contenteditable]')
      // Hold V to peek at exactly what the players see.
      if (e.key.toLowerCase() === 'v' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat) useGm.getState().setPeeking(true)
        return
      }
      const gm = useGm.getState()
      if (gm.buildingWalls && !typing) {
        if (e.key === 'Enter') {
          gm.confirmWallDraft()
          return
        }
        if (e.key === 'Escape') {
          if (gm.wallDraft.length) gm.cancelWallDraft()
          else gm.setBuildingWalls(false)
          return
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          gm.undoWallPoint()
          return
        }
      }
      if (e.key === 'Escape' && useGm.getState().placingLight) {
        useGm.getState().setPlacingLight(null)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (typing) return
      useGm.getState().deleteSelection()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'v') useGm.getState().setPeeking(false)
    }
    // Releasing V in another window would otherwise leave the peek stuck on.
    const onBlur = () => useGm.getState().setPeeking(false)
    // Dropping a scene file on the window opens it.
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      const item = [...(e.dataTransfer?.items ?? [])].find((i) => i.kind === 'file')
      if (!item) return
      e.preventDefault()
      void openDroppedScene(item)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <div className="gm">
      <Toolbar />
      <div className="gm-body">
        <Sidebar canvas={canvasRef} />
        <div className="gm-stage">
          <div className="gm-map" ref={hostRef} />
          <div className="side-panels">
            <WallToolbox />
            <WallPointsPanel />
            <LightPanel />
          </div>
          <PlacementHint />
        </div>
      </div>
    </div>
  )
}
