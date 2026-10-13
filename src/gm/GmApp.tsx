import { useEffect, useRef, useState } from 'react'
import { isParty } from '../shared/levels'
import type { Point } from '../shared/types'
import { GmCanvas, UI_KEYS } from './GmCanvas'
import { LightPanel } from './LightPanel'
import { ASSET_DRAG_TYPE, initAssetLibrary, placeAsset } from './assetLibrary'
import { AssetPreview } from './Assets'
import { ObjectPanel, ObjectsPanel } from './ObjectPanel'
import { PlacementHint } from './PlacementHint'
import { openDroppedScene, openScene, saveScene } from './sceneFiles'
import { GmNotice } from './GmNotice'
import { DoorPanel, DoorToolbox, WallPointsPanel, WallToolbox } from './Walls'
import { HiddenAreaPanel, HideToolbox } from './Hide'
import { GroupBar, ScenePanel } from './ScenePanel'
import { SoundPanel } from './Sound'
import { CharacterPanel } from './Characters'
import { portraitFolder } from './portraits'
import { playMapSound, startSoundController } from './soundController'
import { Sidebar } from './Sidebar'
import { Toolbar } from './Toolbar'
import { hydrateCurtain, toggleCurtain, useCurtain } from './curtainStore'
import { hydrateHandouts, useHandouts } from './handoutStore'
import { mapFolder } from './mapFolder'
import { gmDarkness, hydrate, levelImage, useGm, type GmStore } from './store'
import { SELECT } from './tools'
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
  // Building walls, a wall being drawn is finished first; the next time, the tool goes down.
  if (gm.tool.kind === 'walls' && gm.wallDraft.length >= 2) gm.confirmWallDraft()
  else gm.setTool(SELECT)
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
    let stopSound: (() => void) | undefined
    void Promise.all([hydrate(), hydrateCurtain(), hydrateHandouts(), mapFolder.restore(), portraitFolder.restore()]).then(([, saveCurtain, saveHandouts]) => {
      if (cancelled) return (saveCurtain(), saveHandouts())
      stopCurtain = () => (saveCurtain(), saveHandouts())
      stop = startGmSync()
      stopHistory = startHistory()
      stopSound = startSoundController()
      void initAssetLibrary()
      setHydrated(true)
    })
    return () => {
      cancelled = true
      stop?.()
      stopHistory?.()
      stopCurtain?.()
      stopSound?.()
    }
  }, [])

  useEffect(() => {
    if (!hydrated || !hostRef.current) return
    const canvas = new GmCanvas(hostRef.current, {
      onViewMove: (view, force) => useGm.getState().setView(view, !force),
      onViewZoom: (zoom) => useGm.getState().setViewZoom(zoom),
      onHideFill: hideFill,
      onHidePaint: (from, to, erase, stroke) => useGm.getState().hidePaint(from, to, erase, stroke),
      onHiddenSelect: (id) => useGm.getState().selectHidden(id),
      onDoorSettings: (id) => useGm.getState().selectDoor(id),
      onMapResize: (scale) => useGm.getState().setMapScale(scale),
      onMapMove: (position) => useGm.getState().setMapPosition(position),
      onLightMove: (id, to, force) => {
        // Dragging one selected light moves the whole selection with it.
        const { scene, selectedLightIds, moveLights } = useGm.getState()
        const light = scene.lights.find((l) => l.id === id)
        if (!light) return false
        const ids = selectedLightIds.includes(id) ? selectedLightIds : [id]
        const dx = to.x - light.x
        const dy = to.y - light.y
        if (!moveLights(ids, dx, dy, !force)) return false
        // Objects selected with them (a group) come along.
        const { selectedObjectIds, moveObjects } = useGm.getState()
        if (selectedLightIds.includes(id) && selectedObjectIds.length) moveObjects(selectedObjectIds, dx, dy)
        return true
      },
      onLightAim: (id, angle) => useGm.getState().updateLight(id, { angle }),
      onLightSelect: (id) => useGm.getState().selectLight(id),
      onLightToggle: (id) => useGm.getState().toggleLightSelected(id),
      onPlaceLight: (at, keepPlacing) => {
        const { tool, addLight, setTool } = useGm.getState()
        if (tool.kind !== 'light') return
        addLight(tool.light, at)
        if (!keepPlacing) setTool(SELECT)
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
      onObjectCopy: (p) => {
        const { selectedObjectIds, copyObject } = useGm.getState()
        if (selectedObjectIds.length === 1) copyObject(selectedObjectIds[0], p)
      },
      onObjectChange: (id, patch) => useGm.getState().updateObject(id, patch),
      onBoxSelect: (lightIds, points, objectIds, add) => useGm.getState().selectMany(lightIds, points, objectIds, add),
      onObjectToggle: (id) => useGm.getState().toggleObjectSelected(id),
      onObjectsMove: (ids, dx, dy) => {
        // Lights selected with them (a group) come along.
        const { selectedLightIds, moveLights, moveObjects } = useGm.getState()
        moveObjects(ids, dx, dy)
        if (selectedLightIds.length) moveLights(selectedLightIds, dx, dy, false)
      },
      onGroupSelect: (id) => useGm.getState().selectGroup(id),
      onSoundSelect: (id) => useGm.getState().selectSound(id),
      onSoundMove: (id, p) => useGm.getState().updateSound(id, { x: p.x, y: p.y }),
      onSoundPlay: (id) => playMapSound(id),
      onMapLockToggle: () => {
        const map = useGm.getState().scene.map
        if (map) useGm.getState().setMapLocked(!map.locked)
      },
      onCharacterSelect: (id) => useGm.getState().selectCharacter(id),
      onCharacterMove: (id, p) => useGm.getState().moveCharacter(id, p),
      onCameraChange: (camera) => useGm.getState().setGmCamera(camera),
    })
    canvasRef.current = canvas
    if (import.meta.env.DEV) Object.assign(window, { gmCanvas: canvas, gmStore: useGm })
    let cameraVersion = -1
    let objectImages: unknown = null
    let shownInputs: unknown[] | null = null
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
      // Only when something the canvas shows changed (not the camera it reported, history,
      // notices and the like): an update redraws all the overlays.
      const curtainDown = useCurtain.getState().state.down
      const handouts = useHandouts.getState()
      const handout = handouts.shown && {
        size: handouts.shown.size,
        turn: handouts.turns[handouts.shown.id] ?? 0,
        fill: handouts.fill,
      }
      const inputs = [
        handouts.shown, handout?.turn, handouts.fill,
        s.scene, s.levels, s.levelId, s.tableLevelId, s.levelImages, s.onionSkin, s.display, s.calibrating,
        s.gmVision, s.fogMemory, s.fogVersion, s.mapImage, curtainDown, ...UI_KEYS.map((k) => s[k]),
      ]
      if (shownInputs && inputs.every((v, i) => v === shownInputs![i])) return
      shownInputs = inputs
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
      const ui = Object.fromEntries(UI_KEYS.map((k) => [k, s[k]])) as Pick<GmStore, (typeof UI_KEYS)[number]>
      canvas.update(shown, { ...ui, onion: onionOf(s), curtainDown, handout, ghostLightIds: party.map((l) => l.id) })
      canvas.setFogMemory(s.fogMemory, s.fogVersion)
    }
    push()
    const unsubscribe = useGm.subscribe((s) => push(s))
    const unsubscribeCurtain = useCurtain.subscribe((c, prev) => c.state.down !== prev.state.down && push())
    const unsubscribeHandouts = useHandouts.subscribe((h, prev) => (h.shown !== prev.shown || h.turns !== prev.turns || h.fill !== prev.fill) && push())
    return () => {
      unsubscribe()
      unsubscribeCurtain()
      unsubscribeHandouts()
      canvas.destroy()
      canvasRef.current = null
    }
  }, [hydrated])

  // Keys (all but Ctrl+S / Ctrl+O ignored while typing in a field):
  // - Ctrl+S save (Shift: save as), Ctrl+O open, Ctrl+Z / Ctrl+Y undo and redo
  // - with a tool: Enter (or right-click) confirms or puts it down, Esc cancels or puts it
  //   down; building walls, Backspace takes back the last point
  // - Delete / Backspace removes what's selected (lights, wall points, objects, a hidden area)
  // - hold V to peek at the players' view; C drops or raises the curtain
  // (W, D, L and H pick up the tools: see ToolPalette)
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
      if (e.key === 'Enter' && !typing && gm.tool.kind !== 'select') {
        confirmTool()
        return
      }
      if (gm.tool.kind === 'walls' && !typing) {
        if (e.key === 'Escape') {
          if (gm.wallDraft.length) gm.cancelWallDraft()
          else gm.setTool(SELECT)
          return
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          gm.undoWallPoint()
          return
        }
      }
      if (gm.tool.kind === 'doors' && !typing && e.key === 'Escape') {
        if (gm.doorDraft) gm.cancelDoorDraft()
        else gm.setTool(SELECT)
        return
      }
      if (e.key === 'Escape' && !typing && (gm.tool.kind === 'hide' || gm.tool.kind === 'light')) {
        gm.setTool(SELECT)
        return
      }
      // Arrow keys move the selected character token (a square at a time when it snaps).
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (arrow && !typing && gm.selectedCharacterId && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        gm.nudgeCharacter(gm.selectedCharacterId, arrow[0], arrow[1], e.shiftKey)
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
            <ObjectsPanel />
            <HiddenAreaPanel />
            <DoorPanel />
            <SoundPanel />
            <CharacterPanel />
            <GroupBar />
            <AssetPreview />
          </div>
          <PlacementHint />
          <GmNotice />
        </div>
        <ScenePanel canvas={canvasRef} />
      </div>
    </div>
  )
}
