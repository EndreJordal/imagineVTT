/** The table and the views of it: the table view (PVB), display calibration, darkness, GM vision and camera. */
import type { StateCreator } from 'zustand'
import { clampViewZoom, pointInPolygon, tableViewCorners } from '../../shared/geometry'
import type { GmCamera } from '../../shared/sceneFile'
import type { Display, Point, Size, TableState } from '../../shared/types'
import { moveCrossesWall, wallSegments } from '../../shared/visibility'
import type { GmStore } from '../store'
import { DEFAULT_GM_VISION, defaultDisplay, defaultTableScreen } from './shared'

export interface ViewSlice {
  /** Size of the table window; the last known size while none is connected. */
  tableScreen: Size
  tableConnected: boolean
  setTableScreen(screen: Size): void
  setTableDisconnected(): void
  setDisplay(patch: Partial<Display>): void
  setSquareMm(mm: number): void
  /**
   * Move the table view (and the lights travelling with it). With `safe`, vision safety
   * applies: travelling vision tokens stop at walls, and if one would end up outside the
   * view, the view doesn't move and false is returned.
   */
  setView(view: Point, safe?: boolean): boolean
  /** Zoom the table view (1: true scale, matching the minis). */
  setViewZoom(zoom: number): void
  setCalibrating(on: boolean): void
  /**
   * How much of the night the GM is spared, 0 (sees what the players see) to 1 (full day).
   * A GM preference: it never affects the table.
   */
  gmVision: number
  setGmVision(vision: number): void
  /** Temporarily show the GM exactly what the players see (while a peek key/button is held). */
  peeking: boolean
  setPeeking(peeking: boolean): void
  setDarkness(darkness: number): void
  /** The GM's pan and zoom (saved with the session and in scene files). */
  gmCamera: GmCamera | null
  /** Bumped when the GM's camera should jump to gmCamera (session restore, scene open). */
  cameraVersion: number
  /** The GM panned or zoomed (doesn't move the camera; the canvas already did). */
  setGmCamera(camera: GmCamera): void
}

export const viewSlice: StateCreator<GmStore, [], [], ViewSlice & Pick<TableState, 'display' | 'calibrating'>> = (set, get) => ({
  display: defaultDisplay,
  calibrating: false,
  tableScreen: defaultTableScreen,
  tableConnected: false,
  setTableScreen: (screen) =>
    set((s) =>
      s.tableConnected && s.tableScreen.width === screen.width && s.tableScreen.height === screen.height
        ? s
        : { tableScreen: screen, tableConnected: true },
    ),
  setTableDisconnected: () => set({ tableConnected: false }),
  setDisplay: (patch) => set((s) => ({ display: { ...s.display, ...patch } })),
  setSquareMm: (squareMm) => set((s) => ({ scene: { ...s.scene, squareMm } })),
  setView: (view, safe = false) => {
    const s = get()
    if (s.levelId !== s.tableLevelId) {
      // Viewing another floor: the party (on the table's floor) still travels with the view.
      const dx = view.x - s.scene.view.x
      const dy = view.y - s.scene.view.y
      const levels = s.levels.map((l) =>
        l.id === s.tableLevelId
          ? { ...l, lights: l.lights.map((t) => (t.followView ? { ...t, x: t.x + dx, y: t.y + dy } : t)) }
          : l,
      )
      set({ scene: { ...s.scene, view }, levels })
      return true
    }
    // Lights carried by the party travel with the table view.
    const dx = view.x - s.scene.view.x
    const dy = view.y - s.scene.view.y
    const guarded = safe && s.scene.fog.safety
    const segments = guarded ? wallSegments(s.scene.walls) : []
    let stuck = false
    const lights = s.scene.lights.map((l) => {
      if (!l.followView) return l
      if (!guarded || !l.vision) return { ...l, x: l.x + dx, y: l.y + dy }
      // A vision token stops at walls: it slides along them where it can, else stays put.
      const to = [
        { x: l.x + dx, y: l.y + dy },
        { x: l.x + dx, y: l.y },
        { x: l.x, y: l.y + dy },
      ].find((p) => !moveCrossesWall(l, p, segments))
      if (!to || to.x !== l.x + dx || to.y !== l.y + dy) stuck = true
      return to ? { ...l, ...to } : l
    })
    if (stuck) {
      // Held back, it must still be within the view; if not, the view stays where it is.
      const scene = { ...s.scene, view }
      const corners = s.tableScreen && tableViewCorners(scene, s.display, s.tableScreen)
      const outside = lights.some((l) => l.followView && l.vision && (!corners || !pointInPolygon(l, corners)))
      if (outside) {
        s.notify(
          'VISION SAFETY — a vision token travelling with the PVB hit a wall and would have left the PVB, ' +
            'so the PVB was dropped. Hold Alt to move through walls.',
        )
        return false
      }
    }
    set({ scene: { ...s.scene, view, lights } })
    return true
  },
  setViewZoom: (zoom) =>
    set((s) => {
      const viewZoom = clampViewZoom(zoom)
      return (s.scene.viewZoom ?? 1) === viewZoom ? s : { scene: { ...s.scene, viewZoom } }
    }),
  setCalibrating: (calibrating) => set({ calibrating }),
  gmVision: DEFAULT_GM_VISION,
  setGmVision: (gmVision) => set({ gmVision }),
  peeking: false,
  setPeeking: (peeking) => set({ peeking }),
  setDarkness: (darkness) => set((s) => ({ scene: { ...s.scene, darkness } })),
  gmCamera: null,
  cameraVersion: 0,
  setGmCamera: (gmCamera) => set({ gmCamera }),
})
