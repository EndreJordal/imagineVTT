import type { Measure } from './measure'
import type { OrderStrip } from './combat'
import type { CurtainState } from './curtain'
import type { FogMemory } from './fog'
import type { Turn } from './handout'
import type { AssetImages } from './mapObjects'
import type { Point, Size, TableState } from './types'

/** Messages between the GM window and the table window (same origin, same machine). */
export type Message =
  | { type: 'gm-hello' } // gm -> table: GM (re)started, introduce yourself
  | { type: 'hello'; screen: Size } // table -> gm: just opened, send me everything
  | { type: 'screen'; screen: Size } // table -> gm: resized, and periodic heartbeat
  | { type: 'state'; state: TableState } // gm -> table
  | { type: 'map'; image: Blob | null } // gm -> table: map image changed
  | { type: 'fog'; memory: FogMemory | null } // gm -> table: fog memory changed
  | { type: 'assets'; images: AssetImages } // gm -> table: images of the objects placed
  | { type: 'curtain'; state: CurtainState } // gm -> table: curtain dropped, raised, set up
  | { type: 'curtain-images'; images: Record<string, Blob> } // gm -> table: the curtain's pictures
  | { type: 'handout'; handout: { id: string; image: Blob; turn: Turn; fill: boolean } | null } // gm -> table: picture shown
  | { type: 'order'; strip: OrderStrip | null } // gm -> table: the order of initiative the players see
  | { type: 'alert'; at: Point } // gm -> table: the GM's alert at a spot (a ring closing in on it)
  | { type: 'measure'; draft: Measure | null } // gm -> table: the measurement being drawn
  | { type: 'bye'; from: 'gm' | 'table' }

/** Table heartbeat interval; the GM treats the table as gone after a few missed beats. */
export const HEARTBEAT_MS = 2000

export interface Channel {
  post(message: Message): void
  close(): void
}

export function openChannel(onMessage: (message: Message) => void): Channel {
  const channel = new BroadcastChannel('imaginevtt')
  channel.onmessage = (e: MessageEvent<Message>) => onMessage(e.data)
  return {
    post: (message) => channel.postMessage(message),
    close: () => channel.close(),
  }
}
