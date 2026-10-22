import { BrickWall, DoorOpen, Droplet, Eye, EyeOff, Flame, Flashlight, Lightbulb, PaintBucket, Volume2 } from 'lucide-static'
import { Texture } from 'pixi.js'
import type { LightIcon } from '../shared/lights'

/**
 * Icons drawn on the GM canvas (light tokens) and used as cursors (placing lights, building
 * walls and doors): the same Lucide icons as the UI, as SVG.
 */
export type CanvasIcon = LightIcon | 'walls' | 'doors' | 'fill' | 'hide' | 'sound' | 'alert' | 'water'

const SVGS: Record<CanvasIcon, string> = {
  lamp: Lightbulb,
  fire: Flame,
  flashlight: Flashlight,
  eye: Eye,
  walls: BrickWall,
  doors: DoorOpen,
  fill: PaintBucket,
  hide: EyeOff,
  sound: Volume2,
  water: Droplet,
  // An exclamation mark (the alert cursor).
  alert: '<svg><path d="M12 3v12" /><path d="M12 20h.01" /></svg>',
}

/** The drawing inside an icon's <svg> element. */
const body = (icon: CanvasIcon) => SVGS[icon].replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

/** An icon as a standalone SVG: `colour` strokes over a dark halo (readable on any map). */
function svg(icon: CanvasIcon, size: number, colour: string, halo: boolean) {
  const b = body(icon)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-2 -2 28 28" fill="none" ` +
    `stroke-linecap="round" stroke-linejoin="round">` +
    (halo ? `<g stroke="#000" stroke-opacity="0.75" stroke-width="5">${b}</g>` : '') +
    `<g stroke="${colour}" stroke-width="2">${b}</g></svg>`
  )
}

const dataUrl = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`

const cursors = new Map<CanvasIcon, string>()

/** A CSS cursor showing the icon, with its hotspot in the middle. */
export function iconCursor(icon: CanvasIcon): string {
  let cursor = cursors.get(icon)
  if (!cursor) {
    cursor = `url("${dataUrl(svg(icon, 28, '#ffffff', true))}") 14 14, crosshair`
    cursors.set(icon, cursor)
  }
  return cursor
}

/** Size the token icons are drawn at, in px (scaled down on screen: crisp at any zoom). */
const TEXTURE_PX = 72
const textures = new Map<CanvasIcon, Texture>()

/** Load the token icons (images decode asynchronously); call before drawing tokens. */
export async function loadCanvasIcons(): Promise<void> {
  await Promise.all(
    (Object.keys(SVGS) as CanvasIcon[]).map(async (icon) => {
      if (textures.has(icon)) return
      const img = new Image(TEXTURE_PX, TEXTURE_PX)
      img.src = dataUrl(svg(icon, TEXTURE_PX, '#e8e8ee', false))
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = TEXTURE_PX
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      textures.set(icon, Texture.from(canvas))
    }),
  )
}

/** A token icon's texture (empty until loadCanvasIcons has finished). */
export function iconTexture(icon: CanvasIcon): Texture {
  return textures.get(icon) ?? Texture.EMPTY
}
