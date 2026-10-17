import type { LightKind } from '../shared/lights'

/** The hide tool's modes: fill an enclosed space, or paint and erase with a brush. */
export type HideTool = 'fill' | 'brush' | 'erase'

/**
 * The GM's tool, one at a time: selecting and dragging, building walls or doors, placing a
 * light, or hiding areas.
 */
export type Tool =
  | { kind: 'select' }
  | { kind: 'walls' }
  | { kind: 'doors' }
  | { kind: 'light'; light: LightKind }
  | { kind: 'hide'; mode: HideTool }
  | { kind: 'measure' }


export const SELECT: Tool = { kind: 'select' }
