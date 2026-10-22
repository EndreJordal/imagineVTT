/** The GM's tool in hand, and snapping. */
import type { StateCreator } from 'zustand'
import type { GmStore } from '../store'
import { SELECT, type Tool } from '../tools'
import { TOOLS_OFF } from './shared'

export interface ToolsSlice {
  /** The GM's tool (GM-only): one at a time. */
  tool: Tool
  /**
   * Pick up a tool (putting the others, their drafts and the selection away), or put it
   * down with SELECT.
   */
  setTool(tool: Tool): void
  /** Pick up a tool, or put it down if it's in hand (W, D, H); hiding in its last mode. */
  toggleTool(kind: 'walls' | 'doors' | 'hide' | 'measure' | 'water'): void
  /** Snapping for walls, doors and placing lights: every 1, 1/2 or 1/4 square; 0 = none. */
  snap: number
  setSnap(fraction: number): void
}

export const toolsSlice: StateCreator<GmStore, [], [], ToolsSlice> = (set, get) => ({
  tool: SELECT,
  // Its toolbox takes the selection panels' place: picking up a tool puts the selection away.
  setTool: (tool) =>
    set(
      tool.kind === 'select'
        ? { tool, wallDraft: [], doorDraft: null }
        : {
            ...TOOLS_OFF,
            tool,
            ...(tool.kind === 'hide' && { hideMode: tool.mode }),
            ...(tool.kind === 'water' && { waterMode: tool.mode }),
          },
    ),
  toggleTool: (kind) => {
    const { tool, hideMode, waterMode, setTool } = get()
    if (tool.kind === kind) setTool(SELECT)
    else if (kind === 'hide') setTool({ kind, mode: hideMode })
    else if (kind === 'water') setTool({ kind, mode: waterMode })
    else setTool({ kind })
  },
  snap: 1,
  setSnap: (snap) => set({ snap }),
})
