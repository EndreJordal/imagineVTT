import { useEffect, useRef, useState } from 'react'
import { isParty } from '../shared/levels'
import type { Point } from '../shared/types'
import { GmCanvas } from './GmCanvas'
import { LightPanel } from './LightPanel'
import { ASSET_DRAG_TYPE, initAssetLibrary, placeAsset } from './assetLibrary'
import { AssetPreview } from './Assets'
import { ObjectPanel } from './ObjectPanel'
import { PlacementHint } from './PlacementHint'
import { openDroppedScene, openScene, saveScene } from './sceneFiles'
import { GmNotice } from './GmNotice'
import { DoorToolbox, WallPointsPanel, WallToolbox } from './Walls'
import { HideToolbox } from './Hide'
import { Sidebar } from './Sidebar'
import { Toolbar } from './Toolbar'
import { hydrateCurtain, toggleCurtain, useCurtain } from './curtainStore'
import { gmDarkness, hydrate, levelImage, useGm } from './store'
import { Floors } from './Floors'
import { startGmSync } from './sync'
import { redo, startHistory, undo } from './history'
import { ToolPalette } from './ToolPalette'

/**
 * Enter, or right-click on the map, with a tool: confirm. Walls: finish the wall being
 * drawn, or with none, stop building. Doors and lights: done, stop using the tool.
 */
function confirmTool() {
  const gm = useGm.getState()
  if (gm.buildingWalls) {
    if (gm.wallDraft.length >= 2) gm.confirmWallDraft()
    else gm.setBuildingWalls(false)
  } else if (gm.buildingDoors) {
    gm.setBuildingDoors(false)
  } else if (gm.placingLight) {
    gm.setPlacingLight(null)
  } else if (gm.hideTool) {
    gm.setHideTool(null)
  }
}

/** Hide-areas dropper: fill (or reveal) the space clicked, or say why it can't. */
function hideFill(p: Point) {
  const gm = useGm.getState()
  const result = gm.hideFill(p)
  if (result === 'open') {
    gm.notify("That space isn't closed in by walls and doors: close the gap, or hide it with the brush.")
  } else if (result === 'on-wall') {
    gm.notify('Click inside the space, not on its wall.')
  }
}

/** The floor below the one viewed, faint over it, to line maps up (onion skin). */
function onionOf(s: ReturnType<typeof useGm.getState>) {
  if (!s.onionSkin) return null
  const i = s.levels.findIndex((l) => l.id === s.levelId)
  const below = i > 0 ? s.levels[i - 1] : null
  const image = below && levelImage(s, below.id)
  return below?.map && image ? { image, map: below.map } : null
}

