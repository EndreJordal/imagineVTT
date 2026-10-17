import type { CharacterLabel, CharacterToken } from './characters'
import type { Point } from './types'

/**
 * Combat link: a fight run in the V:tM combat tracker, linked to the open scene. The campaign
 * bible's links open imagineVTT with an encounter; imagineVTT opens the tracker and hands it
 * over; the tracker reports the fight after every change. The fight's full state is kept in
 * the scene (and its file), so it can be resumed next week. See docs/combat-link.md.
 */

/** How the token of a combatant looks: the encounter's `vtt` block (all optional). */
export interface CombatantLook {
  border?: string
  color?: string
  type?: string
  size?: 1 | 2
  label?: CharacterLabel
}

/** One combatant, as the tracker reports it. */
export interface Combatant {
  id: string
  name: string
  type: string
  side: 'npc' | 'pc'
  allegiance: 'ally' | 'enemy'
  /** 'active', or out of the fight: 'dead', 'torpor'… */
  state: string
  /** Waiting in the tracker's Inactive section (reinforcements): not in the fight yet. */
  inactive: boolean
  /** Has acted this turn. */
  acted: boolean
  init: number | null
  /** URL of the portrait (absolute, or a data: URL), '' for none. */
  portrait: string
  vtt: CombatantLook | null
}

/** The fight as the tracker reports it. */
export interface CombatSummary {
  name: string
  round: number
  /** 'setup' (before the first turn), 'declare', 'act', 'extra', 'end'. */
  phase: string
  activeId: string | null
  /** Everyone in the fight, in order of initiative. */
  order: string[]
  combatants: Combatant[]
}

/** The fight linked to the scene: kept with it, so it can be resumed. */
export interface CombatSave {
  /** Ties the tracker's fight to this scene: the tracker's state counts only if it matches. */
  linkId: string
  /** The encounter's name (from the link). */
  encounter: string
  /** The encounter as the tracker takes it (to start it again if the tracker never reported). */
  payload?: unknown
  /** The last state the tracker reported, and its full snapshot (to resume it). */
  summary: CombatSummary | null
  snapshot: unknown
  /** The players see the order of initiative on the table. */
  showOrder: boolean
  /** Which edge of the table screen the order runs along. */
  edge?: OrderEdge
  /** Readable from that edge's side of the table ('out'), or from across it ('in'). */
  facing?: OrderFacing
  /** Also along the opposite edge, facing its own side the same way. */
  both?: boolean
  /** A faint ring where the acting combatant's token started its turn (on unless false). */
  showStart?: boolean
  /** Before edge/facing/both: 'bottom', 'top' or 'both' (read by orderPlacement). */
  edges?: 'bottom' | 'top' | 'both'
}

export type OrderEdge = 'bottom' | 'top' | 'left' | 'right'
export type OrderFacing = 'out' | 'in'

/** Where the order goes on the table (from a fight saved either way). */
export interface OrderPlacement {
  edge: OrderEdge
  facing: OrderFacing
  both: boolean
}

export function orderPlacement(c: Pick<CombatSave, 'edge' | 'facing' | 'both' | 'edges'>): OrderPlacement {
  return {
    edge: c.edge ?? (c.edges === 'top' ? 'top' : 'bottom'),
    facing: c.facing ?? 'out',
    both: c.both ?? c.edges === 'both',
  }
}

/** The edge across the screen from `edge`. */
const OPPOSITE: Record<OrderEdge, OrderEdge> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' }
export const oppositeEdge = (edge: OrderEdge): OrderEdge => OPPOSITE[edge]

/** What a combat link carries: the scene to open, and the tracker's encounter. */
export interface CombatLink {
  scene: string | null
  /** The tracker's own payload, untouched. */
  encounter: { name?: string; combatants?: unknown[]; [key: string]: unknown }
}

