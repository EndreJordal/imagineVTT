import type { Size } from './types'

/**
 * Pictures shown to the players: one at a time, framed over the map on the table (over the
 * curtain too), turned to face whoever it's for.
 */

/** Quarter turns clockwise: 0 upright, 1 = 90°, 2 = 180°, 3 = 270°. */
export type Turn = 0 | 1 | 2 | 3

/** Space kept between the frame and the screen's edge, in table pixels. */
export const HANDOUT_MARGIN = 50
/** The frame around the picture, in table pixels. */
export const HANDOUT_FRAME = 14

export const turnBy = (turn: Turn, by: number): Turn => ((((turn + by) % 4) + 4) % 4) as Turn

/**
 * The framed picture's size on a screen (table pixels, as it appears there, turned), and the
 * picture's scale. Normally its own size, or smaller to fit with HANDOUT_MARGIN to the
 * screen's edge. Filling the screen, the frame reaches HANDOUT_MARGIN all round and the
 * picture covers it (cropped at the sides that don't fit).
 */
export function handoutBox(screen: Size, picture: Size, turn: Turn, fill = false): Size & { scale: number } {
  const sideways = turn % 2 === 1
  const w = sideways ? picture.height : picture.width
  const h = sideways ? picture.width : picture.height
  const room = (n: number) => Math.max(1, n - 2 * (HANDOUT_MARGIN + HANDOUT_FRAME))
  if (fill) {
    const scale = Math.max(room(screen.width) / w, room(screen.height) / h)
    return { width: room(screen.width) + 2 * HANDOUT_FRAME, height: room(screen.height) + 2 * HANDOUT_FRAME, scale }
  }
  // Never enlarged: a small picture shows at its own size.
  const scale = Math.min(1, room(screen.width) / w, room(screen.height) / h)
  return { width: w * scale + 2 * HANDOUT_FRAME, height: h * scale + 2 * HANDOUT_FRAME, scale }
}