export function GmApp() {
  const [hydrated, setHydrated] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<GmCanvas | null>(null)

  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | undefined
    let stopHistory: (() => void) | undefined
    let stopCurtain: (() => void) | undefined
    void Promise.all([hydrate(), hydrateCurtain()]).then(([, saveCurtain]) => {
      if (cancelled) return saveCurtain()
      stopCurtain = saveCurtain
      stop = startGmSync()
      stopHistory = startHistory()
      void initAssetLibrary()
      setHydrated(true)
    })
    return () => {
      cancelled = true
      stop?.()
      stopHistory?.()
      stopCurtain?.()
    }
  }, [])

  useEffect(() => {
    if (!hydrated || !hostRef.current) return
    const canvas = new GmCanvas(hostRef.current, {
      onViewMove: (view, force) => useGm.getState().setView(view, !force),
      onViewZoom: (zoom) => useGm.getState().setViewZoom(zoom),
      onHideFill: hideFill,
      onHidePaint: (from, to, erase) => useGm.getState().hidePaint(from, to, erase),
      onMapResize: (scale) => useGm.getState().setMapScale(scale),
      onMapMove: (position) => useGm.getState().setMapPosition(position),
      onLightMove: (id, to, force) => {
        // Dragging one selected light moves the whole selection with it.
        const { scene, selectedLightIds, moveLights } = useGm.getState()
        const light = scene.lights.find((l) => l.id === id)
        if (!light) return false
        const ids = selectedLightIds.includes(id) ? selectedLightIds : [id]
        return moveLights(ids, to.x - light.x, to.y - light.y, !force)
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
      onToolConfirm: confirmTool,
      onWallPoint: (p) => useGm.getState().addWallPoint(p),
      onWallPointSelect: (ref) => useGm.getState().selectWallPoint(ref),
      onWallPointToggle: (ref) => useGm.getState().toggleWallPointSelected(ref),
      onWallPointDrag: (refs, anchor, to) => {
        const { scene, moveWallPoints } = useGm.getState()
        const from = scene.walls.find((w) => w.id === anchor.wallId)?.points[anchor.index]
        if (!from || (from.x === to.x && from.y === to.y)) return
        moveWallPoints(refs, to.x - from.x, to.y - from.y)
      },
      onDoorPoint: (p) => useGm.getState().placeDoorPoint(p),
      onDoorToggle: (id) => useGm.getState().toggleDoor(id),
      onObjectSelect: (id) => useGm.getState().selectObject(id),
      onObjectChange: (id, patch) => useGm.getState().updateObject(id, patch),
      onBoxSelect: (lightIds, points, add) => useGm.getState().selectMany(lightIds, points, add),
      onCameraChange: (camera) => useGm.getState().setGmCamera(camera),
    })
    canvasRef.current = canvas
    if (import.meta.env.DEV) Object.assign(window, { gmCanvas: canvas, gmStore: useGm })
    let cameraVersion = -1
    let objectImages: unknown = null
    const push = (s = useGm.getState()) => {
      if (s.objectImages !== objectImages) {
        objectImages = s.objectImages
        canvas.setObjectImages(s.objectImages)
      }
      // Jump to a restored or opened camera (before the image, which would otherwise fit).
      if (s.cameraVersion !== cameraVersion) {
        cameraVersion = s.cameraVersion
        canvas.setCamera(s.gmCamera)
      }
      canvas.setMapImage(s.mapImage)
      // The GM views their floor (which may not be the table's), with their own darkness
      // (GM vision); the table's state is untouched.
      // Preparing another floor: the party (on the table's floor) shows on it too, lighting
      // and seeing as it will once this floor is on the table, to line them up with it.
      const tableFloor = s.levelId === s.tableLevelId ? null : s.levels.find((l) => l.id === s.tableLevelId)
      const party = tableFloor?.lights.filter(isParty) ?? []
      const scene = party.length ? { ...s.scene, lights: [...s.scene.lights, ...party] } : s.scene
      const state = { scene, display: s.display, calibrating: s.calibrating }
      const darkness = gmDarkness(s)
      const shown = darkness === state.scene.darkness ? state : { ...state, scene: { ...state.scene, darkness } }
      canvas.update(shown, {
        tableScreen: s.tableScreen,
        tableConnected: s.tableConnected,
        selectedLightIds: s.selectedLightIds,
        placingLight: s.placingLight,
        peeking: s.peeking,
        buildingWalls: s.buildingWalls,
        snap: s.snap,
        wallDraft: s.wallDraft,
        selectedWallPoints: s.selectedWallPoints,
        selectedObjectIds: s.selectedObjectIds,
        onion: onionOf(s),
        buildingDoors: s.buildingDoors,
        doorDraft: s.doorDraft,
        curtainDown: useCurtain.getState().state.down,
        ghostLightIds: party.map((l) => l.id),
        hideTool: s.hideTool,
        hideBrush: s.hideBrush,
      })
      canvas.setFogMemory(s.fogMemory, s.fogVersion)
    }
    push()
    const unsubscribe = useGm.subscribe((s) => push(s))
    const unsubscribeCurtain = useCurtain.subscribe((c, prev) => c.state.down !== prev.state.down && push())
    return () => {
      unsubscribe()
      unsubscribeCurtain()
      canvas.destroy()
      canvasRef.current = null
    }
  }, [hydrated])

  // Keys (ignored while typing in a field):
  // - building walls: Enter confirms, Esc cancels the points (or stops building), Backspace
  //   takes back the last point
  // - Esc cancels light placement; Delete / Backspace removes the selected lights
  // - hold V to peek at the players' view; C drops or raises the curtain
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
      // Undo/redo: Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z (a field being typed in keeps its own).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing) {
        const key = e.key.toLowerCase()
        if (key === 'z' || key === 'y') {
          e.preventDefault()
          if (key === 'y' || e.shiftKey) redo()
          else undo()
          return
        }
      }
      // Hold V to peek at exactly what the players see.
      if (e.key.toLowerCase() === 'v' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat) useGm.getState().setPeeking(true)
        return
      }
      // C drops or raises the curtain.
      if (e.key.toLowerCase() === 'c' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        void toggleCurtain()
        return
      }
      const gm = useGm.getState()
      if (e.key === 'Enter' && !typing && (gm.buildingWalls || gm.buildingDoors || gm.placingLight || gm.hideTool)) {
        confirmTool()
        return
      }
      if (gm.buildingWalls && !typing) {
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
      if (gm.buildingDoors && !typing && e.key === 'Escape') {
        if (gm.doorDraft) gm.cancelDoorDraft()
        else gm.setBuildingDoors(false)
        return
      }
      if (e.key === 'Escape' && gm.hideTool && !typing) {
        gm.setHideTool(null)
        return
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
          <div
            className="gm-map"
            ref={hostRef}
            // Assets dragged from the library are placed where they're dropped.
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
              }
            }}
            onDrop={(e) => {
              const path = e.dataTransfer.getData(ASSET_DRAG_TYPE)
              const at = path && canvasRef.current?.sceneAt(e.clientX, e.clientY)
              if (!path || !at) return
              e.preventDefault()
              e.stopPropagation()
              void placeAsset(path, at)
            }}
          />
          <ToolPalette />
          <Floors />
          <div className="side-panels">
            <WallToolbox />
            <DoorToolbox />
            <HideToolbox />
            <WallPointsPanel />
            <LightPanel />
            <ObjectPanel />
            <AssetPreview />
          </div>
          <PlacementHint />
          <GmNotice />
        </div>
      </div>
    </div>
  )
}