/** Read a `#combat=<base64url JSON>` hash (null if there is none, or it isn't readable). */
export function readCombatLink(hash: string): CombatLink | null {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('combat')
  if (!raw) return null
  try {
    const text = raw.trim().startsWith('{') ? raw : decodeBase64Url(raw.trim())
    const data = JSON.parse(text) as { scene?: unknown; encounter?: unknown }
    if (!data || typeof data.encounter !== 'object' || !data.encounter) return null
    return {
      scene: typeof data.scene === 'string' && data.scene.trim() ? data.scene.trim() : null,
      encounter: data.encounter as CombatLink['encounter'],
    }
  } catch {
    return null
  }
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Encode a link payload the way the campaign bible does (for tests and tools). */
export function writeCombatLink(link: { scene?: string; encounter: object }): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ...link }))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `#combat=${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** A scene's file name in the scenes folder: its name, minus what file names can't hold. */
export function sceneFileName(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return `${clean || 'Untitled scene'}.ivtt`
}

/** Default token colours: allies green, enemies red (a plain ring, unless a border is chosen). */
const ALLY_COLOR = '#2e8b57'
const ENEMY_COLOR = '#b03a2e'

/** How a combatant's token starts out: its encounter's look, else plain, in its side's colour. */
export function combatantLook(c: Combatant): Pick<CharacterToken, 'border' | 'color' | 'size' | 'label' | 'type'> {
  const v = c.vtt ?? {}
  return {
    border: typeof v.border === 'string' && v.border ? v.border : 'plain',
    color: typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : c.allegiance === 'ally' ? ALLY_COLOR : ENEMY_COLOR,
    size: v.size === 2 ? 2 : 1,
    label: v.label === 'type' || v.label === 'both' || v.label === 'none' ? v.label : 'name',
    type: c.type || undefined,
  }
}

/** Out of the fight (dead, in torpor…): its token is greyed. */
export const isDown = (c: Pick<Combatant, 'state'>) => c.state !== 'active'

/** One coin in the players' order of initiative. */
export interface OrderEntry {
  id: string
  name: string
  /** Image key of the portrait (in the scene's images), if it's loaded. */
  portrait: string | null
  side: 'npc' | 'pc'
  allegiance: 'ally' | 'enemy'
  active: boolean
  acted: boolean
  down: boolean
  /** Initiative this turn (null: not rolled yet). */
  init: number | null
  /** Squares its token has moved this turn (the acting combatant's, once it has moved). */
  moved?: number
}

/** What the table shows of the fight. */
export interface OrderStrip {
  round: number
  phase: string
  entries: OrderEntry[]
  placement: OrderPlacement
  /** Where the acting combatant's token started its turn (scene units), ringed on the table. */
  start?: { x: number; y: number; r: number }
}

/** How far the acting combatant's token has moved on its turn. */
export interface TurnMove {
  /** Whose turn, in which round (a new turn starts the count again). */
  ref: string
  round: number
  /** Where its token stood when the turn began. */
  start: Point
  /** Squares moved (diagonals count 1, like straight moves). */
  squares: number
  /** Arrow-key steps since the last drag (where each went, after where they began). */
  steps: Point[]
}

/** Squares between two points: diagonals count 1, like straight moves. */
export const squaresBetween = (a: Point, b: Point, grid: number) =>
  Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / grid

const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5

/**
 * The turn's movement once the acting token moved from `from` to `to`. Every move counts,
 * there and back, except an arrow-key step back onto the square the last step left: that
 * takes the step off again.
 */
export function turnMoved(
  turn: TurnMove | null,
  ref: string,
  round: number,
  from: Point,
  to: Point,
  grid: number,
  arrowKey: boolean,
): TurnMove {
  const t = turn && turn.ref === ref && turn.round === round ? turn : { ref, round, start: from, squares: 0, steps: [] }
  const cost = squaresBetween(from, to, grid)
  if (!arrowKey) return { ...t, squares: t.squares + cost, steps: [] }
  const steps = t.steps.length ? t.steps : [from]
  if (steps.length >= 2 && samePoint(steps[steps.length - 2], to)) {
    return { ...t, squares: Math.max(0, t.squares - cost), steps: steps.slice(0, -1) }
  }
  return { ...t, squares: t.squares + cost, steps: [...steps, to] }
}

/**
 * The order the players see: everyone in the fight, in order of initiative, but not the
 * tracker's Inactive section, and not an enemy whose token is on the map but out of the
 * players' sight (an ambusher). Players and allies always show.
 */
export function orderFor(
  summary: CombatSummary,
  tokens: Pick<CharacterToken, 'id' | 'ref'>[],
  seenTokenIds: Set<string>,
  portraitKey: (url: string) => string | null,
  placement: OrderPlacement = { edge: 'bottom', facing: 'out', both: false },
): OrderStrip {
  const byId = new Map(summary.combatants.map((c) => [c.id, c]))
  const tokenOf = new Map(tokens.filter((t) => t.ref).map((t) => [t.ref!, t.id]))
  const entries: OrderEntry[] = []
  for (const id of summary.order) {
    const c = byId.get(id)
    if (!c || c.inactive) continue
    const token = tokenOf.get(c.id)
    if (c.allegiance === 'enemy' && c.side === 'npc' && token && !seenTokenIds.has(token)) continue
    entries.push({
      id: c.id,
      name: c.name,
      portrait: c.portrait ? portraitKey(c.portrait) : null,
      side: c.side,
      allegiance: c.allegiance,
      active: c.id === summary.activeId,
      acted: c.acted,
      down: isDown(c),
      init: c.init,
    })
  }
  return { round: summary.round, phase: summary.phase, entries, placement }
}

/** The image key a portrait URL is kept under in the scene's images (short, whatever the URL). */
export function portraitKeyOf(url: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `combatant:${(h >>> 0).toString(36)}`
}
